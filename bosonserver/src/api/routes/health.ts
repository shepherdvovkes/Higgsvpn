import { Router, Request, Response, Express } from 'express';
import { db } from '../../database/postgres';
import { redis } from '../../database/redis';
import { TurnManager } from '../../services/turn/TurnManager';
import { RelayService } from '../../services/relay/RelayService';
import { logger } from '../../utils/logger';

interface ExpressApp {
  get: (key: string) => any;
}

const router = Router();

interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  services: {
    database: { status: string; latency?: number };
    redis: { status: string; latency?: number };
    turn: { status: string };
    relay: { status: string; connections: number };
  };
}

// GET /health
router.get('/', async (req: Request & { app?: ExpressApp }, res: Response) => {
  const startTime = Date.now();
  const health: HealthCheckResult = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    services: {
      database: { status: 'unknown' },
      redis: { status: 'unknown' },
      turn: { status: 'unknown' },
      relay: { status: 'unknown', connections: 0 },
    },
  };

  // Check PostgreSQL
  try {
    const dbStart = Date.now();
    await db.query('SELECT 1');
    health.services.database = {
      status: 'healthy',
      latency: Date.now() - dbStart,
    };
  } catch (error) {
    health.services.database = { status: 'unhealthy' };
    health.status = 'unhealthy';
    logger.error('Database health check failed', { error });
  }

  // Check Redis
  try {
    const redisStart = Date.now();
    await redis.getClient().ping();
    health.services.redis = {
      status: 'healthy',
      latency: Date.now() - redisStart,
    };
  } catch (error) {
    health.services.redis = { status: 'unhealthy' };
    health.status = 'unhealthy';
    logger.error('Redis health check failed', { error });
  }

  // Check TURN
  try {
    const turnManager = req.app?.get('turnManager') as TurnManager | undefined;
    const isValid = turnManager ? await turnManager.validateTurnConnection() : false;
    health.services.turn = {
      status: isValid ? 'healthy' : 'degraded',
    };
    if (!isValid) {
      health.status = health.status === 'healthy' ? 'degraded' : health.status;
    }
  } catch (error) {
    health.services.turn = { status: 'unhealthy' };
    health.status = 'unhealthy';
    logger.error('TURN health check failed', { error });
  }

  // Check Relay
  try {
    const relayService = req.app?.get('relayService') as RelayService | undefined;
    const connections = relayService ? relayService.getActiveConnectionsCount() : 0;
    health.services.relay = {
      status: 'healthy',
      connections,
    };
  } catch (error) {
    health.services.relay = { status: 'unhealthy', connections: 0 };
    health.status = 'unhealthy';
    logger.error('Relay health check failed', { error });
  }

  const statusCode = health.status === 'healthy' ? 200 : health.status === 'degraded' ? 200 : 503;
  res.status(statusCode).json(health);
});

// GET /health/ready (readiness probe)
router.get('/ready', async (req: Request & { app?: ExpressApp }, res: Response) => {
  try {
    // Check critical services
    await db.query('SELECT 1');
    await redis.getClient().ping();
    
    res.status(200).json({ status: 'ready' });
  } catch (error) {
    logger.error('Readiness check failed', { error });
    res.status(503).json({ status: 'not ready' });
  }
});

// GET /health/live (liveness probe)
router.get('/live', (req: Request, res: Response) => {
  res.status(200).json({ status: 'alive', uptime: process.uptime() });
});

export default router;

