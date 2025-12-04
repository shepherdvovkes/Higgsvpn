import { EventEmitter } from 'events';
import { ApiClient, RegisterNodeRequest, RegisterNodeResponse, HeartbeatRequest } from '../services/ApiClient';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import { NetworkError } from '../utils/errors';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

export interface ConnectionState {
  status: ConnectionStatus;
  nodeId: string | null;
  sessionToken: string | null;
  lastHeartbeat: Date | null;
  nextHeartbeatInterval: number;
  relayServers: RegisterNodeResponse['relayServers'];
  stunServers: RegisterNodeResponse['stunServers'];
}

export class ConnectionManager extends EventEmitter {
  private apiClient: ApiClient;
  private state: ConnectionState;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 5000;

  constructor(apiClient: ApiClient) {
    super();
    this.apiClient = apiClient;
    this.state = {
      status: 'disconnected',
      nodeId: null,
      sessionToken: null,
      lastHeartbeat: null,
      nextHeartbeatInterval: config.heartbeat.interval,
      relayServers: [],
      stunServers: [],
    };
  }

  getState(): ConnectionState {
    return { ...this.state };
  }

  getStatus(): ConnectionStatus {
    return this.state.status;
  }

  async register(request: RegisterNodeRequest): Promise<RegisterNodeResponse> {
    if (this.state.status === 'connected' || this.state.status === 'connecting') {
      throw new Error('Node is already registered or connecting');
    }

    this.setState({ status: 'connecting' });
    this.emit('statusChange', 'connecting');

    try {
      const response = await this.apiClient.retryRequest(() => this.apiClient.register(request));

      this.setState({
        status: 'connected',
        nodeId: response.nodeId,
        sessionToken: response.sessionToken,
        relayServers: response.relayServers,
        stunServers: response.stunServers,
        nextHeartbeatInterval: response.nodeId ? config.heartbeat.interval : config.heartbeat.interval,
      });

      this.apiClient.setSessionToken(response.sessionToken);
      this.reconnectAttempts = 0;

      this.emit('registered', response);
      this.emit('statusChange', 'connected');

      // Start heartbeat
      this.startHeartbeat();

      logger.info('Node registered successfully', { nodeId: response.nodeId });
      return response;
    } catch (error: any) {
      // If it's a rate limit error (429), schedule background retry instead of failing
      const isRateLimit = error?.statusCode === 429 || 
                         (error?.code === 'NETWORK_ERROR' && error?.statusCode === 429);
      
      if (isRateLimit) {
        logger.warn('Registration rate limited, scheduling background retry', { 
          nodeId: request.nodeId,
          error: error.message 
        });
        
        // Store request for retry
        this.pendingRegisterRequest = request;
        
        // Schedule retry in background
        this.scheduleRegisterRetry();
        
        // Don't throw - allow node to continue starting
        // Return a promise that will resolve when registration succeeds
        return new Promise((resolve, reject) => {
          this.registerRetryResolve = resolve;
          this.registerRetryReject = reject;
        });
      } else {
        // For other errors, set error state and throw
        this.setState({ status: 'error' });
        this.emit('statusChange', 'error');
        this.emit('error', error);
        logger.error('Failed to register node', { error });
        throw error;
      }
    }
  }

  private pendingRegisterRequest: RegisterNodeRequest | null = null;
  private registerRetryResolve: ((value: RegisterNodeResponse) => void) | null = null;
  private registerRetryReject: ((reason?: any) => void) | null = null;
  private registerRetryTimer: NodeJS.Timeout | null = null;

  private scheduleRegisterRetry(): void {
    if (this.registerRetryTimer) {
      clearTimeout(this.registerRetryTimer);
    }

    if (!this.pendingRegisterRequest) {
      return;
    }

    // Exponential backoff starting at 10 seconds
    const delay = Math.min(60000, 10000 * Math.pow(2, this.reconnectAttempts));
    this.reconnectAttempts++;

    logger.info(`Scheduling registration retry in ${delay}ms`, { attempt: this.reconnectAttempts });

    this.registerRetryTimer = setTimeout(async () => {
      try {
        const response = await this.apiClient.retryRequest(
          () => this.apiClient.register(this.pendingRegisterRequest!)
        );

        this.setState({
          status: 'connected',
          nodeId: response.nodeId,
          sessionToken: response.sessionToken,
          relayServers: response.relayServers,
          stunServers: response.stunServers,
          nextHeartbeatInterval: config.heartbeat.interval,
        });

        this.apiClient.setSessionToken(response.sessionToken);
        this.reconnectAttempts = 0;
        this.pendingRegisterRequest = null;

        this.emit('registered', response);
        this.emit('statusChange', 'connected');

        this.startHeartbeat();

        logger.info('Node registered successfully after retry', { nodeId: response.nodeId });
        
        if (this.registerRetryResolve) {
          this.registerRetryResolve(response);
          this.registerRetryResolve = null;
          this.registerRetryReject = null;
        }
      } catch (error: any) {
        const isRateLimit = error?.statusCode === 429 || 
                           (error?.code === 'NETWORK_ERROR' && error?.statusCode === 429);
        
        if (isRateLimit && this.reconnectAttempts < this.maxReconnectAttempts) {
          // Still rate limited, retry again
          this.scheduleRegisterRetry();
        } else {
          logger.error('Registration retry failed', { error, attempts: this.reconnectAttempts });
          this.setState({ status: 'error' });
          this.emit('statusChange', 'error');
          
          if (this.registerRetryReject) {
            this.registerRetryReject(error);
            this.registerRetryResolve = null;
            this.registerRetryReject = null;
          }
        }
      }
    }, delay);
  }

  private setState(updates: Partial<ConnectionState>): void {
    this.state = { ...this.state, ...updates };
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }

    if (!this.state.nodeId) {
      logger.warn('Cannot start heartbeat: nodeId is not set');
      return;
    }

    const sendHeartbeat = async () => {
      try {
        const heartbeatData: HeartbeatRequest = {
          status: this.state.status === 'connected' ? 'online' : 'degraded',
        };

        const response = await this.apiClient.sendHeartbeat(this.state.nodeId!, heartbeatData);

        this.setState({
          lastHeartbeat: new Date(),
          nextHeartbeatInterval: response.nextHeartbeat || config.heartbeat.interval,
        });

        // Process actions from server
        if (response.actions && response.actions.length > 0) {
          this.processServerActions(response.actions);
        }

        this.reconnectAttempts = 0;
        this.emit('heartbeat', response);

        // Update interval if server requested different interval
        if (response.nextHeartbeat && response.nextHeartbeat !== config.heartbeat.interval) {
          this.restartHeartbeat(response.nextHeartbeat);
        }
      } catch (error) {
        logger.error('Heartbeat failed', { error, nodeId: this.state.nodeId });
        this.emit('heartbeatError', error);

        // Try to reconnect
        if (this.state.status === 'connected') {
          this.scheduleReconnect();
        }
      }
    };

    // Send first heartbeat immediately
    sendHeartbeat();

    // Then schedule periodic heartbeats
    this.heartbeatTimer = setInterval(
      sendHeartbeat,
      this.state.nextHeartbeatInterval * 1000
    );
  }

  private restartHeartbeat(interval: number): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }

    this.heartbeatTimer = setInterval(async () => {
      try {
        const heartbeatData: HeartbeatRequest = {
          status: this.state.status === 'connected' ? 'online' : 'degraded',
        };

        const response = await this.apiClient.sendHeartbeat(this.state.nodeId!, heartbeatData);
        this.setState({ lastHeartbeat: new Date() });
        this.emit('heartbeat', response);
      } catch (error) {
        logger.error('Heartbeat failed', { error });
        this.emit('heartbeatError', error);
        this.scheduleReconnect();
      }
    }, interval * 1000);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error('Max reconnect attempts reached');
      this.setState({ status: 'error' });
      this.emit('statusChange', 'error');
      this.emit('maxReconnectAttemptsReached');
      return;
    }

    this.setState({ status: 'reconnecting' });
    this.emit('statusChange', 'reconnecting');

    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts);
    this.reconnectAttempts++;

    logger.info(`Scheduling reconnect attempt ${this.reconnectAttempts} in ${delay}ms`);

    this.reconnectTimer = setTimeout(() => {
      this.attemptReconnect();
    }, delay);
  }

  private async attemptReconnect(): Promise<void> {
    if (!this.state.nodeId) {
      logger.error('Cannot reconnect: nodeId is not set');
      return;
    }

    try {
      // Try to send a heartbeat to check if connection is restored
      const heartbeatData: HeartbeatRequest = {
        status: 'online',
      };

      const response = await this.apiClient.sendHeartbeat(this.state.nodeId, heartbeatData);

      // Connection restored
      this.setState({
        status: 'connected',
        lastHeartbeat: new Date(),
        nextHeartbeatInterval: response.nextHeartbeat || config.heartbeat.interval,
      });

      this.reconnectAttempts = 0;
      this.emit('reconnected');
      this.emit('statusChange', 'connected');

      logger.info('Reconnected successfully');
    } catch (error) {
      logger.warn('Reconnect attempt failed', { error, attempt: this.reconnectAttempts });
      this.scheduleReconnect();
    }
  }

  private processServerActions(actions: Array<{ type: string; payload: any }>): void {
    for (const action of actions) {
      logger.info('Processing server action', { type: action.type });
      this.emit('serverAction', action);

      switch (action.type) {
        case 'updateConfig':
          // Handle config update
          this.emit('configUpdate', action.payload);
          break;
        case 'restart':
          // Handle restart request
          this.emit('restartRequested', action.payload);
          break;
        case 'maintenance':
          // Handle maintenance mode
          this.emit('maintenanceMode', action.payload);
          break;
        default:
          logger.warn('Unknown server action type', { type: action.type });
      }
    }
  }

  async disconnect(): Promise<void> {
    this.stopHeartbeat();
    this.stopReconnect();

    if (this.state.nodeId) {
      try {
        // Notify server about disconnection to remove node from registry immediately
        await this.apiClient.unregister(this.state.nodeId);
        logger.info('Node unregistered from bosonserver', { nodeId: this.state.nodeId });
      } catch (error) {
        // Log error but continue with disconnect - we're shutting down anyway
        logger.warn('Error during unregister (non-critical during shutdown)', { error, nodeId: this.state.nodeId });
      }
    }

    this.setState({
      status: 'disconnected',
      nodeId: null,
      sessionToken: null,
      lastHeartbeat: null,
      relayServers: [],
      stunServers: [],
    });

    this.apiClient.clearSessionToken();
    this.emit('disconnected');
    this.emit('statusChange', 'disconnected');
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private stopReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.registerRetryTimer) {
      clearTimeout(this.registerRetryTimer);
      this.registerRetryTimer = null;
    }
    this.reconnectAttempts = 0;
    this.pendingRegisterRequest = null;
    this.registerRetryResolve = null;
    this.registerRetryReject = null;
  }

  updateHeartbeatMetrics(metrics: HeartbeatRequest['metrics']): void {
    // This will be called by MetricsCollector to update heartbeat data
    // The actual sending happens in the heartbeat timer
  }

  getRelayServers(): RegisterNodeResponse['relayServers'] {
    return this.state.relayServers;
  }

  getStunServers(): RegisterNodeResponse['stunServers'] {
    return this.state.stunServers;
  }
}

