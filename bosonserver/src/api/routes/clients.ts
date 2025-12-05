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
  connectionType?: 'WireGuard' | 'WebSocket' | 'Unknown';
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

    // Get active WebSocket session IDs
    const activeWebSocketSessions = relayService.getActiveWebSocketSessionIds();

    // Get WireGuard client IDs first to check for closed sessions that should be included
    const wireGuardClientIds = wireGuardServer?.getRegisteredClientIds() || new Set<string>();
    
    // Get active sessions from database
    // Also include recently closed sessions (within last hour) if they have WireGuard registrations
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
       WHERE expires_at > NOW()
         AND (
           status = 'active' 
           OR (status = 'closed' 
               AND created_at > NOW() - INTERVAL '1 hour'
               AND client_id = ANY($1::text[]))
         )
       ORDER BY created_at DESC`,
      [Array.from(wireGuardClientIds)]
    );

    // Debug: Log session count and WireGuard client IDs
    logger.debug('Clients API', {
      sessionCount: sessions.length,
      wireGuardClientCount: wireGuardClientIds.size,
      wireGuardClientIds: Array.from(wireGuardClientIds),
      sessionClientIds: sessions.map(s => s.client_id),
    });

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
    // Include sessions that have active WebSocket connections OR WireGuard registrations
    // Filter out stale sessions that don't have active connections
    const clients: ClientInfo[] = sessions
      .filter(session => {
        // Include if has active WebSocket connection
        if (activeWebSocketSessions.has(session.session_id)) {
          return true;
        }
        // Or if registered as WireGuard client
        if (wireGuardServer && wireGuardServer.getClientSession(session.client_id)) {
          return true;
        }
        return false;
      })
      .map(session => {
        const route = routeMap.get(session.route_id || '') || clientRouteMap.get(session.client_id);
        
        // Determine connection type and get WireGuard info if available
        let connectionType: 'WireGuard' | 'WebSocket' | 'Unknown' = 'Unknown';
        const wgSession = wireGuardServer?.getClientSession(session.client_id);
        
        if (activeWebSocketSessions.has(session.session_id)) {
          connectionType = 'WebSocket';
        } else if (wgSession) {
          connectionType = 'WireGuard';
        }

        const clientInfo: ClientInfo = {
          clientId: session.client_id,
          nodeId: session.node_id,
          routeId: session.route_id,
          status: session.status,
          createdAt: session.created_at,
          expiresAt: session.expires_at,
          connectionType,
        };
        
        // Add WireGuard client info if available
        if (wgSession) {
          clientInfo.clientAddress = wgSession.address;
          clientInfo.clientPort = wgSession.port;
        }

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
    const relayService = req.app.get('relayService') as RelayService;
    const wireGuardServer = req.app.get('wireGuardServer') as WireGuardServer;

    // Get active WebSocket session IDs
    const activeWebSocketSessions = relayService.getActiveWebSocketSessionIds();

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
    
    // Determine connection type
    let connectionType: 'WireGuard' | 'WebSocket' | 'Unknown' = 'Unknown';
    if (activeWebSocketSessions.has(session.session_id)) {
      connectionType = 'WebSocket';
    } else if (wireGuardServer) {
      connectionType = 'WireGuard';
    }

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
      connectionType,
      networkInfo,
      requirements,
    };

    res.json(clientInfo);
  } catch (error) {
    next(error);
  }
});

export default router;

