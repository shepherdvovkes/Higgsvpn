import { WebSocket, WebSocketServer } from 'ws';
import { EventEmitter } from 'events';
import { SessionManager, RelaySession } from './SessionManager';
import { logger } from '../../utils/logger';
import { IncomingMessage } from 'http';

export interface RelayMessage {
  type: 'data' | 'control' | 'heartbeat';
  sessionId: string;
  direction: 'client-to-node' | 'node-to-client';
  payload: Buffer | any;
}

export class WebSocketRelay extends EventEmitter {
  private wss: WebSocketServer;
  private sessionManager: SessionManager;
  private connections = new Map<string, WebSocket>();
  private readonly HEARTBEAT_INTERVAL = 30000; // 30 seconds
  private heartbeatIntervals = new Map<string, NodeJS.Timeout>();

  constructor(server: any, sessionManager: SessionManager) {
    super();
    this.sessionManager = sessionManager;
    this.wss = new WebSocketServer({ 
      server,
      path: '/relay',
    });

    this.wss.on('connection', this.handleConnection.bind(this));
    logger.info('WebSocket relay server started');
  }

  private async handleConnection(ws: WebSocket, req: IncomingMessage): Promise<void> {
    try {
      const url = new URL(req.url || '', `http://${req.headers.host}`);
      const sessionId = url.pathname.split('/').pop();

      if (!sessionId) {
        logger.warn('Connection rejected: missing session ID');
        ws.close(1008, 'Missing session ID');
        return;
      }

      // Verify session
      const session = await this.sessionManager.getSession(sessionId);
      if (!session || session.status !== 'active') {
        logger.warn('Connection rejected: invalid session', { sessionId });
        ws.close(1008, 'Invalid session');
        return;
      }

      // Store connection
      this.connections.set(sessionId, ws);

      // Setup heartbeat
      this.setupHeartbeat(sessionId, ws);

      // Handle messages
      ws.on('message', (data: Buffer) => {
        this.handleMessage(sessionId, data, ws);
      });

      // Handle close
      ws.on('close', () => {
        this.handleDisconnection(sessionId);
      });

      // Handle errors
      ws.on('error', (error) => {
        logger.error('WebSocket error', { error, sessionId });
        this.handleDisconnection(sessionId);
      });

      // Send connection confirmation
      ws.send(JSON.stringify({
        type: 'control',
        sessionId,
        direction: 'server',
        payload: { action: 'connected' },
      }));

      logger.info('WebSocket connection established', { sessionId });
    } catch (error) {
      logger.error('Failed to handle connection', { error });
      ws.close(1011, 'Internal server error');
    }
  }

  private handleMessage(sessionId: string, data: Buffer, ws: WebSocket): void {
    try {
      // Проверить, является ли это батчем (начинается с uint16)
      if (data.length >= 2) {
        const packetCount = data.readUInt16BE(0);
        
        // Если это батч (больше 1 пакета)
        if (packetCount > 1 && packetCount < 100) { // Разумный лимит
          this.handleBatch(sessionId, data, ws);
          return;
        }
      }

      // Если данные бинарные (WireGuard пакет), обработать напрямую
      if (Buffer.isBuffer(data) && data.length > 0) {
        // Проверить, что это WireGuard пакет (первый байт обычно 0x01-0x04)
        const firstByte = data[0];
        if (firstByte >= 0x01 && firstByte <= 0x04) {
          // Это WireGuard пакет, переслать напрямую
          this.handleSinglePacket(sessionId, data, ws);
          return;
        }
      }

      // Попытаться распарсить как JSON (control/heartbeat messages)
      try {
        const message = JSON.parse(data.toString());
        
        // Проверить, является ли это сжатым control message
        if (message.type === 'control' && message.compressed) {
          this.handleCompressedControl(sessionId, message, ws);
          return;
        }

        // Handle different message types
        switch (message.type) {
          case 'data':
            this.handleDataMessage(sessionId, message, ws);
            break;
          case 'control':
            this.handleControlMessage(sessionId, message, ws);
            break;
          case 'heartbeat':
            this.handleHeartbeat(sessionId, ws);
            break;
          default:
            logger.warn('Unknown message type', { sessionId, type: message.type });
        }
      } catch {
        // Если не JSON и не WireGuard, обработать как бинарные данные
        this.handleSinglePacket(sessionId, data, ws);
      }
    } catch (error) {
      logger.error('Failed to handle message', { error, sessionId });
    }
  }

  private handleBatch(sessionId: string, batch: Buffer, ws: WebSocket): void {
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
      this.handleSinglePacket(sessionId, packet, ws);
    }

    logger.debug('Batch processed', { sessionId, packetCount });
  }

  private handleSinglePacket(sessionId: string, data: Buffer, ws: WebSocket): void {
    // Существующая логика обработки одиночного пакета
    const message: RelayMessage = {
      type: 'data',
      sessionId,
      direction: 'client-to-node', // Будет определено из сессии
      payload: data,
    };
    this.handleDataMessage(sessionId, message, ws);
  }

  private async handleCompressedControl(sessionId: string, message: any, ws: WebSocket): Promise<void> {
    try {
      const { gunzip } = require('zlib');
      const { promisify } = require('util');
      const gunzipAsync = promisify(gunzip);

      const compressed = Buffer.from(message.data, 'base64');
      const decompressed = await gunzipAsync(compressed);
      const decompressedMessage = JSON.parse(decompressed.toString());
      this.handleControlMessage(sessionId, decompressedMessage, ws);
    } catch (error) {
      logger.error('Failed to decompress control message', { error, sessionId });
    }
  }

  private handleDataMessage(sessionId: string, message: RelayMessage, ws: WebSocket): void {
    try {
      // Get session to determine direction
      this.sessionManager.getSession(sessionId).then((session) => {
        if (!session) {
          logger.warn('Session not found for data message', { sessionId });
          return;
        }

        const packet = Buffer.isBuffer(message.payload) 
          ? message.payload 
          : Buffer.from(message.payload);

        // Determine direction based on session and message
        // If direction is client-to-node, forward to node
        // If direction is node-to-client, forward to client
        if (message.direction === 'client-to-node') {
          // Forward packet to node via API
          this.forwardPacketToNode(session.nodeId, sessionId, packet);
        } else if (message.direction === 'node-to-client') {
          // Forward packet to client via WireGuard UDP or WebSocket
          this.forwardPacketToClient(session.clientId, sessionId, packet);
        } else {
          // Try to determine direction from session
          // If this WebSocket is from node, it's node-to-client
          // If this WebSocket is from client, it's client-to-node
          // For now, assume it's client-to-node if we can't determine
          this.forwardPacketToNode(session.nodeId, sessionId, packet);
        }
      }).catch((error) => {
        logger.error('Failed to handle data message', { error, sessionId });
      });
    } catch (error) {
      logger.error('Failed to handle data message', { error, sessionId });
    }
  }

  private async forwardPacketToNode(nodeId: string, sessionId: string, packet: Buffer): Promise<void> {
    try {
      // Get node info to find its API endpoint
      // This should be available through DiscoveryService
      // For now, emit event that will be handled by WireGuardServer or RelayService
      this.emit('packetToNode', {
        nodeId,
        sessionId,
        packet,
      });
    } catch (error) {
      logger.error('Failed to forward packet to node', { error, nodeId, sessionId });
    }
  }

  private async forwardPacketToClient(clientId: string, sessionId: string, packet: Buffer): Promise<void> {
    try {
      // Find client's WebSocket connection or WireGuard UDP address
      // For WebSocket clients, send directly
      const clientWs = this.connections.get(sessionId);
      if (clientWs && clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(packet);
        return;
      }

      // If no WebSocket, try WireGuard UDP
      // This will be handled by WireGuardServer
      this.emit('packetToClient', {
        clientId,
        sessionId,
        packet,
      });
    } catch (error) {
      logger.error('Failed to forward packet to client', { error, clientId, sessionId });
    }
  }

  private handleControlMessage(sessionId: string, message: RelayMessage, ws: WebSocket): void {
    const { action } = message.payload as any;

    switch (action) {
      case 'connect':
        logger.info('Control: connect', { sessionId });
        break;
      case 'disconnect':
        logger.info('Control: disconnect', { sessionId });
        this.handleDisconnection(sessionId);
        break;
      default:
        logger.warn('Unknown control action', { sessionId, action });
    }
  }

  private handleHeartbeat(sessionId: string, ws: WebSocket): void {
    // Respond to heartbeat
    ws.send(JSON.stringify({
      type: 'heartbeat',
      sessionId,
      direction: 'server',
      payload: { timestamp: Date.now() },
    }));
  }

  private setupHeartbeat(sessionId: string, ws: WebSocket): void {
    const interval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'heartbeat',
          sessionId,
          direction: 'server',
          payload: { timestamp: Date.now() },
        }));
      } else {
        clearInterval(interval);
        this.heartbeatIntervals.delete(sessionId);
      }
    }, this.HEARTBEAT_INTERVAL);

    this.heartbeatIntervals.set(sessionId, interval);
  }

  private async handleDisconnection(sessionId: string): Promise<void> {
    const interval = this.heartbeatIntervals.get(sessionId);
    if (interval) {
      clearInterval(interval);
      this.heartbeatIntervals.delete(sessionId);
    }

    this.connections.delete(sessionId);
    await this.sessionManager.closeSession(sessionId);

    logger.info('WebSocket connection closed', { sessionId });
  }

  async sendToSession(sessionId: string, data: Buffer | string): Promise<boolean> {
    const ws = this.connections.get(sessionId);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return false;
    }

    try {
      ws.send(data);
      return true;
    } catch (error) {
      logger.error('Failed to send to session', { error, sessionId });
      return false;
    }
  }

  getActiveConnectionsCount(): number {
    return this.connections.size;
  }

  close(): void {
    // Clear all intervals
    for (const interval of this.heartbeatIntervals.values()) {
      clearInterval(interval);
    }
    this.heartbeatIntervals.clear();

    // Close all connections
    for (const ws of this.connections.values()) {
      ws.close();
    }
    this.connections.clear();

    // Close server
    this.wss.close();
    logger.info('WebSocket relay server closed');
  }
}

