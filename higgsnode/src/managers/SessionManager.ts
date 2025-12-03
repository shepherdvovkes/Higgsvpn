import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';

export interface ClientSession {
  sessionId: string;
  clientId: string;
  publicKey: string;
  allowedIps: string;
  endpoint?: string;
  connectedAt: Date;
  lastActivity: Date;
  status: 'active' | 'disconnected' | 'error';
}

export class SessionManager extends EventEmitter {
  private sessions: Map<string, ClientSession> = new Map();
  private cleanupTimer: NodeJS.Timeout | null = null;
  private cleanupInterval = 60000; // 1 minute
  private sessionTimeout = 300000; // 5 minutes

  constructor() {
    super();
  }

  start(): void {
    if (this.cleanupTimer) {
      return;
    }

    logger.info('Starting session manager');
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.cleanupInterval);
  }

  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
      logger.info('Session manager stopped');
    }
  }

  createSession(
    clientId: string,
    publicKey: string,
    allowedIps: string,
    endpoint?: string
  ): ClientSession {
    const sessionId = uuidv4();
    const now = new Date();

    const session: ClientSession = {
      sessionId,
      clientId,
      publicKey,
      allowedIps,
      endpoint,
      connectedAt: now,
      lastActivity: now,
      status: 'active',
    };

    this.sessions.set(sessionId, session);
    logger.info('Session created', { sessionId, clientId });
    this.emit('sessionCreated', session);

    return session;
  }

  getSession(sessionId: string): ClientSession | undefined {
    return this.sessions.get(sessionId);
  }

  getSessionByClientId(clientId: string): ClientSession | undefined {
    for (const session of this.sessions.values()) {
      if (session.clientId === clientId) {
        return session;
      }
    }
    return undefined;
  }

  updateSessionActivity(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivity = new Date();
      this.sessions.set(sessionId, session);
    }
  }

  disconnectSession(sessionId: string, reason?: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    session.status = 'disconnected';
    logger.info('Session disconnected', { sessionId, reason });
    this.emit('sessionDisconnected', session, reason);
  }

  removeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.sessions.delete(sessionId);
      logger.info('Session removed', { sessionId });
      this.emit('sessionRemoved', session);
    }
  }

  getAllSessions(): ClientSession[] {
    return Array.from(this.sessions.values());
  }

  getActiveSessions(): ClientSession[] {
    return Array.from(this.sessions.values()).filter((s) => s.status === 'active');
  }

  getActiveSessionCount(): number {
    return this.getActiveSessions().length;
  }

  private cleanup(): void {
    const now = Date.now();
    const sessionsToRemove: string[] = [];

    for (const [sessionId, session] of this.sessions.entries()) {
      const timeSinceActivity = now - session.lastActivity.getTime();

      // Remove inactive sessions
      if (timeSinceActivity > this.sessionTimeout) {
        sessionsToRemove.push(sessionId);
      }
    }

    for (const sessionId of sessionsToRemove) {
      const session = this.sessions.get(sessionId);
      if (session) {
        logger.info('Removing inactive session', { sessionId, lastActivity: session.lastActivity });
        this.removeSession(sessionId);
      }
    }

    if (sessionsToRemove.length > 0) {
      logger.debug('Session cleanup completed', { removed: sessionsToRemove.length });
    }
  }
}

