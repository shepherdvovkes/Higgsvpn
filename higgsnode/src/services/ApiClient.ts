import axios, { AxiosInstance, AxiosError } from 'axios';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import { NetworkError } from '../utils/errors';

export interface RegisterNodeRequest {
  nodeId: string;
  publicKey: string;
  networkInfo: {
    ipv4: string;
    ipv6: string | null;
    natType: 'FullCone' | 'RestrictedCone' | 'PortRestricted' | 'Symmetric';
    stunMappedAddress: string | null;
    localPort: number;
  };
  capabilities: {
    maxConnections: number;
    bandwidth: {
      up: number;
      down: number;
    };
    routing: boolean;
    natting: boolean;
  };
  metrics?: {
    latency: number;
    jitter: number;
    packetLoss: number;
    cpuUsage: number;
    memoryUsage: number;
  };
  location: {
    country: string;
    region: string;
    coordinates: [number, number] | null;
  };
  heartbeatInterval?: number;
}

export interface RegisterNodeResponse {
  nodeId: string;
  status: string;
  relayServers: Array<{
    id: string;
    host: string;
    port: number;
    protocol: 'tcp' | 'udp' | 'websocket';
  }>;
  stunServers: Array<{
    host: string;
    port: number;
  }>;
  sessionToken: string;
  expiresAt: number;
}

export interface HeartbeatRequest {
  metrics?: {
    latency: number;
    jitter: number;
    packetLoss: number;
    cpuUsage: number;
    memoryUsage: number;
    activeConnections: number;
    bandwidth: {
      up: number;
      down: number;
    };
  };
  status?: 'online' | 'degraded' | 'offline';
}

export interface HeartbeatResponse {
  status: string;
  nextHeartbeat: number;
  actions: Array<{
    type: string;
    payload: any;
  }>;
}

export interface MetricsRequest {
  nodeId: string;
  timestamp: number;
  metrics: {
    network: {
      latency: number;
      jitter: number;
      packetLoss: number;
      bandwidth: {
        up: number;
        down: number;
      };
    };
    system: {
      cpuUsage: number;
      memoryUsage: number;
      diskUsage: number;
      loadAverage: number;
    };
    wireguard: {
      packets: {
        sent: number;
        received: number;
        errors: number;
      };
      bytes: {
        sent: number;
        received: number;
      };
    };
    connections: {
      active: number;
      total: number;
      failed: number;
    };
  };
}

export interface TurnServer {
  host: string;
  port: number;
  realm: string;
  username: string;
  password: string;
  ttl: number;
}

export interface StunServer {
  host: string;
  port: number;
}

export class ApiClient {
  private client: AxiosInstance;
  private sessionToken: string | null = null;

  constructor() {
    this.client = axios.create({
      baseURL: config.bosonServer.url,
      timeout: config.bosonServer.timeout,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Request interceptor for adding auth token
    this.client.interceptors.request.use(
      (config) => {
        if (this.sessionToken && config.headers) {
          config.headers.Authorization = `Bearer ${this.sessionToken}`;
        }
        return config;
      },
      (error) => {
        return Promise.reject(error);
      }
    );

    // Response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {
        if (error.response) {
          const status = error.response.status;
          const message = (error.response.data as any)?.error?.message || error.message;
          throw new NetworkError(`API Error: ${message}`, status);
        } else if (error.request) {
          throw new NetworkError('No response from server');
        } else {
          throw new NetworkError(`Request error: ${error.message}`);
        }
      }
    );
  }

  setSessionToken(token: string): void {
    this.sessionToken = token;
  }

  clearSessionToken(): void {
    this.sessionToken = null;
  }

  async register(request: RegisterNodeRequest): Promise<RegisterNodeResponse> {
    try {
      logger.debug('Registering node', { nodeId: request.nodeId });
      const response = await this.client.post<RegisterNodeResponse>(
        '/api/v1/nodes/register',
        request
      );
      
      if (response.data.sessionToken) {
        this.setSessionToken(response.data.sessionToken);
      }
      
      logger.info('Node registered successfully', { nodeId: request.nodeId });
      return response.data;
    } catch (error) {
      logger.error('Failed to register node', { error, nodeId: request.nodeId });
      throw error;
    }
  }

  async sendHeartbeat(
    nodeId: string,
    data: HeartbeatRequest
  ): Promise<HeartbeatResponse> {
    try {
      const response = await this.client.post<HeartbeatResponse>(
        `/api/v1/nodes/${nodeId}/heartbeat`,
        data
      );
      return response.data;
    } catch (error) {
      logger.error('Failed to send heartbeat', { error, nodeId });
      throw error;
    }
  }

  async unregister(nodeId: string): Promise<void> {
    try {
      logger.info('Unregistering node from bosonserver', { nodeId });
      await this.client.delete(`/api/v1/nodes/${nodeId}`);
      logger.info('Node unregistered successfully', { nodeId });
    } catch (error) {
      // Log error but don't throw - we're shutting down anyway
      logger.warn('Failed to unregister node (non-critical during shutdown)', { error, nodeId });
    }
  }

  async sendMetrics(data: MetricsRequest): Promise<void> {
    try {
      await this.client.post('/api/v1/metrics', data);
    } catch (error: any) {
      // Don't log 429 as error - it's rate limiting, expected behavior
      if (error?.statusCode === 429) {
        logger.debug('Metrics send rate limited', { nodeId: data.nodeId });
      } else {
        logger.error('Failed to send metrics', { error, nodeId: data.nodeId });
      }
      throw error;
    }
  }

  async getTurnServers(): Promise<TurnServer[]> {
    try {
      const response = await this.client.get<{ servers: TurnServer[] }>(
        '/api/v1/turn/servers'
      );
      return response.data.servers;
    } catch (error) {
      logger.error('Failed to get TURN servers', { error });
      throw error;
    }
  }

  async getStunServers(): Promise<StunServer[]> {
    try {
      const response = await this.client.get<{ servers: StunServer[] }>(
        '/api/v1/turn/stun'
      );
      return response.data.servers;
    } catch (error) {
      logger.error('Failed to get STUN servers', { error });
      throw error;
    }
  }

  async getIceServers(): Promise<any[]> {
    try {
      const response = await this.client.get<{ iceServers: any[] }>(
        '/api/v1/turn/ice'
      );
      return response.data.iceServers;
    } catch (error) {
      logger.error('Failed to get ICE servers', { error });
      throw error;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.client.get('/health');
      return response.status === 200;
    } catch (error) {
      logger.error('Health check failed', { error });
      return false;
    }
  }

  async retryRequest<T>(
    fn: () => Promise<T>,
    attempts = config.bosonServer.retryAttempts,
    delay = config.bosonServer.retryDelay
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;
        
        // Check if it's a rate limit error (429)
        const isRateLimit = (error as any)?.statusCode === 429;
        
        if (i < attempts - 1) {
          // For rate limit errors, use longer backoff
          let waitTime: number;
          if (isRateLimit) {
            // Exponential backoff with minimum 5 seconds for rate limits
            waitTime = Math.max(5000, delay * Math.pow(2, i + 2));
          } else {
            waitTime = delay * Math.pow(2, i); // Standard exponential backoff
          }
          
          logger.warn(`Request failed, retrying in ${waitTime}ms...`, {
            attempt: i + 1,
            attempts,
            error: lastError.message,
            isRateLimit,
          });
          await new Promise((resolve) => setTimeout(resolve, waitTime));
        }
      }
    }

    throw lastError || new Error('Request failed after retries');
  }
}

