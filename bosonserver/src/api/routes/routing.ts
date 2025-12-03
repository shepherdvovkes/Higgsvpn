import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { RoutingService } from '../../services/routing/RoutingService';
import { logger } from '../../utils/logger';
import { ValidationError } from '../../utils/errors';

const router = Router();

const routingRequestSchema = z.object({
  clientId: z.string().uuid(),
  targetNodeId: z.string().uuid().nullable().optional(),
  requirements: z.object({
    minBandwidth: z.number().min(0).optional(),
    maxLatency: z.number().min(0).optional(),
    preferredLocation: z.string().optional(),
    preferredCountry: z.string().length(2).optional(),
  }).optional(),
  clientNetworkInfo: z.object({
    ipv4: z.string().ip(),
    natType: z.enum(['FullCone', 'RestrictedCone', 'PortRestricted', 'Symmetric']),
    stunMappedAddress: z.string().nullable().optional(),
  }),
});

// POST /api/v1/routing/request
router.post('/request', async (req: Request, res: Response, next: any) => {
  try {
    const routingService = req.app.get('routingService') as RoutingService;
    
    const validatedData = routingRequestSchema.parse(req.body);
    const response = await routingService.requestRoute(validatedData);
    
    res.json(response);
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(new ValidationError(error.errors.map(e => e.message).join(', ')));
    } else {
      next(error);
    }
  }
});

// GET /api/v1/routing/route/:routeId
router.get('/route/:routeId', async (req: Request, res: Response, next: any) => {
  try {
    const routingService = req.app.get('routingService') as RoutingService;
    const { routeId } = req.params;
    
    const route = await routingService.getRoute(routeId);
    if (!route) {
      res.status(404).json({ error: 'Route not found' });
      return;
    }
    
    res.json(route);
  } catch (error) {
    next(error);
  }
});

export default router;

