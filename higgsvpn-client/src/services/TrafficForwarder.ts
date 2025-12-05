import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { WebSocketRelay } from './WebSocketRelay';
import { execSync } from 'child_process';
import { config } from '../config/config';

/**
 * TrafficForwarder - перехватывает трафик с WireGuard TUN интерфейса
 * и пересылает его через WebSocket Relay
 * 
 * Архитектура:
 * 1. WireGuard автоматически перехватывает трафик через TUN интерфейс
 * 2. TrafficForwarder читает статистику WireGuard и пересылает пакеты через WebSocket
 * 3. Для полной функциональности нужна библиотека для работы с TUN (например, node-tun)
 */
export class TrafficForwarder extends EventEmitter {
  private relay: WebSocketRelay | null = null;
  private interfaceName: string;
  private isRunning = false;
  private statsInterval: NodeJS.Timeout | null = null;
  private lastStats: { tx: number; rx: number } = { tx: 0, rx: 0 };

  constructor(relay: WebSocketRelay | null = null) {
    super();
    this.relay = relay;
    this.interfaceName = config.wireguard.interfaceName;
  }

  setRelay(relay: WebSocketRelay): void {
    this.relay = relay;
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('TrafficForwarder is already running');
      return;
    }

    logger.info('Starting TrafficForwarder', { interface: this.interfaceName });
    this.isRunning = true;

    // Проверить, что WireGuard интерфейс существует
    try {
      execSync(`wg show ${this.interfaceName}`, { stdio: 'pipe' });
      logger.info('WireGuard interface found, starting traffic forwarding');
    } catch (error) {
      logger.warn('WireGuard interface not found, traffic forwarding may not work', { 
        interface: this.interfaceName,
        error 
      });
      // Продолжаем, так как интерфейс может появиться позже
    }

    // Начать мониторинг статистики
    this.startStatsMonitoring();

    // Настроить обработчики для пакетов от relay
    if (this.relay) {
      this.relay.on('packet', (data: any) => {
        this.handleIncomingPacket(data);
      });
    }

    this.emit('started');
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    logger.info('Stopping TrafficForwarder');
    this.isRunning = false;

    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }

    this.emit('stopped');
  }

  private startStatsMonitoring(): void {
    // Мониторинг статистики WireGuard каждые 5 секунд
    this.statsInterval = setInterval(() => {
      try {
        const output = execSync(`wg show ${this.interfaceName} dump`, { 
          encoding: 'utf-8',
          stdio: 'pipe' 
        });
        
        // Парсим статистику (формат: interface, public-key, endpoint, allowed-ips, latest-handshake, tx-bytes, rx-bytes)
        const lines = output.trim().split('\n');
        if (lines.length > 0) {
          const parts = lines[0].split('\t');
          if (parts.length >= 7) {
            const tx = parseInt(parts[5], 10) || 0;
            const rx = parseInt(parts[6], 10) || 0;
            
            if (tx !== this.lastStats.tx || rx !== this.lastStats.rx) {
              const txDelta = tx - this.lastStats.tx;
              const rxDelta = rx - this.lastStats.rx;
              
              if (txDelta > 0 || rxDelta > 0) {
                logger.debug('WireGuard traffic stats', { 
                  tx: txDelta, 
                  rx: rxDelta,
                  totalTx: tx,
                  totalRx: rx
                });
                
                this.emit('stats', { tx: txDelta, rx: rxDelta, totalTx: tx, totalRx: rx });
              }
              
              this.lastStats = { tx, rx };
            }
          }
        }
      } catch (error) {
        // Интерфейс может быть недоступен
        if (this.isRunning) {
          logger.debug('Failed to get WireGuard stats', { error });
        }
      }
    }, 5000);
  }

  /**
   * Обрабатывает входящий пакет от relay
   * В реальной реализации должен записывать пакет в TUN интерфейс
   */
  private handleIncomingPacket(data: any): void {
    try {
      // Если данные в base64, декодировать
      const packet = typeof data === 'string' 
        ? Buffer.from(data, 'base64')
        : Buffer.from(data);

      logger.debug('Received packet from relay', { size: packet.length });

      // В реальной реализации здесь нужно записать пакет в TUN интерфейс
      // Для этого нужна библиотека типа node-tun или использование raw sockets
      // Пока просто логируем
      this.emit('packet', packet);
    } catch (error) {
      logger.error('Failed to handle incoming packet', { error });
    }
  }

  /**
   * Отправляет пакет через relay
   * В реальной реализации должен читать пакеты с TUN интерфейса
   */
  sendPacket(packet: Buffer): void {
    if (!this.relay) {
      logger.warn('Cannot send packet: relay not set');
      return;
    }

    if (!this.isRunning) {
      logger.warn('Cannot send packet: TrafficForwarder not running');
      return;
    }

    this.relay.sendPacket(packet);
    logger.debug('Packet sent through relay', { size: packet.length });
  }

  /**
   * Проверяет статус WireGuard интерфейса
   */
  async checkInterfaceStatus(): Promise<boolean> {
    try {
      execSync(`wg show ${this.interfaceName}`, { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }
}

