import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import http from 'http';
import axios from 'axios';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import { errorHandler } from '../utils/errors';
import { apiRateLimiter, dashboardRateLimiter, nodeRateLimiter } from './middleware/rateLimit';

// Routes
import nodesRouter from './routes/nodes';
import routingRouter from './routes/routing';
import metricsRouter from './routes/metrics';
import turnRouter from './routes/turn';
import healthRouter from './routes/health';
import packetsRouter from './routes/packets';
import wireguardRouter from './routes/wireguard';
import clientsRouter from './routes/clients';

// Services
import { DiscoveryService } from '../services/discovery/DiscoveryService';
import { RoutingService } from '../services/routing/RoutingService';
import { MetricsService } from '../services/metrics/MetricsService';
import { TurnManager } from '../services/turn/TurnManager';
import { RelayService } from '../services/relay/RelayService';
import { WireGuardServer } from '../services/wireguard/WireGuardServer';

export class ApiGateway {
  private app: Express;
  private server: http.Server;
  private discoveryService: DiscoveryService;
  private routingService: RoutingService;
  private metricsService: MetricsService;
  private turnManager: TurnManager;
  private relayService: RelayService;
  private wireGuardServer: WireGuardServer;

  constructor() {
    this.app = express();
    this.server = http.createServer(this.app);

    // Initialize services
    this.discoveryService = new DiscoveryService();
    this.relayService = new RelayService();
    this.routingService = new RoutingService(this.discoveryService);
    this.routingService.setRelayService(this.relayService); // Inject RelayService into RoutingService
    this.metricsService = new MetricsService(this.discoveryService);
    this.turnManager = new TurnManager();
    this.wireGuardServer = new WireGuardServer(this.discoveryService);
    this.wireGuardServer.setRelayService(this.relayService); // Inject RelayService into WireGuardServer

    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
    // Note: setupPacketForwarding will be called after WebSocket relay is initialized in start()
  }

  private setupMiddleware(): void {
    // CORS
    this.app.use(cors({
      origin: config.cors.origin === '*' ? true : config.cors.origin,
      credentials: true,
    }));

    // Body parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Request logging
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      const start = Date.now();
      res.on('finish', () => {
        const duration = Date.now() - start;
        logger.info('HTTP request', {
          method: req.method,
          path: req.path,
          status: res.statusCode,
          duration,
          ip: req.ip,
        });

        // Record metrics
        this.metricsService.recordApiRequest(req.method, req.path, res.statusCode);
      });
      next();
    });

    // Rate limiting
    this.app.use('/api', apiRateLimiter);

    // Make services available to routes
    this.app.set('discoveryService', this.discoveryService);
    this.app.set('routingService', this.routingService);
    this.app.set('metricsService', this.metricsService);
    this.app.set('turnManager', this.turnManager);
    this.app.set('relayService', this.relayService);
    this.app.set('wireGuardServer', this.wireGuardServer);
  }

  private setupPacketForwarding(): void {
    // Forward packets from WebSocketRelay to nodes via WebSocket relay or API
    const webSocketRelay = (this.relayService as any).webSocketRelay;
    if (webSocketRelay) {
      webSocketRelay.on('packetToNode', async (data: { nodeId: string; sessionId: string; packet: Buffer }) => {
        try {
          // Try WebSocket relay first if sessionId is available
          if (data.sessionId) {
            const sent = await this.relayService.sendToSession(data.sessionId, data.packet);
            if (sent) {
              logger.debug('Packet forwarded to node via WebSocket relay (from WebSocketRelay)', { 
                nodeId: data.nodeId, 
                sessionId: data.sessionId 
              });
              return;
            }
          }

          // Fallback to direct API call
          const node = await this.discoveryService.getNode(data.nodeId);
          if (!node) {
            logger.warn('Node not found for packet forwarding', { nodeId: data.nodeId });
            return;
          }

          const nodeApiUrl = node.networkInfo?.ipv4 
            ? `http://${node.networkInfo.ipv4}:${process.env.NODE_API_PORT || '3000'}`
            : process.env.DEFAULT_NODE_API_URL || 'http://localhost:3000';

          try {
            await axios.post(
              `${nodeApiUrl}/api/v1/packets/from-server`,
              {
                nodeId: data.nodeId,
                packet: data.packet.toString('base64'),
                timestamp: Date.now(),
              },
              {
                timeout: 5000,
                headers: {
                  'Content-Type': 'application/json',
                },
              }
            );
            logger.debug('Packet forwarded to node via direct API (from WebSocketRelay)', { nodeId: data.nodeId });
          } catch (apiError: any) {
            logger.warn('Failed to forward packet to node via both WebSocket relay and API', {
              error: apiError.message,
              nodeId: data.nodeId,
            });
          }
        } catch (error) {
          logger.error('Failed to forward packet to node', { error, nodeId: data.nodeId });
        }
      });
    }

    // Forward packets from WireGuardServer to nodes via WebSocket relay or API
    this.wireGuardServer.on('packetToNode', async (data: { nodeId: string; clientId: string; packet: Buffer; sessionId?: string }) => {
      try {
        // Try WebSocket relay first if sessionId is available
        if (data.sessionId) {
          const sent = await this.relayService.sendToSession(data.sessionId, data.packet);
          if (sent) {
            logger.debug('Packet forwarded to node via WebSocket relay', { 
              nodeId: data.nodeId, 
              clientId: data.clientId,
              sessionId: data.sessionId 
            });
            return;
          }
        }

        // Try to find sessionId by clientId and nodeId
        const activeSessions = this.relayService.getActiveWebSocketSessionIds();
        for (const sessionId of activeSessions) {
          const session = await this.relayService.getSession(sessionId);
          if (session && session.clientId === data.clientId && session.nodeId === data.nodeId) {
            const sent = await this.relayService.sendToSession(sessionId, data.packet);
            if (sent) {
              logger.debug('Packet forwarded to node via WebSocket relay (found session)', { 
                nodeId: data.nodeId, 
                clientId: data.clientId,
                sessionId 
              });
              return;
            }
          }
        }

        // Fallback to direct API call
        const node = await this.discoveryService.getNode(data.nodeId);
        if (!node) {
          logger.warn('Node not found for packet forwarding', { nodeId: data.nodeId });
          return;
        }

        const nodeApiUrl = node.networkInfo?.ipv4 
          ? `http://${node.networkInfo.ipv4}:${process.env.NODE_API_PORT || '3000'}`
          : process.env.DEFAULT_NODE_API_URL || 'http://localhost:3000';

        try {
          await axios.post(
            `${nodeApiUrl}/api/v1/packets/from-server`,
            {
              clientId: data.clientId,
              nodeId: data.nodeId,
              packet: data.packet.toString('base64'),
              timestamp: Date.now(),
            },
            {
              timeout: 5000,
              headers: {
                'Content-Type': 'application/json',
              },
            }
          );
          logger.debug('Packet forwarded to node via direct API', { nodeId: data.nodeId });
        } catch (apiError: any) {
          logger.warn('Failed to forward packet to node via both WebSocket relay and API', {
            error: apiError.message,
            nodeId: data.nodeId,
            clientId: data.clientId,
          });
        }
      } catch (error) {
        logger.error('Failed to forward packet to node', { error, nodeId: data.nodeId });
      }
    });
  }

  private setupRoutes(): void {
    // Health check routes
    this.app.use('/health', healthRouter);

    // API routes with rate limiting
    // Read-only dashboard endpoints get more lenient rate limiting
    this.app.use('/api/v1/nodes', dashboardRateLimiter, nodesRouter);
    
    // Metrics and heartbeat endpoints use nodeRateLimiter (more lenient for frequent updates)
    this.app.use('/api/v1/metrics', nodeRateLimiter, metricsRouter);
    
    // Routing endpoint uses nodeRateLimiter (clients may retry frequently)
    this.app.use('/api/v1/routing', nodeRateLimiter, routingRouter);
    this.app.use('/api/v1/turn', turnRouter);
    this.app.use('/api/v1/packets', packetsRouter);
    this.app.use('/api/v1/wireguard', wireguardRouter);
    this.app.use('/api/v1/clients', dashboardRateLimiter, clientsRouter);

    // Prometheus metrics endpoint
    this.app.get('/metrics', async (req: Request, res: Response, next: NextFunction) => {
      try {
        const metrics = await this.metricsService.getPrometheusMetrics();
        res.set('Content-Type', 'text/plain; version=0.0.4');
        res.send(metrics);
      } catch (error) {
        next(error);
      }
    });

    // 404 handler
    this.app.use((req: Request, res: Response) => {
      res.status(404).json({ error: 'Not found' });
    });
  }

  private setupErrorHandling(): void {
    this.app.use(errorHandler);
  }

  async start(): Promise<void> {
    try {
      // Start cleanup tasks
      this.discoveryService.startCleanupTask();
      this.metricsService.startMetricsUpdate();

      // Initialize WebSocket relay
      this.relayService.initializeWebSocket(this.server);
      
      // Setup packet forwarding after WebSocket relay is initialized
      this.setupPacketForwarding();

      // Start WireGuard UDP server
      await this.wireGuardServer.start();

      // Start HTTP server
      await new Promise<void>((resolve, reject) => {
        this.server.listen(config.server.port, config.server.host, () => {
          logger.info(`API Gateway started on ${config.server.host}:${config.server.port}`);
          resolve();
        });

        this.server.on('error', (error) => {
          logger.error('Server error', { error });
          reject(error);
        });
      });
    } catch (error) {
      logger.error('Failed to start API Gateway', { error });
      throw error;
    }
  }

  async stop(): Promise<void> {
    try {
      // Stop cleanup tasks
      this.discoveryService.stopCleanupTask();
      this.metricsService.stopMetricsUpdate();
      this.relayService.close();
      await this.wireGuardServer.stop();

      // Close server
      await new Promise<void>((resolve) => {
        this.server.close(() => {
          logger.info('API Gateway stopped');
          resolve();
        });
      });
    } catch (error) {
      logger.error('Error stopping API Gateway', { error });
    }
  }
}