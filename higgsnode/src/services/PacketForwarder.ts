import { EventEmitter } from 'events';
import dgram from 'dgram';
import { createSocket, Socket } from 'dgram';
import { logger } from '../utils/logger';
import { getPhysicalInterface } from '../utils/networkInterface';
import { isLinux, isMacOS, isWindows } from '../utils/platform';
import { TCPConnectionManager } from './TCPConnectionManager';

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
  private tcpManager: TCPConnectionManager;
  private packetCaptureSocket: Socket | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    super();
    this.tcpManager = new TCPConnectionManager();
    
    // Обработчик входящих данных от TCP соединений
    this.tcpManager.on('incomingData', (data: {
      packet: Buffer;
      connectionId: string;
      sessionId: string;
      sourceIP: string;
      sourcePort: number;
    }) => {
      this.handleIncomingPacket(data.packet, data.sourceIP, data.sourcePort);
    });
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

      // Запустить TCP connection manager
      this.tcpManager.start();

      // Запустить перехват пакетов (опционально, если есть права)
      await this.startPacketCapture();

      // Запустить периодическую очистку неактивных соединений
      this.cleanupInterval = setInterval(() => {
        this.tcpManager.cleanupInactiveConnections();
      }, 60000); // Каждую минуту

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
        await this.sendRawPacket(packet, protocol, sessionId);
      } else if (version === 6) {
        // IPv6 поддержка (упрощенная)
        logger.debug('Forwarding IPv6 packet', { sessionId, size: packet.length });
        await this.sendRawPacket(packet, 41, sessionId); // IPv6 protocol number
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
  private async sendRawPacket(packet: Buffer, protocol: number, sessionId: string): Promise<void> {
    try {
      if (isLinux() || isMacOS()) {
        // Linux/macOS: использовать raw socket для отправки IP пакетов
        // Примечание: для raw socket нужны права root
        await this.sendRawSocketPacket(packet, sessionId);
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
  private async sendRawSocketPacket(packet: Buffer, sessionId: string): Promise<void> {
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
          // TCP требует установления соединения
          this.handleTCPPacket(packet, sessionId).then(() => {
            resolve();
          }).catch((error) => {
            logger.error('TCP packet handling failed', { error });
            resolve(); // Не прерываем выполнение для других пакетов
          });
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
   * Обрабатывает TCP пакет через TCP connection manager
   */
  private async handleTCPPacket(packet: Buffer, sessionId: string): Promise<void> {
    try {
      // Извлечь информацию из IP и TCP заголовков
      const destIP = `${packet[12]}.${packet[13]}.${packet[14]}.${packet[15]}`;
      const sourceIP = `${packet[16]}.${packet[17]}.${packet[18]}.${packet[19]}`;
      const ipHeaderLength = (packet[0] & 0x0f) * 4;
      
      if (packet.length < ipHeaderLength + 20) {
        logger.debug('TCP packet too small', { size: packet.length });
        return;
      }

      const tcpHeaderOffset = ipHeaderLength;
      const destPort = (packet[tcpHeaderOffset + 2] << 8) | packet[tcpHeaderOffset + 3];
      const sourcePort = (packet[tcpHeaderOffset] << 8) | packet[tcpHeaderOffset + 1];
      
      // Извлечь TCP payload
      const tcpHeaderLength = ((packet[tcpHeaderOffset + 12] >> 4) & 0x0f) * 4;
      const tcpPayload = packet.slice(ipHeaderLength + tcpHeaderLength);

      if (tcpPayload.length === 0) {
        // Это может быть ACK или другой контрольный пакет без данных
        logger.debug('TCP packet with no payload (control packet)', { destIP, destPort });
        return;
      }

      // Отправить через TCP connection manager
      await this.tcpManager.sendTCPPacket(
        tcpPayload,
        sessionId,
        destIP,
        destPort,
        sourceIP,
        sourcePort
      );

      logger.debug('TCP packet forwarded', { destIP, destPort, size: tcpPayload.length });
    } catch (error) {
      logger.error('Failed to handle TCP packet', { error });
    }
  }

  /**
   * Запускает перехват пакетов для получения ответов из интернета
   */
  private async startPacketCapture(): Promise<void> {
    try {
      // Создать UDP socket для перехвата ответных UDP пакетов
      // Примечание: для полного перехвата нужен raw socket с правами root
      // Здесь используем упрощенный подход - слушаем на случайном порту
      // и используем NAT для перенаправления ответов
      
      if (!this.packetCaptureSocket) {
        this.packetCaptureSocket = createSocket('udp4');
        
        // Обработчик входящих UDP пакетов
        this.packetCaptureSocket.on('message', (msg, rinfo) => {
          logger.debug('Captured UDP response packet', {
            sourceIP: rinfo.address,
            sourcePort: rinfo.port,
            size: msg.length,
          });
          
          // Отправить пакет обратно через WebSocket
          this.handleIncomingPacket(msg, rinfo.address, rinfo.port);
        });

        // Привязать к случайному порту (система выберет свободный)
        this.packetCaptureSocket.bind(() => {
          const address = this.packetCaptureSocket?.address();
          if (address) {
            logger.debug('Packet capture socket bound', { port: address.port });
          }
        });
      }
    } catch (error) {
      // Перехват пакетов не критичен, продолжаем работу
      logger.debug('Packet capture not available (may require root)', { error });
    }
  }

  /**
   * Обрабатывает ответные пакеты из интернета и отправляет их обратно через WebSocket
   */
  handleIncomingPacket(packet: Buffer, sourceIP: string, sourcePort: number): void {
    logger.debug('Incoming packet received', { sourceIP, sourcePort, size: packet.length });
    this.emit('incomingPacket', { packet, sourceIP, sourcePort });
  }

  stop(): void {
    if (!this.isRunning) {
      return;
    }

    try {
      logger.info('Stopping PacketForwarder');

      // Остановить TCP connection manager
      this.tcpManager.stop();

      // Остановить перехват пакетов
      if (this.packetCaptureSocket) {
        this.packetCaptureSocket.close();
        this.packetCaptureSocket = null;
      }

      // Остановить очистку
      if (this.cleanupInterval) {
        clearInterval(this.cleanupInterval);
        this.cleanupInterval = null;
      }

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

