import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { MetricsService } from '../../services/metrics/MetricsService';
import { logger } from '../../utils/logger';
import { ValidationError } from '../../utils/errors';

const router = Router();

const metricsSubmissionSchema = z.object({
  nodeId: z.string().uuid(),
  timestamp: z.number().optional(),
  metrics: z.object({
    network: z.object({
      latency: z.number().min(0),
      jitter: z.number().min(0),
      packetLoss: z.number().min(0).max(100),
      bandwidth: z.object({
        up: z.number().min(0),
        down: z.number().min(0),
      }),
    }),
    system: z.object({
      cpuUsage: z.number().min(0).max(100),
      memoryUsage: z.number().min(0).max(100),
      diskUsage: z.number().min(0).max(100),
      loadAverage: z.number().min(0),
    }),
    wireguard: z.object({
      packets: z.object({
        sent: z.number().int().min(0),
        received: z.number().int().min(0),
        errors: z.number().int().min(0),
      }),
      bytes: z.object({
        sent: z.number().int().min(0),
        received: z.number().int().min(0),
      }),
    }),
    connections: z.object({
      active: z.number().int().min(0),
      total: z.number().int().min(0),
      failed: z.number().int().min(0),
    }),
  }),
});

// POST /api/v1/metrics
router.post('/', async (req: Request, res: Response, next: any) => {
  try {
    const metricsService = req.app.get('metricsService') as MetricsService;
    
    const validatedData = metricsSubmissionSchema.parse(req.body);
    await metricsService.submitMetrics(validatedData);
    
    res.status(201).json({ status: 'ok' });
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(new ValidationError(error.errors.map(e => e.message).join(', ')));
    } else {
      next(error);
    }
  }
});

// GET /api/v1/metrics/:nodeId/latest
router.get('/:nodeId/latest', async (req: Request, res: Response, next: any) => {
  try {
    const metricsService = req.app.get('metricsService') as MetricsService;
    const { nodeId } = req.params;
    
    const metrics = await metricsService.getLatestMetrics(nodeId);
    if (!metrics) {
      res.status(404).json({ error: 'Metrics not found' });
      return;
    }
    
    res.json(metrics);
  } catch (error) {
    next(error);
  }
});

// GET /api/v1/metrics/:nodeId/history
router.get('/:nodeId/history', async (req: Request, res: Response, next: any) => {
  try {
    const metricsService = req.app.get('metricsService') as MetricsService;
    const { nodeId } = req.params;
    const startTime = req.query.startTime ? new Date(req.query.startTime as string) : new Date(Date.now() - 24 * 60 * 60 * 1000);
    const endTime = req.query.endTime ? new Date(req.query.endTime as string) : new Date();
    const interval = (req.query.interval as 'minute' | 'hour' | 'day') || 'hour';
    
    const metrics = await metricsService.getMetricsHistory(nodeId, startTime, endTime, interval);
    
    res.json({ metrics, count: metrics.length });
  } catch (error) {
    next(error);
  }
});

// GET /api/v1/metrics/:nodeId/aggregated
router.get('/:nodeId/aggregated', async (req: Request, res: Response, next: any) => {
  try {
    const metricsService = req.app.get('metricsService') as MetricsService;
    const { nodeId } = req.params;
    const startTime = req.query.startTime ? new Date(req.query.startTime as string) : new Date(Date.now() - 24 * 60 * 60 * 1000);
    const endTime = req.query.endTime ? new Date(req.query.endTime as string) : new Date();
    
    const aggregated = await metricsService.getAggregatedMetrics(nodeId, startTime, endTime);
    
    res.json(aggregated);
  } catch (error) {
    next(error);
  }
});

// GET /metrics (Prometheus endpoint)
router.get('/prometheus', async (req: Request, res: Response, next: any) => {
  try {
    const metricsService = req.app.get('metricsService') as MetricsService;
    const metrics = await metricsService.getPrometheusMetrics();
    
    res.set('Content-Type', 'text/plain; version=0.0.4');
    res.send(metrics);
  } catch (error) {
    next(error);
  }
});

export default router;

