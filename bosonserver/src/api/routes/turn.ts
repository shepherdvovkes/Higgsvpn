import { Router, Request, Response } from 'express';
import { TurnManager } from '../../services/turn/TurnManager';
import { logger } from '../../utils/logger';

const router = Router();

// GET /api/v1/turn/servers
router.get('/servers', async (req: Request, res: Response, next: any) => {
  try {
    const turnManager = req.app.get('turnManager') as TurnManager;
    const clientIp = req.ip || req.headers['x-forwarded-for'] as string;
    
    const servers = await turnManager.getTurnServers(clientIp);
    
    res.json({ servers });
  } catch (error) {
    next(error);
  }
});

// GET /api/v1/turn/stun
router.get('/stun', async (req: Request, res: Response, next: any) => {
  try {
    const turnManager = req.app.get('turnManager') as TurnManager;
    const servers = await turnManager.getStunServers();
    
    res.json({ servers });
  } catch (error) {
    next(error);
  }
});

// GET /api/v1/turn/ice
router.get('/ice', async (req: Request, res: Response, next: any) => {
  try {
    const turnManager = req.app.get('turnManager') as TurnManager;
    const clientIp = req.ip || req.headers['x-forwarded-for'] as string;
    
    const servers = await turnManager.getIceServers();
    
    res.json({ iceServers: servers });
  } catch (error) {
    next(error);
  }
});

export default router;

