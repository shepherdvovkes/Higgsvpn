import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { ConnectionError } from '../utils/errors';

export interface RelayMessage {
  type: string;
  data?: any;
  sessionId?: string;
}

export class WebSocketRelay extends EventEmitter {
  private ws: WebSocket | null = null;
  private relayEndpoint: string;
  private sessionToken: string;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectInterval: number;
  private heartbeatInterval: number;
  private isConnected = false;

  constructor(
    relayEndpoint: string,
    sessionToken: string,
    reconnectInterval: number = 5000,
    heartbeatInterval: number = 30000
  ) {
    super();
    this.relayEndpoint = relayEndpoint;
    this.sessionToken = sessionToken;
    this.reconnectInterval = reconnectInterval;
    this.heartbeatInterval = heartbeatInterval;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        logger.info('Connecting to WebSocket relay', { endpoint: this.relayEndpoint });

        // Convert http/https to ws/wss
        const wsUrl = this.relayEndpoint.replace(/^http/, 'ws');
        this.ws = new WebSocket(wsUrl, {
          headers: {
            'Authorization': `Bearer ${this.sessionToken}`,
          },
        });

        this.ws.on('open', () => {
          logger.info('WebSocket relay connected');
          this.isConnected = true;
          this.startHeartbeat();
          this.emit('connected');
          resolve();
        });

        this.ws.on('message', (data: WebSocket.Data) => {
          try {
            // Check if data is binary (WireGuard packet) or text (JSON message)
            if (Buffer.isBuffer(data) || data instanceof Uint8Array) {
              // Binary WireGuard packet - emit directly
              const packet = Buffer.isBuffer(data) ? data : Buffer.from(data);
              // Check if it's a WireGuard packet (first byte 0x01-0x04)
              const firstByte = packet[0];
              if (firstByte >= 0x01 && firstByte <= 0x04) {
                logger.debug('Received WireGuard packet via WebSocket', { size: packet.length });
                this.emit('packet', packet);
              } else {
                // Try to parse as JSON
                try {
                  const message = JSON.parse(packet.toString()) as RelayMessage;
                  this.handleMessage(message);
                } catch {
                  // If not JSON, emit as packet anyway
                  this.emit('packet', packet);
                }
              }
            } else {
              // Text message - parse as JSON
              const message = JSON.parse(data.toString()) as RelayMessage;
              this.handleMessage(message);
            }
          } catch (error) {
            logger.error('Failed to handle WebSocket message', { error });
          }
        });

        this.ws.on('error', (error) => {
          logger.error('WebSocket relay error', { error });
          this.emit('error', error);
          if (!this.isConnected) {
            reject(new ConnectionError(`WebSocket connection failed: ${error.message}`));
          }
        });

        this.ws.on('close', (code, reason) => {
          logger.warn('WebSocket relay closed', { code, reason: reason.toString() });
          this.isConnected = false;
          this.stopHeartbeat();
          this.emit('disconnected', { code, reason });
          this.scheduleReconnect();
        });
      } catch (error: any) {
        reject(new ConnectionError(`Failed to create WebSocket: ${error.message}`));
      }
    });
  }

  private handleMessage(message: RelayMessage): void {
    logger.debug('Received WebSocket message', { type: message.type });

    switch (message.type) {
      case 'packet':
        this.emit('packet', message.data);
        break;
      case 'ping':
        this.send({ type: 'pong' });
        break;
      case 'error':
        logger.error('Relay error message', { error: message.data });
        this.emit('error', message.data);
        break;
      default:
        this.emit('message', message);
    }
  }

  send(message: RelayMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      logger.warn('Cannot send message: WebSocket not connected');
      return;
    }

    try {
      this.ws.send(JSON.stringify(message));
    } catch (error) {
      logger.error('Failed to send WebSocket message', { error });
    }
  }

  sendPacket(packet: Buffer | Uint8Array): void {
    this.send({
      type: 'packet',
      data: packet.toString('base64'),
    });
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.isConnected) {
        this.send({ type: 'ping' });
      }
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
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      logger.info('Attempting to reconnect WebSocket relay');
      this.connect().catch((error) => {
        logger.error('Reconnection failed', { error });
        this.scheduleReconnect();
      });
    }, this.reconnectInterval);
  }

  disconnect(): void {
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }

  isRelayConnected(): boolean {
    return this.isConnected && this.ws?.readyState === WebSocket.OPEN;
  }
}

