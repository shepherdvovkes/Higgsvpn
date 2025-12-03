import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import { ApiClient, RouteRequest, RouteResponse } from './ApiClient';
import { WebSocketRelay } from './WebSocketRelay';
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
  private clientId: string;
  private status: ClientStatus = { connected: false };
  private isConnecting = false;

  constructor(clientId?: string) {
    super();
    this.clientId = clientId || config.clientId || uuidv4();
    this.apiClient = new ApiClient();
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

      // 4. Connect to WebSocket relay
      logger.info('Connecting to WebSocket relay');
      this.relay = new WebSocketRelay(
        routeResponse.selectedRoute.relayEndpoint,
        routeResponse.selectedRoute.sessionToken,
        config.reconnectInterval,
        config.heartbeatInterval
      );

      this.setupRelayHandlers();
      await this.relay.connect();

      // 5. Update status
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

    this.relay.on('packet', (data: any) => {
      this.emit('packet', data);
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

