import { SessionManager } from './SessionManager';
import { WebSocketRelay } from './WebSocketRelay';
import { logger } from '../../utils/logger';
import { v4 as uuidv4 } from 'uuid';

export class RelayService {
  private sessionManager: SessionManager;
  private webSocketRelay: WebSocketRelay | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private readonly CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

  constructor() {
    this.sessionManager = new SessionManager();
  }

  initializeWebSocket(server: any): void {
    if (this.webSocketRelay) {
      logger.warn('WebSocket relay already initialized');
      return;
    }

    this.webSocketRelay = new WebSocketRelay(server, this.sessionManager);
    this.startCleanupTask();
    logger.info('Relay service initialized');
  }

  async createRelaySession(
    nodeId: string,
    clientId: string,
    routeId: string,
    ttl: number = 3600
  ): Promise<{
    sessionId: string;
    relayEndpoint: string;
    expiresAt: number;
  }> {
    try {
      const sessionId = uuidv4();
      const expiresAt = new Date(Date.now() + ttl * 1000);
      // Использовать правильный хост и протокол
      const relayHost = process.env.RELAY_HOST || 
        process.env.WIREGUARD_SERVER_HOST || 
        (process.env.PORT === '3003' ? 'mail.s0me.uk' : 'localhost');
      const relayPort = process.env.RELAY_PORT || process.env.PORT || '3000';
      // Использовать ws:// для HTTP или wss:// для HTTPS
      const relayProtocol = process.env.RELAY_PROTOCOL || 
        (relayPort === '3003' || relayHost.includes('localhost') ? 'ws' : 'wss');
      const relayEndpoint = `${relayProtocol}://${relayHost}:${relayPort}/relay/${sessionId}`;

      await this.sessionManager.createSession(
        sessionId,
        nodeId,
        clientId,
        routeId,
        expiresAt
      );

      logger.info('Relay session created', { sessionId, nodeId, clientId });

      return {
        sessionId,
        relayEndpoint,
        expiresAt: expiresAt.getTime(),
      };
    } catch (error) {
      logger.error('Failed to create relay session', { error, nodeId, clientId });
      throw error;
    }
  }

  async getSession(sessionId: string) {
    return this.sessionManager.getSession(sessionId);
  }

  async sendToSession(sessionId: string, data: Buffer | string): Promise<boolean> {
    if (!this.webSocketRelay) {
      return false;
    }
    return this.webSocketRelay.sendToSession(sessionId, data);
  }

  getActiveConnectionsCount(): number {
    if (!this.webSocketRelay) {
      return 0;
    }
    return this.webSocketRelay.getActiveConnectionsCount();
  }

  getActiveWebSocketSessionIds(): Set<string> {
    if (!this.webSocketRelay) {
      return new Set();
    }
    return this.webSocketRelay.getActiveSessionIds();
  }

  hasActiveWebSocketConnection(sessionId: string): boolean {
    if (!this.webSocketRelay) {
      return false;
    }
    return this.webSocketRelay.hasActiveConnection(sessionId);
  }

  private startCleanupTask(): void {
    if (this.cleanupInterval) {
      return;
    }

    this.cleanupInterval = setInterval(async () => {
      try {
        await this.sessionManager.cleanupExpiredSessions();
      } catch (error) {
        logger.error('Relay cleanup task failed', { error });
      }
    }, this.CLEANUP_INTERVAL_MS);

    logger.info('Relay cleanup task started');
  }

  stopCleanupTask(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      logger.info('Relay cleanup task stopped');
    }
  }

  close(): void {
    this.stopCleanupTask();
    if (this.webSocketRelay) {
      this.webSocketRelay.close();
      this.webSocketRelay = null;
    }
    logger.info('Relay service closed');
  }
}

