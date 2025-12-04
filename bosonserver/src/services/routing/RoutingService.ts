import { RouteSelector, RouteRequirements, RouteSelection } from './RouteSelector';
import { LoadBalancer } from './LoadBalancer';
import { DiscoveryService } from '../discovery/DiscoveryService';
import { redis } from '../../database/redis';
import { db } from '../../database/postgres';
import { Route } from '../../database/models';
import { logger } from '../../utils/logger';
import { v4 as uuidv4 } from 'uuid';

export interface RoutingRequest {
  clientId: string;
  targetNodeId?: string | null;
  requirements?: RouteRequirements;
  clientNetworkInfo: {
    ipv4: string;
    natType: string;
    stunMappedAddress?: string | null;
  };
}

export interface RoutingResponse {
  routes: RouteSelection[];
  selectedRoute: {
    id: string;
    relayEndpoint: string;
    nodeEndpoint: {
      nodeId: string;
      directConnection: boolean;
    };
    sessionToken: string;
    expiresAt: number;
    wireguardConfig?: {
      serverPublicKey: string;
      serverEndpoint: string;
      serverPort?: number;
      allowedIPs?: string;
    };
  };
}

export class RoutingService {
  private routeSelector: RouteSelector;
  private loadBalancer: LoadBalancer;
  private discoveryService: DiscoveryService;
  private readonly CACHE_TTL = 300; // 5 minutes

  constructor(discoveryService: DiscoveryService) {
    this.routeSelector = new RouteSelector();
    this.loadBalancer = new LoadBalancer();
    this.discoveryService = discoveryService;
  }

  async requestRoute(request: RoutingRequest): Promise<RoutingResponse> {
    try {
      // Check cache first
      const cacheKey = `route:${request.clientId}:${request.targetNodeId || 'any'}`;
      const cached = await redis.get<RoutingResponse>(cacheKey);
      if (cached) {
        logger.debug('Route retrieved from cache', { clientId: request.clientId });
        return cached;
      }

      // Get available nodes
      const nodes = await this.discoveryService.getAllActiveNodes();
      if (nodes.length === 0) {
        throw new Error('No available nodes');
      }

      // Select route
      const selectedRoute = await this.routeSelector.selectRoute(
        nodes,
        request.clientNetworkInfo,
        request.requirements || {}
      );

      if (!selectedRoute) {
        throw new Error('Failed to select route');
      }

      // Get the target node
      const targetNode = nodes.find((n) => n.nodeId === selectedRoute.path[0]);
      if (!targetNode) {
        throw new Error('Target node not found');
      }

      // Generate session token and endpoint
      const sessionId = uuidv4();
      const expiresAt = Date.now() + 3600 * 1000; // 1 hour
      // Использовать правильный хост для relay endpoint
      const relayHost = process.env.RELAY_HOST || 
        process.env.WIREGUARD_SERVER_HOST || 
        (process.env.PORT === '3003' ? 'mail.s0me.uk' : 'localhost');
      const relayPort = process.env.RELAY_PORT || process.env.PORT || '3000';
      // Использовать ws:// для HTTP или wss:// для HTTPS
      // Если порт 3003 (HTTP), использовать ws://, иначе wss://
      const relayProtocol = process.env.RELAY_PROTOCOL || 
        (relayPort === '3003' || relayHost.includes('localhost') ? 'ws' : 'wss');
      const relayEndpoint = `${relayProtocol}://${relayHost}:${relayPort}/relay/${sessionId}`;

      // Store route in database with client info
      await this.storeRoute(selectedRoute, expiresAt, request.clientId, request.clientNetworkInfo, request.requirements);

      // Get WireGuard server configuration
      // Bosonserver работает как WireGuard сервер, клиент подключается к нему через WireGuard UDP
      const wireGuardServerHost = process.env.WIREGUARD_SERVER_HOST || 
        process.env.RELAY_HOST || 
        'localhost';
      const wireGuardServerPort = parseInt(process.env.WIREGUARD_PORT || '51820', 10);
      
      // Получить публичный ключ сервера (если есть) или использовать placeholder
      // В реальной реализации нужно генерировать и хранить ключи сервера
      const wireGuardServerPublicKey = process.env.WIREGUARD_SERVER_PUBLIC_KEY || 
        'SERVER_PUBLIC_KEY_PLACEHOLDER'; // TODO: Реализовать генерацию ключей

      // Create response
      const response: RoutingResponse = {
        routes: [selectedRoute],
        selectedRoute: {
          id: selectedRoute.id,
          relayEndpoint,
          nodeEndpoint: {
            nodeId: targetNode.nodeId,
            directConnection: selectedRoute.type === 'direct',
          },
          sessionToken: sessionId, // In production, use JWT
          expiresAt,
          wireguardConfig: {
            serverPublicKey: wireGuardServerPublicKey,
            serverEndpoint: `${wireGuardServerHost}:${wireGuardServerPort}`,
            serverPort: wireGuardServerPort,
            allowedIPs: '0.0.0.0/0', // Разрешить весь трафик через VPN
          },
        },
      };

      // Cache the response
      await redis.set(cacheKey, response, this.CACHE_TTL);

      logger.info('Route selected', {
        routeId: selectedRoute.id,
        type: selectedRoute.type,
        nodeId: targetNode.nodeId,
      });

      return response;
    } catch (error) {
      logger.error('Failed to request route', { error, clientId: request.clientId });
      throw error;
    }
  }

  private async storeRoute(
    route: RouteSelection, 
    expiresAt: number, 
    clientId?: string,
    clientNetworkInfo?: any,
    requirements?: any
  ): Promise<void> {
    try {
      await db.query(
        `INSERT INTO routes (id, type, path, estimated_latency, estimated_bandwidth, cost, priority, expires_at, client_id, client_network_info, requirements)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (id) DO UPDATE SET
           type = EXCLUDED.type,
           path = EXCLUDED.path,
           estimated_latency = EXCLUDED.estimated_latency,
           estimated_bandwidth = EXCLUDED.estimated_bandwidth,
           cost = EXCLUDED.cost,
           priority = EXCLUDED.priority,
           expires_at = EXCLUDED.expires_at,
           client_id = EXCLUDED.client_id,
           client_network_info = EXCLUDED.client_network_info,
           requirements = EXCLUDED.requirements`,
        [
          route.id,
          route.type,
          route.path,
          route.estimatedLatency,
          route.estimatedBandwidth,
          route.cost,
          route.priority,
          new Date(expiresAt),
          clientId || null,
          clientNetworkInfo ? JSON.stringify(clientNetworkInfo) : null,
          requirements ? JSON.stringify(requirements) : null,
        ]
      );
    } catch (error) {
      logger.error('Failed to store route', { error, routeId: route.id });
    }
  }

  async getRoute(routeId: string): Promise<Route | null> {
    try {
      const result = await db.query<Route>(
        'SELECT * FROM routes WHERE id = $1 AND expires_at > NOW()',
        [routeId]
      );

      if (result.length === 0) {
        return null;
      }

      return this.mapRowToRoute(result[0]);
    } catch (error) {
      logger.error('Failed to get route', { error, routeId });
      return null;
    }
  }

  async cleanupExpiredRoutes(): Promise<number> {
    try {
      const result = await db.query<{ count: string }>(
        `DELETE FROM routes WHERE expires_at < NOW() RETURNING id`
      );

      const deletedCount = result.length;
      logger.info('Cleaned up expired routes', { count: deletedCount });
      return deletedCount;
    } catch (error) {
      logger.error('Failed to cleanup expired routes', { error });
      return 0;
    }
  }

  private mapRowToRoute(row: any): Route {
    return {
      id: row.id,
      type: row.type,
      path: row.path,
      estimatedLatency: row.estimated_latency,
      estimatedBandwidth: row.estimated_bandwidth,
      cost: parseFloat(row.cost),
      priority: row.priority,
      createdAt: new Date(row.created_at),
      expiresAt: new Date(row.expires_at),
    };
  }
}

