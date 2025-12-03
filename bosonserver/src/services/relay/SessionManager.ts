import { Session } from '../../database/models';
import { db } from '../../database/postgres';
import { redis } from '../../database/redis';
import { logger } from '../../utils/logger';

export interface RelaySession {
  sessionId: string;
  nodeId: string;
  clientId: string;
  routeId: string;
  status: 'active' | 'closed' | 'error';
  createdAt: Date;
  expiresAt: Date;
  relayEndpoint?: string;
}

export class SessionManager {
  private readonly CACHE_TTL = 3600; // 1 hour
  private activeSessions = new Map<string, RelaySession>();

  async createSession(
    sessionId: string,
    nodeId: string,
    clientId: string,
    routeId: string,
    expiresAt: Date
  ): Promise<RelaySession> {
    try {
      const session: RelaySession = {
        sessionId,
        nodeId,
        clientId,
        routeId,
        status: 'active',
        createdAt: new Date(),
        expiresAt,
      };

      // Store in database
      await db.query(
        `INSERT INTO sessions (session_id, node_id, client_id, route_id, status, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (session_id) DO UPDATE SET
           status = EXCLUDED.status,
           expires_at = EXCLUDED.expires_at`,
        [
          session.sessionId,
          session.nodeId,
          session.clientId,
          session.routeId,
          session.status,
          session.expiresAt,
        ]
      );

      // Cache session
      await redis.set(`session:${sessionId}`, session, this.CACHE_TTL);
      this.activeSessions.set(sessionId, session);

      logger.info('Session created', { sessionId, nodeId, clientId });
      return session;
    } catch (error) {
      logger.error('Failed to create session', { error, sessionId });
      throw error;
    }
  }

  async getSession(sessionId: string): Promise<RelaySession | null> {
    try {
      // Check memory cache first
      const cached = this.activeSessions.get(sessionId);
      if (cached) {
        return cached;
      }

      // Check Redis cache
      const redisCached = await redis.get<RelaySession>(`session:${sessionId}`);
      if (redisCached) {
        this.activeSessions.set(sessionId, redisCached);
        return redisCached;
      }

      // Query database
      const result = await db.query<RelaySession>(
        'SELECT * FROM sessions WHERE session_id = $1 AND expires_at > NOW()',
        [sessionId]
      );

      if (result.length === 0) {
        return null;
      }

      const session = this.mapRowToSession(result[0]);
      await redis.set(`session:${sessionId}`, session, this.CACHE_TTL);
      this.activeSessions.set(sessionId, session);

      return session;
    } catch (error) {
      logger.error('Failed to get session', { error, sessionId });
      return null;
    }
  }

  async updateSessionStatus(
    sessionId: string,
    status: 'active' | 'closed' | 'error'
  ): Promise<void> {
    try {
      await db.query(
        'UPDATE sessions SET status = $1 WHERE session_id = $2',
        [status, sessionId]
      );

      const session = this.activeSessions.get(sessionId);
      if (session) {
        session.status = status;
        await redis.set(`session:${sessionId}`, session, this.CACHE_TTL);
      }

      logger.debug('Session status updated', { sessionId, status });
    } catch (error) {
      logger.error('Failed to update session status', { error, sessionId });
    }
  }

  async closeSession(sessionId: string): Promise<void> {
    await this.updateSessionStatus(sessionId, 'closed');
    this.activeSessions.delete(sessionId);
    await redis.del(`session:${sessionId}`);
    logger.info('Session closed', { sessionId });
  }

  async cleanupExpiredSessions(): Promise<number> {
    try {
      const result = await db.query<{ session_id: string }>(
        `DELETE FROM sessions WHERE expires_at < NOW() RETURNING session_id`
      );

      const deletedCount = result.length;
      for (const row of result) {
        this.activeSessions.delete(row.session_id);
        await redis.del(`session:${row.session_id}`);
      }

      logger.info('Cleaned up expired sessions', { count: deletedCount });
      return deletedCount;
    } catch (error) {
      logger.error('Failed to cleanup expired sessions', { error });
      return 0;
    }
  }

  private mapRowToSession(row: any): RelaySession {
    return {
      sessionId: row.session_id,
      nodeId: row.node_id,
      clientId: row.client_id,
      routeId: row.route_id,
      status: row.status,
      createdAt: new Date(row.created_at),
      expiresAt: new Date(row.expires_at),
      relayEndpoint: row.relay_endpoint || undefined,
    };
  }
}

