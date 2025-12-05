import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import { ApiClient, RouteRequest, RouteResponse } from './ApiClient';
import { WebSocketRelay } from './WebSocketRelay';
import { WireGuardManager } from './WireGuardManager';
import { TrafficForwarder } from './TrafficForwarder';
import { ClientError, ConnectionError, RouteError } from '../utils/errors';
import { getLocalIPv4 } from '../utils/network';

export interface ClientStatus {
  connected: boolean;
  nodeId?: string;
  routeId?: string;
  sessionToken?: string;
  relayEndpoint?: string;
}

export class ClientService extends EventEmitter {
  private apiClient: ApiClient;
  private relay: WebSocketRelay | null = null;
  private wireGuardManager: WireGuardManager;
  private trafficForwarder: TrafficForwarder | null = null;
  private clientId: string;
  private status: ClientStatus = { connected: false };
  private isConnecting = false;

  constructor(clientId?: string) {
    super();
    this.clientId = clientId || config.clientId || uuidv4();
    this.apiClient = new ApiClient();
    this.wireGuardManager = new WireGuardManager();
  }

  async connect(requirements?: RouteRequest['requirements']): Promise<void> {
    if (this.isConnecting) {
      throw new ClientError('Connection already in progress');
    }

    if (this.status.connected) {
      logger.warn('Already connected');
      return;
    }

    this.isConnecting = true;
    this.emit('connecting');

    try {
      // 1. Health check
      logger.info('Checking server health');
      const isHealthy = await this.apiClient.healthCheck();
      if (!isHealthy) {
        throw new ConnectionError('Server is not healthy');
      }

      // 2. Get local network info
      const localIP = getLocalIPv4();
      if (!localIP) {
        throw new ConnectionError('Failed to detect local IP address');
      }

      // 3. Request route
      logger.info('Requesting route', { clientId: this.clientId });
      const routeRequest: RouteRequest = {
        clientId: this.clientId,
        requirements,
        clientNetworkInfo: {
          ipv4: localIP,
          natType: 'Symmetric', // Default, can be improved with STUN detection
        },
      };

      const routeResponse = await this.apiClient.requestRoute(routeRequest);
      this.handleRouteResponse(routeResponse);

      // 4. Setup WireGuard interface
      // Клиент подключается к bosonserver через WireGuard UDP
      // Bosonserver ретранслирует пакеты через WebSocket к ноде
      logger.info('Checking WireGuard config', { 
        hasWireguardConfig: !!routeResponse.selectedRoute.wireguardConfig,
        wireguardConfig: routeResponse.selectedRoute.wireguardConfig 
      });
      if (routeResponse.selectedRoute.wireguardConfig) {
        logger.info('Setting up WireGuard interface');
        try {
          await this.setupWireGuard(routeResponse.selectedRoute.wireguardConfig);
          logger.info('WireGuard interface setup completed');
          
          // Зарегистрировать клиента в WireGuardServer
          try {
            const clientAddress = getLocalIPv4();
            const clientPort = config.wireguard.port;
            if (clientAddress) {
              await this.apiClient.registerWireGuardClient(
                this.clientId,
                routeResponse.selectedRoute.nodeEndpoint.nodeId,
                clientAddress,
                clientPort,
                routeResponse.selectedRoute.sessionToken
              );
              logger.info('WireGuard client registered with server');
            } else {
              logger.warn('Cannot register WireGuard client: local IP not found');
            }
          } catch (regError) {
            logger.warn('Failed to register WireGuard client, continuing', { error: regError });
            // Продолжаем, так как WebSocket relay все равно работает
          }
        } catch (error) {
          logger.error('Failed to setup WireGuard interface', { error });
          // Продолжаем без WireGuard, используем только WebSocket
        }
      } else {
        logger.warn('No WireGuard config in route response, using WebSocket only');
      }

      // 5. Connect to WebSocket relay (для обратной совместимости и fallback)
      logger.info('Connecting to WebSocket relay');
      this.relay = new WebSocketRelay(
        routeResponse.selectedRoute.relayEndpoint,
        routeResponse.selectedRoute.sessionToken,
        config.reconnectInterval,
        config.heartbeatInterval
      );

      this.setupRelayHandlers();
      try {
        await this.relay.connect();
      } catch (error) {
        logger.warn('WebSocket relay connection failed, continuing with WireGuard only', { error });
        // Если WireGuard настроен, продолжаем без WebSocket
        if (!routeResponse.selectedRoute.wireguardConfig) {
          throw error;
        }
      }

      // 6. Start traffic forwarder (для перехвата и пересылки трафика)
      if (this.relay) {
        this.trafficForwarder = new TrafficForwarder(this.relay);
        try {
          await this.trafficForwarder.start();
          logger.info('Traffic forwarder started');
        } catch (error) {
          logger.warn('Failed to start traffic forwarder', { error });
          // Продолжаем без traffic forwarder
        }
      }

      // 7. Update status
      this.status.connected = true;
      this.isConnecting = false;
      this.emit('connected', this.status);
      logger.info('Client connected successfully', {
        nodeId: this.status.nodeId,
        routeId: this.status.routeId,
      });
    } catch (error) {
      this.isConnecting = false;
      this.emit('error', error);
      logger.error('Failed to connect', { error });
      throw error;
    }
  }

  private handleRouteResponse(routeResponse: RouteResponse): void {
    this.status.nodeId = routeResponse.selectedRoute.nodeEndpoint.nodeId;
    this.status.routeId = routeResponse.selectedRoute.id;
    this.status.sessionToken = routeResponse.selectedRoute.sessionToken;
    this.status.relayEndpoint = routeResponse.selectedRoute.relayEndpoint;

    logger.info('Route selected', {
      routeId: this.status.routeId,
      nodeId: this.status.nodeId,
      relayEndpoint: this.status.relayEndpoint,
    });
  }

  /**
   * Настраивает WireGuard интерфейс для подключения к bosonserver
   */
  private async setupWireGuard(wireguardConfig: any): Promise<void> {
    try {
      // Загрузить или сгенерировать ключи клиента
      await this.wireGuardManager.loadOrGenerateKeyPair();
      const clientPublicKey = this.wireGuardManager.getPublicKey();
      const clientPrivateKey = this.wireGuardManager.getPrivateKey();

      if (!clientPublicKey || !clientPrivateKey) {
        throw new Error('Failed to get WireGuard keys');
      }

      // Получить конфигурацию сервера из route response или использовать значения по умолчанию
      const serverPublicKey = wireguardConfig.serverPublicKey || wireguardConfig.publicKey;
      // Использовать hostname из config.serverUrl
      const serverHost = new URL(config.serverUrl).hostname;
      const serverPort = wireguardConfig.serverPort || 51820;
      const serverEndpoint = wireguardConfig.serverEndpoint || `${serverHost}:${serverPort}`;
      const allowedIPs = wireguardConfig.allowedIPs || '0.0.0.0/0';

      // Создать WireGuard интерфейс
      await this.wireGuardManager.createInterface({
        privateKey: clientPrivateKey,
        publicKey: clientPublicKey,
        serverPublicKey,
        serverEndpoint,
        allowedIPs,
        address: config.wireguard.address,
      });

      logger.info('WireGuard interface created', {
        interface: config.wireguard.interfaceName,
        serverEndpoint,
      });
    } catch (error) {
      logger.error('Failed to setup WireGuard interface', { error });
      // Не прерываем подключение, продолжаем через WebSocket
      throw error;
    }
  }

  private setupRelayHandlers(): void {
    if (!this.relay) {
      return;
    }

    this.relay.on('connected', () => {
      logger.info('Relay connected');
      this.emit('relay-connected');
    });

    this.relay.on('disconnected', () => {
      logger.warn('Relay disconnected');
      this.status.connected = false;
      this.emit('relay-disconnected');
      this.emit('disconnected');
    });

    this.relay.on('packet', async (data: any) => {
      // Handle incoming packets from relay
      // Convert to Buffer if needed
      const packet = Buffer.isBuffer(data) ? data : Buffer.from(data, typeof data === 'string' ? 'base64' : undefined);
      
      // Inject packet into WireGuard interface using wg set
      // WireGuard will handle the packet and deliver it to the application
      try {
        // Use wg set to inject packet (this is a workaround - normally WireGuard handles this via UDP)
        // For now, we'll just emit the packet event and let WireGuard handle it via its normal UDP path
        // The real solution would be to use a TUN library to inject packets directly
        logger.debug('Received packet from relay', { size: packet.length });
        this.emit('packet', packet);
        
        // Note: WireGuard handles incoming packets via UDP, so packets from WebSocket
        // need to be sent via UDP to the WireGuard interface's endpoint
        // This is a limitation - we'd need to modify WireGuard or use a different approach
      } catch (error) {
        logger.error('Failed to handle incoming packet', { error });
      }
    });

    this.relay.on('error', (error: Error) => {
      logger.error('Relay error', { error });
      this.emit('error', error);
    });
  }

  async disconnect(): Promise<void> {
    if (!this.status.connected) {
      return;
    }

    logger.info('Disconnecting client');

    // Остановить traffic forwarder
    if (this.trafficForwarder) {
      try {
        await this.trafficForwarder.stop();
      } catch (error) {
        logger.warn('Failed to stop traffic forwarder', { error });
      }
      this.trafficForwarder = null;
    }

    // Удалить WireGuard интерфейс
    try {
      await this.wireGuardManager.removeInterface();
    } catch (error) {
      logger.warn('Failed to remove WireGuard interface', { error });
    }

    if (this.relay) {
      this.relay.disconnect();
      this.relay = null;
    }

    this.status = { connected: false };
    this.emit('disconnected');
    logger.info('Client disconnected');
  }

  sendPacket(packet: Buffer | Uint8Array): void {
    if (!this.relay || !this.status.connected) {
      throw new ClientError('Not connected');
    }

    this.relay.sendPacket(packet);
  }

  getStatus(): ClientStatus {
    return { ...this.status };
  }

  getClientId(): string {
    return this.clientId;
  }
}

