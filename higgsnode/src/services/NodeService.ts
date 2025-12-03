import { v4 as uuidv4 } from 'uuid';
import { ApiClient } from './ApiClient';
import { ConnectionManager } from '../managers/ConnectionManager';
import { WireGuardManager } from '../managers/WireGuardManager';
import { MetricsCollector } from '../collectors/MetricsCollector';
import { ResourceManager } from '../managers/ResourceManager';
import { RoutingEngine } from '../engines/RoutingEngine';
import { NatTraversalEngine } from '../engines/NatTraversalEngine';
import { SessionManager } from '../managers/SessionManager';
import { NetworkRouteManager } from '../managers/NetworkRouteManager';
import { CleanupManager } from '../managers/CleanupManager';
import { PortForwardingService } from './PortForwardingService';
import { PrivacyManager } from '../managers/PrivacyManager';
import { MTUManager } from '../managers/MTUManager';
import { DNSHandler } from './DNSHandler';
import { HealthCheckManager } from '../managers/HealthCheckManager';
import { ClientRateLimiter } from '../managers/ClientRateLimiter';
import { TrafficShaper } from '../managers/TrafficShaper';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import { getLocalIPv4 } from '../utils/network';
import { registerCleanup } from '../index';

export class NodeService {
  private apiClient: ApiClient;
  private connectionManager: ConnectionManager;
  private wireGuardManager: WireGuardManager;
  private metricsCollector: MetricsCollector;
  private resourceManager: ResourceManager;
  private routingEngine: RoutingEngine;
  private natTraversalEngine: NatTraversalEngine;
  private sessionManager: SessionManager;
  private networkRouteManager: NetworkRouteManager;
  private cleanupManager: CleanupManager;
  private portForwardingService: PortForwardingService;
  private privacyManager: PrivacyManager;
  private mtuManager: MTUManager;
  private dnsHandler: DNSHandler;
  private healthCheckManager: HealthCheckManager;
  private clientRateLimiter: ClientRateLimiter;
  private trafficShaper: TrafficShaper;
  private nodeId: string;
  private isRunning = false;

  constructor() {
    this.apiClient = new ApiClient();
    this.connectionManager = new ConnectionManager(this.apiClient);
    this.wireGuardManager = new WireGuardManager();
    this.metricsCollector = new MetricsCollector(this.wireGuardManager, this.apiClient);
    this.resourceManager = new ResourceManager(this.metricsCollector);
    this.routingEngine = new RoutingEngine(this.wireGuardManager);
    this.sessionManager = new SessionManager();
    this.natTraversalEngine = new NatTraversalEngine(this.apiClient);
    
    // Initialize new managers
    this.cleanupManager = new CleanupManager();
    this.networkRouteManager = new NetworkRouteManager(
      config.wireguard.interfaceName,
      config.wireguard.address
    );
    this.portForwardingService = new PortForwardingService();
    this.privacyManager = new PrivacyManager();
    this.mtuManager = new MTUManager();
    this.dnsHandler = new DNSHandler(config.wireguard.interfaceName);
    this.clientRateLimiter = new ClientRateLimiter(config.wireguard.interfaceName);
    this.trafficShaper = new TrafficShaper();
    
    // Health check manager (will be initialized after routing engine is ready)
    this.healthCheckManager = new HealthCheckManager(
      this.routingEngine,
      this.wireGuardManager,
      this.networkRouteManager
    );

    // Get or generate node ID
    this.nodeId = config.node.id || uuidv4();

    // Register cleanup function
    registerCleanup(() => this.cleanupManager.execute());

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // Connection manager events
    this.connectionManager.on('registered', () => {
      logger.info('Node registered successfully');
    });

    this.connectionManager.on('statusChange', (status) => {
      logger.info('Connection status changed', { status });
    });

    // Metrics collector events
    this.metricsCollector.on('metricsCollected', async (metrics) => {
      // Send metrics to server
      try {
        await this.metricsCollector.sendMetrics(this.nodeId, metrics);
      } catch (error) {
        logger.error('Failed to send metrics', { error });
      }
    });

    // Resource manager events
    this.resourceManager.on('statusChange', (status, previousStatus) => {
      logger.warn('Resource status changed', { from: previousStatus, to: status });
      
      // Update connection manager status
      if (status === 'degraded' || status === 'critical') {
        // Connection manager will handle status updates in heartbeat
      }
    });
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Node is already running');
      return;
    }

    try {
      logger.info('Starting HiggsNode', { nodeId: this.nodeId });

      // 1. Initialize NAT Traversal Engine
      await this.natTraversalEngine.initialize();

      // 2. Load or generate WireGuard keys (needed for registration, not for interface)
      await this.wireGuardManager.loadOrGenerateKeyPair();
      const publicKey = this.wireGuardManager.getPublicKey();
      if (!publicKey) {
        throw new Error('Failed to get WireGuard public key');
      }

      // Note: WireGuard interface is NOT created here
      // HiggsNode works as NAT gateway, receiving packets via API from BOSONSERVER
      // BOSONSERVER acts as WireGuard server and wraps packets in API

      // 3. Setup NAT for physical interface (to route packets to internet)
      // No WireGuard interface routing needed - packets come via API
      await this.routingEngine.enableNat();

      // 5. Discover NAT type and mapped address
      const natType = await this.natTraversalEngine.detectNatType();
      const mappedAddress = await this.natTraversalEngine.discoverMappedAddress();

      // 6. Get local IP
      const localIP = getLocalIPv4() || '127.0.0.1';

      // 7. Register node with BosonServer
      const registerRequest = {
        nodeId: this.nodeId,
        publicKey: publicKey,
        networkInfo: {
          ipv4: localIP,
          ipv6: null,
          natType: natType,
          stunMappedAddress: mappedAddress?.address || null,
          localPort: config.wireguard.port,
        },
        capabilities: {
          maxConnections: config.resources.maxConnections,
          bandwidth: {
            up: 100, // TODO: Measure actual bandwidth
            down: 100,
          },
          routing: true,
          natting: true,
        },
        location: {
          country: 'US', // TODO: Detect actual location
          region: 'US-CA',
          coordinates: null,
        },
        heartbeatInterval: config.heartbeat.interval,
      };

      await this.connectionManager.register(registerRequest);

      // 8. Start metrics collection
      this.metricsCollector.start();

      // 9. Start resource monitoring
      this.resourceManager.start();

      // 10. Start session manager
      this.sessionManager.start();

      // 11. Initialize port forwarding (optional)
      try {
        await this.portForwardingService.initialize();
        const externalIP = await this.portForwardingService.getExternalIP();
        
        if (externalIP) {
          const mapping = await this.portForwardingService.addPortMapping({
            internalPort: config.wireguard.port,
            externalPort: config.wireguard.port,
            protocol: 'udp',
            description: 'HiggsNode WireGuard',
            ttl: 3600, // 1 час
          });

          if (mapping) {
            logger.info('Port forwarding enabled', {
              internalPort: config.wireguard.port,
              externalIP,
            });
          }
        }
      } catch (error) {
        logger.warn('Port forwarding not available', { error });
      }

      // 12. Start DNS handler (optional, requires root)
      try {
        await this.dnsHandler.start();
      } catch (error) {
        logger.warn('DNS handler not started (may require root)', { error });
      }

      // 13. Start health checks
      this.healthCheckManager.start();

      // 14. Register cleanup tasks
      // Register connection cleanup LAST so it executes FIRST (due to reverse order)
      // This ensures unregister is sent to bosonserver early in the shutdown process
      this.cleanupManager.register('routing', () => this.routingEngine.cleanup());
      // Note: WireGuard interface cleanup not needed - we don't create interface
      // this.cleanupManager.register('wireguard', () => this.wireGuardManager.stopInterface());
      this.cleanupManager.register('networkRoute', () => this.networkRouteManager.cleanup());
      this.cleanupManager.register('metrics', () => this.metricsCollector.stop());
      this.cleanupManager.register('portForwarding', () => this.portForwardingService.cleanup());
      this.cleanupManager.register('dnsHandler', () => this.dnsHandler.stop());
      this.cleanupManager.register('healthCheck', () => this.healthCheckManager.stop());
      this.cleanupManager.register('clientRateLimiter', () => this.clientRateLimiter.cleanup());
      this.cleanupManager.register('trafficShaper', () => this.trafficShaper.cleanup());
      // Register connection cleanup last - will execute first to notify bosonserver immediately
      this.cleanupManager.register('connection', () => this.connectionManager.disconnect());

      this.isRunning = true;
      logger.info('HiggsNode started successfully', { nodeId: this.nodeId });
    } catch (error) {
      logger.error('Failed to start HiggsNode', { error });
      await this.stop();
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      logger.info('Stopping HiggsNode');
      
      // Stop health checks first
      this.healthCheckManager.stop();

      // Execute all cleanup tasks
      await this.cleanupManager.execute();

      this.isRunning = false;
      logger.info('HiggsNode stopped');
    } catch (error) {
      logger.error('Error during shutdown', { error });
      throw error;
    }
  }

  getNodeId(): string {
    return this.nodeId;
  }

  isNodeRunning(): boolean {
    return this.isRunning;
  }

  getPrivacyManager(): PrivacyManager {
    return this.privacyManager;
  }

  getHealthCheckManager(): HealthCheckManager {
    return this.healthCheckManager;
  }

  getClientRateLimiter(): ClientRateLimiter {
    return this.clientRateLimiter;
  }

  getTrafficShaper(): TrafficShaper {
    return this.trafficShaper;
  }
}

