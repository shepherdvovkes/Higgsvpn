import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { DiscoveryService } from '../../services/discovery/DiscoveryService';
import { logger } from '../../utils/logger';
import { ValidationError, NotFoundError, UnauthorizedError } from '../../utils/errors';
import { nodeRateLimiter } from '../middleware/rateLimit';
import { getRealIp } from '../../utils/ipUtils';

const router = Router();

// Validation schemas
const registerNodeSchema = z.object({
  nodeId: z.string().uuid(),
  publicKey: z.string().min(1),
  networkInfo: z.object({
    ipv4: z.string().ip(),
    ipv6: z.string().ip().nullable(),
    natType: z.enum(['FullCone', 'RestrictedCone', 'PortRestricted', 'Symmetric']),
    stunMappedAddress: z.string().nullable(),
    localPort: z.number().int().min(1).max(65535),
    publicIp: z.string().ip().optional(), // Real/public IP from where node connects
  }),
  capabilities: z.object({
    maxConnections: z.number().int().min(1),
    bandwidth: z.object({
      up: z.number().min(0),
      down: z.number().min(0),
    }),
    routing: z.boolean(),
    natting: z.boolean(),
  }),
  metrics: z.object({
    latency: z.number().min(0),
    jitter: z.number().min(0),
    packetLoss: z.number().min(0).max(100),
    cpuUsage: z.number().min(0).max(100),
    memoryUsage: z.number().min(0).max(100),
  }).optional(),
  location: z.object({
    country: z.string().min(2).max(2),
    region: z.string(),
    coordinates: z.tuple([z.number(), z.number()]).nullable(),
  }),
  heartbeatInterval: z.number().int().min(10).max(300).optional(),
});

const heartbeatSchema = z.object({
  metrics: z.object({
    latency: z.number().min(0),
    jitter: z.number().min(0),
    packetLoss: z.number().min(0).max(100),
    cpuUsage: z.number().min(0).max(100),
    memoryUsage: z.number().min(0).max(100),
    activeConnections: z.number().int().min(0),
    bandwidth: z.object({
      up: z.number().min(0),
      down: z.number().min(0),
    }),
  }).optional(),
  status: z.enum(['online', 'degraded', 'offline']).optional(),
});

// Middleware to extract and verify JWT token
function authenticateNode(req: Request, res: Response, next: any): void {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedError('Missing or invalid authorization header');
    }

    const token = authHeader.substring(7);
    // Token verification will be done in the service layer if needed
    req.body.token = token;
    next();
  } catch (error) {
    next(error);
  }
}

// Note: getRealIp is now imported from utils/ipUtils

// POST /api/v1/nodes/register
// Используем nodeRateLimiter - регистрация может происходить при перезапуске ноды
router.post('/register', nodeRateLimiter, async (req: Request, res: Response, next: any) => {
  try {
    const discoveryService = req.app.get('discoveryService') as DiscoveryService;
    
    const validatedData = registerNodeSchema.parse(req.body);
    
    // Extract real IP from request (async to resolve server IP if needed)
    const realIp = await getRealIp(req);
    
    // Add real IP to networkInfo
    if (realIp && realIp !== 'unknown') {
      validatedData.networkInfo.publicIp = realIp;
      logger.debug('Node registration with public IP', { nodeId: validatedData.nodeId, publicIp: realIp });
    }
    
    const response = await discoveryService.registerNode(validatedData);
    
    res.status(201).json(response);
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(new ValidationError(error.errors.map(e => e.message).join(', ')));
    } else {
      next(error);
    }
  }
});

// POST /api/v1/nodes/:nodeId/heartbeat
// Используем nodeRateLimiter вместо стандартного - heartbeat отправляется часто
router.post('/:nodeId/heartbeat', nodeRateLimiter, authenticateNode, async (req: Request, res: Response, next: any) => {
  try {
    const discoveryService = req.app.get('discoveryService') as DiscoveryService;
    const { nodeId } = req.params;
    
    const validatedData = heartbeatSchema.parse(req.body);
    
    // Extract real IP from request and update if it has changed (async to resolve server IP if needed)
    const realIp = await getRealIp(req);
    if (realIp && realIp !== 'unknown') {
      await discoveryService.updateNodePublicIp(nodeId, realIp);
      logger.debug('Node heartbeat with public IP', { nodeId, publicIp: realIp });
    }
    
    const response = await discoveryService.processHeartbeat(nodeId, validatedData);
    
    res.json(response);
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(new ValidationError(error.errors.map(e => e.message).join(', ')));
    } else {
      next(error);
    }
  }
});

// GET /api/v1/nodes/:nodeId
router.get('/:nodeId', async (req: Request, res: Response, next: any) => {
  try {
    const discoveryService = req.app.get('discoveryService') as DiscoveryService;
    const { nodeId } = req.params;
    
    const node = await discoveryService.getNode(nodeId);
    if (!node) {
      throw new NotFoundError('Node');
    }
    
    res.json(node);
  } catch (error) {
    next(error);
  }
});

// GET /api/v1/nodes
router.get('/', async (req: Request, res: Response, next: any) => {
  try {
    const discoveryService = req.app.get('discoveryService') as DiscoveryService;
    const nodes = await discoveryService.getAllActiveNodes();
    
    res.json({ nodes, count: nodes.length });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/v1/nodes/:nodeId
router.delete('/:nodeId', authenticateNode, async (req: Request, res: Response, next: any) => {
  try {
    const discoveryService = req.app.get('discoveryService') as DiscoveryService;
    const { nodeId } = req.params;
    
    await discoveryService.deleteNode(nodeId);
    
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;

