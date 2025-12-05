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
import { WebSocketRelay, RelayMessage } from './WebSocketRelay';
import { PacketForwarder } from './PacketForwarder';
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
  private webSocketRelay: WebSocketRelay | null = null;
  private packetForwarder: PacketForwarder;
  private nodeId: string;
  private isRunning = false;
  private activeSessions: Map<string, { clientId: string; createdAt: Date }> = new Map();

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
    this.packetForwarder = new PacketForwarder();
    
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

    // Connection manager events - when registered, connect to relay
    this.connectionManager.on('registered', async () => {
      await this.connectToRelay();
    });

    // Packet forwarder events - handle incoming packets from internet
    this.packetForwarder.on('incomingPacket', (data: { packet: Buffer; sourceIP: string; sourcePort: number }) => {
      this.handleIncomingPacket(data.packet, data.sourceIP, data.sourcePort);
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

      // 8. Start PacketForwarder (needed for routing packets to internet)
      await this.packetForwarder.start();

      // 9. Start metrics collection
      this.metricsCollector.start();

      // 10. Start resource monitoring
      this.resourceManager.start();

      // 11. Start session manager
      this.sessionManager.start();

      // 12. Initialize port forwarding (optional)
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

      // 13. Start DNS handler (optional, requires root)
      try {
        await this.dnsHandler.start();
      } catch (error) {
        logger.warn('DNS handler not started (may require root)', { error });
      }

      // 14. Start health checks
      this.healthCheckManager.start();

      // 15. Register cleanup tasks
      // Register connection cleanup LAST so it executes FIRST (due to reverse order)
      // This ensures unregister is sent to bosonserver early in the shutdown process
      this.cleanupManager.register('webSocketRelay', () => {
        if (this.webSocketRelay) {
          this.webSocketRelay.disconnect();
        }
      });
      this.cleanupManager.register('packetForwarder', () => this.packetForwarder.stop());
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

  /**
   * Подключается к WebSocket Relay серверу после регистрации
   */
  private async connectToRelay(): Promise<void> {
    try {
      const relayServers = this.connectionManager.getRelayServers();
      if (!relayServers || relayServers.length === 0) {
        logger.warn('No relay servers available');
        return;
      }

      // Выбрать первый доступный relay сервер
      const relayServer = relayServers.find(s => s.protocol === 'websocket') || relayServers[0];
      if (!relayServer) {
        logger.warn('No suitable relay server found');
        return;
      }

      // Построить URL для WebSocket подключения
      // Если relay server указывает на localhost, использовать BOSON_SERVER_URL вместо этого
      let relayHost = relayServer.host;
      let relayPort = relayServer.port;
      let useSecureProtocol = false;
      
      if (relayHost === 'localhost' || relayHost === '127.0.0.1') {
        // Извлечь host и port из BOSON_SERVER_URL
        try {
          const bosonUrl = new URL(config.bosonServer.url);
          relayHost = bosonUrl.hostname;
          // Если порт не указан в relayServer, использовать порт из BOSON_SERVER_URL или 3000
          if (!relayPort || relayPort === 3000) {
            relayPort = bosonUrl.port ? parseInt(bosonUrl.port, 10) : (bosonUrl.protocol === 'https:' ? 443 : 80);
          }
          // Определить протокол на основе BOSON_SERVER_URL
          useSecureProtocol = bosonUrl.protocol === 'https:';
          logger.info('Using BOSON_SERVER_URL for relay connection', { relayHost, relayPort, useSecureProtocol });
        } catch (error) {
          logger.warn('Failed to parse BOSON_SERVER_URL, using relay server host', { error });
        }
      } else {
        // Для не-localhost серверов, определить протокол на основе порта или использовать настройку из relayServer
        // Если порт 443 или явно указан secure, использовать wss
        useSecureProtocol = relayPort === 443 || relayServer.protocol === 'websocket';
      }

      // Попробовать использовать протокол на основе BOSON_SERVER_URL, если доступен
      try {
        const bosonUrl = new URL(config.bosonServer.url);
        // Если relay host совпадает с boson host, использовать тот же протокол
        if (relayHost === bosonUrl.hostname || relayHost.includes(bosonUrl.hostname) || bosonUrl.hostname.includes(relayHost)) {
          useSecureProtocol = bosonUrl.protocol === 'https:';
          logger.debug('Using BOSON_SERVER_URL protocol for relay', { protocol: bosonUrl.protocol, useSecureProtocol });
        }
      } catch {
        // Игнорировать ошибки парсинга
      }

      const protocol = useSecureProtocol ? 'wss' : 'ws';
      const relayUrl = `${protocol}://${relayHost}:${relayPort}/relay/${this.nodeId}`;

      logger.info('Connecting to WebSocket relay', {
        url: relayUrl,
        nodeId: this.nodeId,
        relayServer: relayServer.id,
        originalHost: relayServer.host,
        originalPort: relayServer.port,
      });

      // Создать WebSocket Relay соединение
      this.webSocketRelay = new WebSocketRelay({
        url: relayUrl,
        sessionId: this.nodeId,
        reconnect: true,
        reconnectInterval: 5000,
        maxReconnectAttempts: 10,
      });

      // Обработка событий WebSocket Relay
      this.webSocketRelay.on('connected', () => {
        logger.info('WebSocket relay connected successfully');
      });

      this.webSocketRelay.on('disconnected', (code, reason) => {
        logger.warn('WebSocket relay disconnected', { code, reason });
      });

      this.webSocketRelay.on('error', (error) => {
        logger.error('WebSocket relay error', { error });
      });

      // Обработка входящих пакетов от клиентов
      this.webSocketRelay.on('data', (message: RelayMessage) => {
        this.handleRelayMessage(message);
      });

      // Подключиться к relay
      await this.webSocketRelay.connect();
    } catch (error) {
      logger.error('Failed to connect to WebSocket relay', { error });
      // Не прерываем запуск ноды, relay может подключиться позже
    }
  }

  /**
   * Обрабатывает сообщения от WebSocket Relay
   */
  private handleRelayMessage(message: RelayMessage): void {
    try {
      if (message.type === 'data') {
        if (message.direction === 'client-to-node') {
          // Пакет от клиента - нужно отправить в интернет
          this.handleClientPacket(message.payload as Buffer, message.sessionId);
        } else if (message.direction === 'node-to-client') {
          // Пакет к клиенту (ответ) - уже обработан
          logger.debug('Received node-to-client packet', { sessionId: message.sessionId });
        }
      } else if (message.type === 'control') {
        // Обработка control сообщений
        this.handleControlMessage(message);
      }
    } catch (error) {
      logger.error('Failed to handle relay message', { error, messageType: message.type });
    }
  }

  /**
   * Обрабатывает пакет от клиента и отправляет его в интернет
   */
  private async handleClientPacket(packet: Buffer, sessionId: string): Promise<void> {
    try {
      // Проверить, можем ли принять новое соединение
      if (!this.resourceManager.canAcceptConnection()) {
        logger.warn('Cannot accept connection - resources exhausted', { sessionId });
        return;
      }

      // Зарегистрировать сессию, если еще не зарегистрирована
      if (!this.activeSessions.has(sessionId)) {
        this.activeSessions.set(sessionId, {
          clientId: sessionId,
          createdAt: new Date(),
        });
        // Создать сессию в SessionManager (используем sessionId как clientId для упрощения)
        this.sessionManager.createSession(
          sessionId,
          '', // publicKey будет установлен позже, если нужно
          '0.0.0.0/0', // allowedIps - все IP разрешены
          undefined // endpoint
        );
        logger.info('New client session registered', { sessionId });
      } else {
        // Обновить активность существующей сессии
        this.sessionManager.updateSessionActivity(sessionId);
      }

      // Отправить пакет в интернет через PacketForwarder
      await this.packetForwarder.forwardPacket(packet, sessionId);

      logger.debug('Client packet forwarded to internet', {
        sessionId,
        packetSize: packet.length,
      });
    } catch (error) {
      logger.error('Failed to handle client packet', { error, sessionId });
    }
  }

  /**
   * Обрабатывает control сообщения от relay
   */
  private handleControlMessage(message: RelayMessage): void {
    const action = (message.payload as any)?.action;
    
    switch (action) {
      case 'connect':
        logger.info('Control: client connected', { sessionId: message.sessionId });
        break;
      case 'disconnect':
        logger.info('Control: client disconnected', { sessionId: message.sessionId });
        this.activeSessions.delete(message.sessionId);
        this.sessionManager.removeSession(message.sessionId);
        break;
      default:
        logger.debug('Unknown control action', { action, sessionId: message.sessionId });
    }
  }

  /**
   * Обрабатывает входящие пакеты из интернета и отправляет их обратно клиентам
   */
  private handleIncomingPacket(packet: Buffer, sourceIP: string, sourcePort: number): void {
    try {
      if (!this.webSocketRelay || !this.webSocketRelay.isConnectedToRelay()) {
        logger.debug('WebSocket relay not connected, cannot send response packet');
        return;
      }

      // Попытаться найти сессию через TCP connection manager
      // TCP connection manager отслеживает соединения и может предоставить sessionId
      // Для UDP пакетов используем упрощенный подход
      
      // Проверить, есть ли активные сессии
      const sessions = Array.from(this.activeSessions.keys());
      if (sessions.length === 0) {
        logger.debug('No active sessions, dropping incoming packet');
        return;
      }

      // Для Windows 11: используем упрощенный подход
      // В идеале нужно использовать NAT connection tracking для сопоставления
      // source IP/port с sessionId клиента
      // 
      // Упрощенная логика: если есть только одна активная сессия, отправляем ей
      // Если несколько - используем первую (в production нужен proper NAT tracking)
      
      let sessionId: string | null = null;
      
      if (sessions.length === 1) {
        // Одна активная сессия - отправляем ей
        sessionId = sessions[0];
      } else {
        // Несколько сессий - используем первую (TODO: улучшить через NAT tracking)
        // В реальной реализации нужно:
        // 1. Отслеживать NAT mappings (source IP:port -> sessionId)
        // 2. Использовать connection tracking для сопоставления ответных пакетов
        sessionId = sessions[0];
        logger.debug('Multiple active sessions, using first one (NAT tracking needed)', {
          totalSessions: sessions.length,
          selectedSession: sessionId,
        });
      }

      if (!sessionId) {
        logger.warn('No session ID found for incoming packet');
        return;
      }
      
      logger.debug('Sending incoming packet to client', {
        sessionId,
        sourceIP,
        sourcePort,
        packetSize: packet.length,
      });

      // Отправить пакет обратно клиенту через WebSocket Relay
      // Передаем sessionId для правильной маршрутизации пакета к нужному клиенту
      this.webSocketRelay.sendData(packet, 'node-to-client', sessionId);
    } catch (error) {
      logger.error('Failed to handle incoming packet', { error, sourceIP, sourcePort });
    }
  }
}

