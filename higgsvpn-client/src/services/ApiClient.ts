import axios, { AxiosInstance } from 'axios';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import { RouteError } from '../utils/errors';

export interface RouteRequest {
  clientId: string;
  targetNodeId?: string | null;
  requirements?: {
    minBandwidth?: number;
    maxLatency?: number;
    preferredLocation?: string;
    preferredCountry?: string;
  };
  clientNetworkInfo: {
    ipv4: string;
    natType: 'FullCone' | 'RestrictedCone' | 'PortRestricted' | 'Symmetric';
    stunMappedAddress?: string | null;
  };
}

export interface RouteResponse {
  routes: Array<{
    id: string;
    type: string;
    path: string[];
    estimatedLatency: number;
    estimatedBandwidth: number;
    cost: number;
    priority: number;
  }>;
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

export class ApiClient {
  private axiosInstance: AxiosInstance;

  constructor(serverUrl: string = config.serverUrl) {
    this.axiosInstance = axios.create({
      baseURL: serverUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Add response interceptor for error handling
    this.axiosInstance.interceptors.response.use(
      (response) => response,
      (error) => {
        logger.error('API request failed', {
          url: error.config?.url,
          method: error.config?.method,
          status: error.response?.status,
          message: error.message,
        });
        return Promise.reject(error);
      }
    );
  }

  async requestRoute(request: RouteRequest): Promise<RouteResponse> {
    try {
      logger.info('Requesting route', { clientId: request.clientId });
      const response = await this.axiosInstance.post<RouteResponse>(
        '/api/v1/routing/request',
        request
      );
      logger.info('Route received', {
        routeId: response.data.selectedRoute.id,
        nodeId: response.data.selectedRoute.nodeEndpoint.nodeId,
      });
      return response.data;
    } catch (error: any) {
      if (error.response) {
        const errorMessage = error.response.data?.error 
          ? (typeof error.response.data.error === 'string' 
              ? error.response.data.error 
              : JSON.stringify(error.response.data.error))
          : error.response.statusText;
        throw new RouteError(
          `Failed to request route: ${errorMessage} (Status: ${error.response.status})`
        );
      }
      throw new RouteError(`Failed to request route: ${error.message}`);
    }
  }

  async getRoute(routeId: string): Promise<any> {
    try {
      const response = await this.axiosInstance.get(`/api/v1/routing/route/${routeId}`);
      return response.data;
    } catch (error: any) {
      if (error.response) {
        throw new RouteError(
          `Failed to get route: ${error.response.data?.error || error.response.statusText}`
        );
      }
      throw new RouteError(`Failed to get route: ${error.message}`);
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.axiosInstance.get('/health');
      return response.data.status === 'healthy';
    } catch (error) {
      logger.error('Health check failed', { error });
      return false;
    }
  }
}

