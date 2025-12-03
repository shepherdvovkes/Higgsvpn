import { Router, Request, Response } from 'express';
import { db } from '../../database/postgres';
import { logger } from '../../utils/logger';
import { RelayService } from '../../services/relay/RelayService';
import { WireGuardServer } from '../../services/wireguard/WireGuardServer';

const router = Router();

interface ClientInfo {
  clientId: string;
  nodeId: string;
  routeId: string | null;
  status: string;
  createdAt: Date;
  expiresAt: Date;
  clientAddress?: string;
  clientPort?: number;
  lastSeen?: number;
  networkInfo?: {
    ipv4: string;
    natType: string;
    stunMappedAddress?: string | null;
  };
  requirements?: {
    minBandwidth?: number;
    maxLatency?: number;
    preferredLocation?: string;
    preferredCountry?: string;
  };
}

// GET /api/v1/clients - Get all active clients
router.get('/', async (req: Request, res: Response, next: any) => {
  try {
    const relayService = req.app.get('relayService') as RelayService;
    const wireGuardServer = req.app.get('wireGuardServer') as WireGuardServer;

    // Get active sessions from database
    const sessions = await db.query<{
      session_id: string;
      node_id: string;
      client_id: string;
      route_id: string | null;
      status: string;
      created_at: Date;
      expires_at: Date;
    }>(
      `SELECT * FROM sessions 
       WHERE status = 'active' AND expires_at > NOW()
       ORDER BY created_at DESC`
    );

    // Get routes to extract client network info (if columns exist)
    let routes: any[] = [];
    try {
      routes = await db.query<{
        id: string;
        client_id: string;
        client_network_info: any;
        requirements: any;
      }>(
        `SELECT id, client_id, client_network_info, requirements FROM routes 
         WHERE expires_at > NOW() AND client_id IS NOT NULL`
      );
    } catch (error: any) {
      // If columns don't exist, skip route info
      logger.debug('Routes table does not have client info columns yet', { error: error.message });
    }

    const routeMap = new Map(routes.map(r => [r.id, r]));
    const clientRouteMap = new Map(routes.map(r => [r.client_id, r]));

    // Build client info list
    const clients: ClientInfo[] = sessions.map(session => {
      const route = routeMap.get(session.route_id || '') || clientRouteMap.get(session.client_id);
      const clientInfo: ClientInfo = {
        clientId: session.client_id,
        nodeId: session.node_id,
        routeId: session.route_id,
        status: session.status,
        createdAt: session.created_at,
        expiresAt: session.expires_at,
      };

      if (route?.client_network_info) {
        try {
          clientInfo.networkInfo = typeof route.client_network_info === 'string' 
            ? JSON.parse(route.client_network_info) 
            : route.client_network_info;
        } catch (e) {
          // Ignore parse errors
        }
      }

      if (route?.requirements) {
        try {
          clientInfo.requirements = typeof route.requirements === 'string'
            ? JSON.parse(route.requirements)
            : route.requirements;
        } catch (e) {
          // Ignore parse errors
        }
      }

      return clientInfo;
    });

    res.json({ clients, count: clients.length });
  } catch (error) {
    next(error);
  }
});

// GET /api/v1/clients/:clientId - Get specific client info
router.get('/:clientId', async (req: Request, res: Response, next: any) => {
  try {
    const { clientId } = req.params;

    // Get session
    const sessions = await db.query<{
      session_id: string;
      node_id: string;
      client_id: string;
      route_id: string | null;
      status: string;
      created_at: Date;
      expires_at: Date;
    }>(
      `SELECT * FROM sessions 
       WHERE client_id = $1 AND expires_at > NOW()
       ORDER BY created_at DESC
       LIMIT 1`,
      [clientId]
    );

    if (sessions.length === 0) {
      res.status(404).json({ error: 'Client not found' });
      return;
    }

    const session = sessions[0];

    // Get route info
    let networkInfo = null;
    let requirements = null;
    const routes = await db.query<{
      client_network_info: any;
      requirements: any;
    }>(
      `SELECT client_network_info, requirements FROM routes 
       WHERE (id = $1 OR client_id = $2) AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [session.route_id || '', session.client_id]
    );

    if (routes.length > 0) {
      try {
        networkInfo = typeof routes[0].client_network_info === 'string'
          ? JSON.parse(routes[0].client_network_info)
          : routes[0].client_network_info;
        requirements = typeof routes[0].requirements === 'string'
          ? JSON.parse(routes[0].requirements)
          : routes[0].requirements;
      } catch (e) {
        // Ignore parse errors
      }
    }

    const clientInfo: ClientInfo = {
      clientId: session.client_id,
      nodeId: session.node_id,
      routeId: session.route_id,
      status: session.status,
      createdAt: session.created_at,
      expiresAt: session.expires_at,
      networkInfo,
      requirements,
    };

    res.json(clientInfo);
  } catch (error) {
    next(error);
  }
});

export default router;

