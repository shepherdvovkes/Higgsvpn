import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { NetworkError } from '../utils/errors';
import { gzip, gunzip } from 'zlib';
import { promisify } from 'util';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export type RelayMessageType = 'data' | 'control' | 'heartbeat';

export interface RelayMessage {
  type: RelayMessageType;
  sessionId: string;
  direction: 'client-to-node' | 'node-to-client' | 'server';
  payload: Buffer | any;
}

export interface RelayConnectionOptions {
  url: string;
  sessionId: string;
  reconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

export class WebSocketRelay extends EventEmitter {
  private ws: WebSocket | null = null;
  private options: Required<RelayConnectionOptions>;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private isConnected = false;
  private heartbeatInterval = 30000; // 30 seconds
  private packetBuffer: Buffer[] = [];
  private batchTimer: NodeJS.Timeout | null = null;
  private readonly BATCH_SIZE = 10; // Количество пакетов в батче
  private readonly BATCH_TIMEOUT = 10; // Таймаут в миллисекундах
  private readonly MAX_PACKET_SIZE = 1500; // Максимальный размер пакета

  constructor(options: RelayConnectionOptions) {
    super();
    this.options = {
      reconnect: options.reconnect ?? true,
      reconnectInterval: options.reconnectInterval ?? 5000,
      maxReconnectAttempts: options.maxReconnectAttempts ?? 10,
      url: options.url,
      sessionId: options.sessionId,
    };
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        logger.info('Connecting to WebSocket relay', { url: this.options.url, sessionId: this.options.sessionId });

        this.ws = new WebSocket(this.options.url);

        this.ws.on('open', () => {
          logger.info('WebSocket relay connected', { sessionId: this.options.sessionId });
          this.isConnected = true;
          this.reconnectAttempts = 0;
          this.startHeartbeat();
          this.emit('connected');
          resolve();
        });

        this.ws.on('message', (data: WebSocket.Data) => {
          this.handleMessage(data);
        });

        this.ws.on('error', (error) => {
          logger.error('WebSocket relay error', { error, sessionId: this.options.sessionId });
          this.emit('error', error);
          if (!this.isConnected) {
            reject(error);
          }
        });

        this.ws.on('close', (code, reason) => {
          logger.warn('WebSocket relay closed', {
            code,
            reason: reason.toString(),
            sessionId: this.options.sessionId,
          });
          this.isConnected = false;
          this.stopHeartbeat();
          this.emit('disconnected', code, reason);

          if (this.options.reconnect && this.reconnectAttempts < this.options.maxReconnectAttempts) {
            this.scheduleReconnect();
          }
        });
      } catch (error) {
        logger.error('Failed to create WebSocket connection', { error });
        reject(error);
      }
    });
  }

  private handleMessage(data: WebSocket.Data): void {
    try {
      let message: RelayMessage;

      if (Buffer.isBuffer(data)) {
        // Проверить, является ли это батчем (начинается с uint16)
        if (data.length >= 2) {
          const packetCount = data.readUInt16BE(0);
          
          // Если это батч (больше 1 пакета)
          if (packetCount > 1 && packetCount < 100) { // Разумный лимит
            this.handleBatch(data);
            return;
          }
        }

        // Проверить, является ли это WireGuard пакетом (первый байт обычно 0x01-0x04)
        const firstByte = data[0];
        if (firstByte >= 0x01 && firstByte <= 0x04) {
          // Это WireGuard пакет, обработать напрямую
          message = {
            type: 'data',
            sessionId: this.options.sessionId,
            direction: 'client-to-node',
            payload: data,
          };
          this.emit('data', message);
          return;
        }

        // Try to parse as JSON first
        try {
          message = JSON.parse(data.toString());
        } catch {
          // If not JSON, treat as binary data message
          message = {
            type: 'data',
            sessionId: this.options.sessionId,
            direction: 'client-to-node',
            payload: data,
          };
        }
      } else if (typeof data === 'string') {
        message = JSON.parse(data);
      } else {
        logger.warn('Unknown message format', { data });
        return;
      }

      // Проверить, является ли это сжатым control message
      if (message.type === 'control' && (message.payload as any)?.compressed) {
        this.handleCompressedControl(message);
        return;
      }

      // Validate message
      if (!message.type || !message.sessionId) {
        logger.warn('Invalid message format', { message });
        return;
      }

      // Handle different message types
      switch (message.type) {
        case 'data':
          this.emit('data', message);
          break;
        case 'control':
          this.handleControlMessage(message);
          break;
        case 'heartbeat':
          // Respond to heartbeat
          this.sendHeartbeat();
          break;
        default:
          logger.warn('Unknown message type', { type: message.type });
      }
    } catch (error) {
      logger.error('Failed to handle message', { error });
    }
  }

  private handleBatch(batch: Buffer): void {
    let offset = 2; // Пропустить счетчик пакетов
    const packetCount = batch.readUInt16BE(0);

    for (let i = 0; i < packetCount && offset < batch.length; i++) {
      // Прочитать размер пакета
      if (offset + 2 > batch.length) break;
      const packetSize = batch.readUInt16BE(offset);
      offset += 2;

      // Прочитать данные пакета
      if (offset + packetSize > batch.length) break;
      const packet = batch.slice(offset, offset + packetSize);
      offset += packetSize;

      // Обработать пакет
      const message: RelayMessage = {
        type: 'data',
        sessionId: this.options.sessionId,
        direction: 'client-to-node',
        payload: packet,
      };
      this.emit('data', message);
    }

    logger.debug('Batch processed', { packetCount });
  }

  private async handleCompressedControl(message: RelayMessage): Promise<void> {
    try {
      const compressedData = (message.payload as any).data;
      const compressed = Buffer.from(compressedData, 'base64');
      const decompressed = await gunzipAsync(compressed);
      const decompressedMessage = JSON.parse(decompressed.toString());
      this.handleControlMessage(decompressedMessage);
    } catch (error) {
      logger.error('Failed to decompress control message', { error });
    }
  }

  private handleControlMessage(message: RelayMessage): void {
    const action = (message.payload as any)?.action;
    
    switch (action) {
      case 'connect':
        logger.info('Control: connect', { sessionId: message.sessionId });
        this.emit('controlConnect', message.payload);
        break;
      case 'disconnect':
        logger.info('Control: disconnect', { sessionId: message.sessionId });
        this.emit('controlDisconnect', message.payload);
        break;
      case 'error':
        logger.error('Control: error', { payload: message.payload });
        this.emit('controlError', message.payload);
        break;
      default:
        logger.warn('Unknown control action', { action });
    }
  }

  sendData(data: Buffer, direction: 'client-to-node' | 'node-to-client'): void {
    if (!this.isConnected || !this.ws) {
      throw new NetworkError('WebSocket not connected');
    }

    // Для бинарных данных (WireGuard пакеты) отправлять напрямую или батчем
    if (Buffer.isBuffer(data)) {
      // Для маленьких пакетов использовать batching
      if (data.length < this.MAX_PACKET_SIZE) {
        this.packetBuffer.push(data);
        
        // Отправить батч если достигнут размер или таймаут
        if (this.packetBuffer.length >= this.BATCH_SIZE) {
          this.flushBatch();
        } else if (!this.batchTimer) {
          this.batchTimer = setTimeout(() => {
            this.flushBatch();
          }, this.BATCH_TIMEOUT);
        }
      } else {
        // Большие пакеты отправлять сразу как бинарные
        this.ws.send(data, { binary: true });
      }
      return;
    }

    // Для control messages использовать JSON
    const message: RelayMessage = {
      type: 'data',
      sessionId: this.options.sessionId,
      direction,
      payload: data,
    };
    this.ws.send(JSON.stringify(message));
  }

  private flushBatch(): void {
    if (this.packetBuffer.length === 0 || !this.ws) {
      return;
    }

    // Создать батч: [количество пакетов (2 байта)] + [размер пакета 1 (2 байта)] + [данные 1] + ...
    const packets = this.packetBuffer;
    this.packetBuffer = [];

    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    // Формат батча: [count: uint16] + [size1: uint16][data1] + [size2: uint16][data2] + ...
    let batchSize = 2; // Для счетчика пакетов
    for (const packet of packets) {
      batchSize += 2 + packet.length; // Размер + данные
    }

    const batch = Buffer.allocUnsafe(batchSize);
    let offset = 0;

    // Записать количество пакетов
    batch.writeUInt16BE(packets.length, offset);
    offset += 2;

    // Записать каждый пакет
    for (const packet of packets) {
      batch.writeUInt16BE(packet.length, offset);
      offset += 2;
      packet.copy(batch, offset);
      offset += packet.length;
    }

    // Отправить батч
    this.ws.send(batch, { binary: true });
    logger.debug('Packet batch sent', { packetCount: packets.length, batchSize });
  }

  sendControl(action: string, payload?: any, compress: boolean = true): void {
    if (!this.isConnected || !this.ws) {
      throw new NetworkError('WebSocket not connected');
    }

    const message = {
      type: 'control',
      sessionId: this.options.sessionId,
      direction: 'server',
      payload: {
        action,
        ...payload,
      },
    };

    const jsonString = JSON.stringify(message);

    if (compress && jsonString.length > 100) {
      // Сжать большие control messages
      gzipAsync(Buffer.from(jsonString))
        .then((compressed) => {
          const compressedMessage = {
            type: 'control',
            compressed: true,
            data: compressed.toString('base64'),
          };
          this.ws!.send(JSON.stringify(compressedMessage));
        })
        .catch((error) => {
          logger.error('Failed to compress control message', { error });
          // Fallback на несжатое сообщение
          this.ws!.send(jsonString);
        });
    } else {
      this.ws.send(jsonString);
    }
  }

  private sendHeartbeat(): void {
    if (!this.isConnected || !this.ws) {
      return;
    }

    const message: RelayMessage = {
      type: 'heartbeat',
      sessionId: this.options.sessionId,
      direction: 'server',
      payload: {
        timestamp: Date.now(),
      },
    };

    this.ws.send(JSON.stringify(message));
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }

    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat();
    }, this.heartbeatInterval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.reconnectAttempts++;
    const delay = this.options.reconnectInterval * Math.pow(2, this.reconnectAttempts - 1); // Exponential backoff

    logger.info(`Scheduling WebSocket reconnect attempt ${this.reconnectAttempts} in ${delay}ms`);

    this.reconnectTimer = setTimeout(() => {
      this.connect().catch((error) => {
        logger.error('Reconnect attempt failed', { error, attempt: this.reconnectAttempts });
        if (this.reconnectAttempts < this.options.maxReconnectAttempts) {
          this.scheduleReconnect();
        } else {
          logger.error('Max reconnect attempts reached');
          this.emit('maxReconnectAttemptsReached');
        }
      });
    }, delay);
  }

  disconnect(): void {
    this.stopHeartbeat();
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    // Отправить оставшиеся пакеты в батче
    if (this.packetBuffer.length > 0) {
      this.flushBatch();
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.isConnected = false;
    this.emit('disconnected');
  }

  isConnectedToRelay(): boolean {
    return this.isConnected && this.ws?.readyState === WebSocket.OPEN;
  }

  getSessionId(): string {
    return this.options.sessionId;
  }
}

