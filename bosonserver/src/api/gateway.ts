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
import clientsRouter from './routes/clients';
import routingRouter from './routes/routing';
import metricsRouter from './routes/metrics';
import turnRouter from './routes/turn';
import healthRouter from './routes/health';
import packetsRouter from './routes/packets';

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

    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
    this.setupPacketForwarding();
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
    // Forward packets from WireGuardServer to nodes via API
    this.wireGuardServer.on('packetToNode', async (data: { nodeId: string; clientId: string; packet: Buffer }) => {
      try {
        // Get node info
        const node = await this.discoveryService.getNode(data.nodeId);
        if (!node) {
          logger.warn('Node not found for packet forwarding', { nodeId: data.nodeId });
          return;
        }

        // Send packet to node via API
        // Node should have an endpoint to receive packets
        const nodeApiUrl = process.env.NODE_API_BASE_URL || 'http://localhost:3000';
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
        } catch (apiError: any) {
          logger.debug('Failed to send packet to node via API, using WebSocket relay', {
            error: apiError.message,
            nodeId: data.nodeId,
          });
          // Fallback to WebSocket relay if available
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
        this.app.use('/api/v1/clients', dashboardRateLimiter, clientsRouter);
    
    // Metrics and heartbeat endpoints use nodeRateLimiter (more lenient for frequent updates)
    this.app.use('/api/v1/metrics', nodeRateLimiter, metricsRouter);
    
    // Routing endpoint uses nodeRateLimiter (clients may retry frequently)
    this.app.use('/api/v1/routing', nodeRateLimiter, routingRouter);
    this.app.use('/api/v1/turn', turnRouter);
    this.app.use('/api/v1/packets', packetsRouter);

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