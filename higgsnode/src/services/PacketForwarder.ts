import { EventEmitter } from 'events';
import dgram from 'dgram';
import { createSocket, Socket } from 'dgram';
import { logger } from '../utils/logger';
import { getPhysicalInterface } from '../utils/networkInterface';
import { isLinux, isMacOS, isWindows } from '../utils/platform';

/**
 * PacketForwarder - обрабатывает IP пакеты от bosonserver через WebSocket
 * и маршрутизирует их в интернет через NAT
 * 
 * Архитектура:
 * 1. Нода получает IP пакеты от bosonserver через WebSocket (уже расшифрованные из WireGuard)
 * 2. PacketForwarder извлекает IP пакеты из payload
 * 3. Отправляет пакеты в интернет через raw socket или используя NAT
 */
export class PacketForwarder extends EventEmitter {
  private rawSocket: Socket | null = null;
  private physicalInterface: ReturnType<typeof getPhysicalInterface> | null = null;
  private isRunning = false;

  constructor() {
    super();
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('PacketForwarder is already running');
      return;
    }

    try {
      logger.info('Starting PacketForwarder');

      // Определить физический интерфейс
      this.physicalInterface = getPhysicalInterface();
      if (!this.physicalInterface) {
        throw new Error('Failed to detect physical network interface');
      }

      logger.info('PacketForwarder started', {
        physicalInterface: this.physicalInterface.name,
        ipv4: this.physicalInterface.ipv4,
      });

      this.isRunning = true;
      this.emit('started');
    } catch (error) {
      logger.error('Failed to start PacketForwarder', { error });
      throw error;
    }
  }

  /**
   * Обрабатывает пакет от bosonserver и отправляет его в интернет
   * @param packet - IP пакет (Buffer) от bosonserver
   * @param sessionId - ID сессии для отслеживания
   */
  async forwardPacket(packet: Buffer, sessionId: string): Promise<void> {
    if (!this.isRunning) {
      logger.warn('PacketForwarder is not running, cannot forward packet');
      return;
    }

    try {
      // Проверить, что это валидный IP пакет (минимум 20 байт для IPv4 заголовка)
      if (packet.length < 20) {
        logger.debug('Packet too small, ignoring', { size: packet.length });
        return;
      }

      // Проверить версию IP (первые 4 бита)
      const version = (packet[0] >> 4) & 0x0f;
      if (version !== 4 && version !== 6) {
        logger.debug('Invalid IP version, ignoring', { version });
        return;
      }

      // Для IPv4: извлечь destination IP
      if (version === 4) {
        const destIP = `${packet[12]}.${packet[13]}.${packet[14]}.${packet[15]}`;
        const protocol = packet[9]; // IP protocol field

        logger.debug('Forwarding IPv4 packet', {
          sessionId,
          destIP,
          protocol,
          size: packet.length,
        });

        // Отправить пакет через raw socket или используя системные утилиты
        await this.sendRawPacket(packet, protocol);
      } else if (version === 6) {
        // IPv6 поддержка (упрощенная)
        logger.debug('Forwarding IPv6 packet', { sessionId, size: packet.length });
        await this.sendRawPacket(packet, 41); // IPv6 protocol number
      }

      this.emit('packetForwarded', { sessionId, size: packet.length });
    } catch (error) {
      logger.error('Failed to forward packet', { error, sessionId });
      this.emit('error', error);
    }
  }

  /**
   * Отправляет raw IP пакет в интернет
   * На Linux/macOS использует raw socket, на Windows - альтернативный метод
   */
  private async sendRawPacket(packet: Buffer, protocol: number): Promise<void> {
    try {
      if (isLinux() || isMacOS()) {
        // Linux/macOS: использовать raw socket для отправки IP пакетов
        // Примечание: для raw socket нужны права root
        await this.sendRawSocketPacket(packet);
      } else if (isWindows()) {
        // Windows: использовать альтернативный метод (например, через WinPcap или npcap)
        logger.warn('Raw socket on Windows requires additional setup');
        // Fallback: можно использовать другие методы
      }
    } catch (error) {
      logger.error('Failed to send raw packet', { error });
      throw error;
    }
  }

  /**
   * Отправляет пакет через raw socket (Linux/macOS)
   */
  private async sendRawSocketPacket(packet: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // Создать raw socket для отправки IP пакетов
        // Примечание: на macOS raw socket может требовать специальных разрешений
        if (!this.rawSocket) {
          // Использовать обычный UDP socket для отправки пакетов
          // В реальной реализации можно использовать raw socket с правами root
          this.rawSocket = createSocket('udp4');
        }

        // Для упрощения: если это UDP пакет, извлечь destination и отправить
        // В полной реализации нужно парсить IP заголовок и отправлять через raw socket
        const protocol = packet[9];
        
        if (protocol === 17) { // UDP
          // Извлечь destination IP и port из IP заголовка
          const destIP = `${packet[12]}.${packet[13]}.${packet[14]}.${packet[15]}`;
          const ipHeaderLength = (packet[0] & 0x0f) * 4;
          const udpHeaderOffset = ipHeaderLength;
          
          if (packet.length > udpHeaderOffset + 4) {
            const destPort = (packet[udpHeaderOffset + 2] << 8) | packet[udpHeaderOffset + 3];
            const udpPayload = packet.slice(udpHeaderOffset + 8);
            
            // Отправить UDP пакет
            this.rawSocket.send(udpPayload, destPort, destIP, (error) => {
              if (error) {
                logger.error('Failed to send UDP packet', { error, destIP, destPort });
                reject(error);
              } else {
                logger.debug('UDP packet sent', { destIP, destPort });
                resolve();
              }
            });
          } else {
            resolve(); // Пакет слишком мал
          }
        } else if (protocol === 6) { // TCP
          // TCP требует установления соединения, здесь упрощенная обработка
          logger.debug('TCP packet forwarding requires connection management');
          resolve();
        } else {
          // Для других протоколов (ICMP и т.д.) нужен raw socket
          logger.debug('Non-UDP/TCP packet, requires raw socket', { protocol });
          resolve();
        }
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Обрабатывает ответные пакеты из интернета и отправляет их обратно через WebSocket
   * (Этот метод будет вызываться из другого компонента, который слушает входящие пакеты)
   */
  handleIncomingPacket(packet: Buffer, sourceIP: string, sourcePort: number): void {
    // Этот метод будет использоваться для обработки входящих пакетов
    // и отправки их обратно через WebSocket к bosonserver
    logger.debug('Incoming packet received', { sourceIP, sourcePort, size: packet.length });
    this.emit('incomingPacket', { packet, sourceIP, sourcePort });
  }

  stop(): void {
    if (!this.isRunning) {
      return;
    }

    try {
      logger.info('Stopping PacketForwarder');

      if (this.rawSocket) {
        this.rawSocket.close();
        this.rawSocket = null;
      }

      this.isRunning = false;
      this.physicalInterface = null;
      this.emit('stopped');
      logger.info('PacketForwarder stopped');
    } catch (error) {
      logger.error('Error stopping PacketForwarder', { error });
    }
  }

  isForwarderRunning(): boolean {
    return this.isRunning;
  }
}

