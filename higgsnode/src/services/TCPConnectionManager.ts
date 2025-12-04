import { EventEmitter } from 'events';
import net from 'net';
import { logger } from '../utils/logger';

export interface TCPConnection {
  id: string;
  socket: net.Socket;
  sessionId: string;
  remoteIP: string;
  remotePort: number;
  localIP: string;
  localPort: number;
  createdAt: Date;
  lastActivity: Date;
}

/**
 * TCPConnectionManager - управляет TCP соединениями для пересылки пакетов
 * 
 * Архитектура:
 * 1. Создает TCP соединения для каждого уникального destination (IP:port)
 * 2. Отслеживает состояние соединений
 * 3. Пересылает данные через TCP socket
 * 4. Перехватывает ответные данные и отправляет обратно через WebSocket
 */
export class TCPConnectionManager extends EventEmitter {
  private connections: Map<string, TCPConnection> = new Map();
  private isRunning = false;

  constructor() {
    super();
  }

  start(): void {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    logger.info('TCPConnectionManager started');
  }

  stop(): void {
    if (!this.isRunning) {
      return;
    }

    // Закрыть все соединения
    for (const connection of this.connections.values()) {
      try {
        connection.socket.destroy();
      } catch (error) {
        logger.debug('Error closing TCP connection', { error });
      }
    }

    this.connections.clear();
    this.isRunning = false;
    logger.info('TCPConnectionManager stopped');
  }

  /**
   * Отправляет TCP пакет через существующее или новое соединение
   */
  async sendTCPPacket(
    packet: Buffer,
    sessionId: string,
    destIP: string,
    destPort: number,
    sourceIP: string,
    sourcePort: number
  ): Promise<void> {
    if (!this.isRunning) {
      logger.warn('TCPConnectionManager is not running');
      return;
    }

    const connectionKey = `${destIP}:${destPort}:${sourceIP}:${sourcePort}`;
    let connection = this.connections.get(connectionKey);

    // Если соединения нет, создать новое
    if (!connection) {
      connection = await this.createConnection(
        connectionKey,
        sessionId,
        destIP,
        destPort,
        sourceIP,
        sourcePort
      );
    }

    if (!connection) {
      logger.warn('Failed to create TCP connection', { destIP, destPort });
      return;
    }

    // Отправить данные через TCP socket
    try {
      connection.socket.write(packet);
      connection.lastActivity = new Date();
      logger.debug('TCP packet sent', { destIP, destPort, size: packet.length });
    } catch (error) {
      logger.error('Failed to send TCP packet', { error, destIP, destPort });
      // Удалить соединение при ошибке
      this.removeConnection(connectionKey);
      throw error;
    }
  }

  /**
   * Создает новое TCP соединение
   */
  private async createConnection(
    connectionKey: string,
    sessionId: string,
    destIP: string,
    destPort: number,
    sourceIP: string,
    sourcePort: number
  ): Promise<TCPConnection | undefined> {
    return new Promise((resolve) => {
      try {
        const socket = new net.Socket();
        const connection: TCPConnection = {
          id: connectionKey,
          socket,
          sessionId,
          remoteIP: destIP,
          remotePort: destPort,
          localIP: sourceIP,
          localPort: sourcePort,
          createdAt: new Date(),
          lastActivity: new Date(),
        };

        // Обработчик данных от сервера
        socket.on('data', (data: Buffer) => {
          connection.lastActivity = new Date();
          // Отправить ответные данные обратно через WebSocket
          this.emit('incomingData', {
            packet: data,
            connectionId: connectionKey,
            sessionId,
            sourceIP: destIP,
            sourcePort: destPort,
          });
        });

        // Обработчик закрытия соединения
        socket.on('close', () => {
          logger.debug('TCP connection closed', { connectionKey, destIP, destPort });
          this.removeConnection(connectionKey);
        });

        // Обработчик ошибок
        socket.on('error', (error) => {
          logger.error('TCP connection error', { error, connectionKey, destIP, destPort });
          this.removeConnection(connectionKey);
        });

        // Подключиться к удаленному серверу
        socket.connect(destPort, destIP, () => {
          logger.info('TCP connection established', { destIP, destPort, connectionKey });
          this.connections.set(connectionKey, connection);
          resolve(connection);
        });

        // Таймаут подключения
        socket.setTimeout(10000);
        socket.on('timeout', () => {
          logger.warn('TCP connection timeout', { destIP, destPort });
          socket.destroy();
          this.removeConnection(connectionKey);
          resolve(undefined);
        });
      } catch (error) {
        logger.error('Failed to create TCP connection', { error, destIP, destPort });
        resolve(undefined);
      }
    });
  }

  /**
   * Удаляет соединение
   */
  private removeConnection(connectionKey: string): void {
    const connection = this.connections.get(connectionKey);
    if (connection) {
      try {
        if (!connection.socket.destroyed) {
          connection.socket.destroy();
        }
      } catch (error) {
        logger.debug('Error destroying socket', { error });
      }
      this.connections.delete(connectionKey);
    }
  }

  /**
   * Очищает неактивные соединения (старше 5 минут)
   */
  cleanupInactiveConnections(): void {
    const now = new Date();
    const maxIdleTime = 5 * 60 * 1000; // 5 минут

    for (const [key, connection] of this.connections.entries()) {
      const idleTime = now.getTime() - connection.lastActivity.getTime();
      if (idleTime > maxIdleTime) {
        logger.debug('Removing inactive TCP connection', {
          connectionKey: key,
          idleTime: Math.floor(idleTime / 1000),
        });
        this.removeConnection(key);
      }
    }
  }

  getConnectionCount(): number {
    return this.connections.size;
  }
}

