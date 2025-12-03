import { ApiClient } from '../src/services/ApiClient';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('ApiClient', () => {
  let apiClient: ApiClient;
  let mockAxiosInstance: any;

  beforeEach(() => {
    mockAxiosInstance = {
      post: jest.fn(),
      get: jest.fn(),
      interceptors: {
        response: {
          use: jest.fn(),
        },
      },
    };

    (mockedAxios.create as jest.Mock) = jest.fn(() => mockAxiosInstance);
    apiClient = new ApiClient('http://localhost:3000');
    jest.clearAllMocks();
  });

  describe('requestRoute', () => {
    it('should successfully request a route', async () => {
      const mockResponse = {
        data: {
          routes: [
            {
              id: 'route-1',
              type: 'relay',
              path: ['node-1'],
              estimatedLatency: 50,
              estimatedBandwidth: 100,
              cost: 1,
              priority: 100,
            },
          ],
          selectedRoute: {
            id: 'route-1',
            relayEndpoint: 'wss://localhost:3000/relay/session-1',
            nodeEndpoint: {
              nodeId: 'node-1',
              directConnection: false,
            },
            sessionToken: 'token-123',
            expiresAt: Date.now() + 3600000,
          },
        },
      };

      mockAxiosInstance.post.mockResolvedValue(mockResponse);

      const request = {
        clientId: 'client-1',
        clientNetworkInfo: {
          ipv4: '192.168.1.1',
          natType: 'Symmetric' as const,
        },
      };

      const result = await apiClient.requestRoute(request);

      expect(result).toEqual(mockResponse.data);
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/api/v1/routing/request',
        request
      );
    });

    it('should throw RouteError on API error', async () => {
      mockAxiosInstance.post.mockRejectedValue({
        response: {
          status: 400,
          statusText: 'Bad Request',
          data: { error: 'Invalid request' },
        },
      });

      const request = {
        clientId: 'client-1',
        clientNetworkInfo: {
          ipv4: '192.168.1.1',
          natType: 'Symmetric' as const,
        },
      };

      await expect(apiClient.requestRoute(request)).rejects.toThrow('Failed to request route');
    });
  });

  describe('healthCheck', () => {
    it('should return true when server is healthy', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: { status: 'healthy' },
      });

      const result = await apiClient.healthCheck();

      expect(result).toBe(true);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/health');
    });

    it('should return false when server is not healthy', async () => {
      mockAxiosInstance.get.mockRejectedValue(new Error('Connection failed'));

      const result = await apiClient.healthCheck();

      expect(result).toBe(false);
    });
  });
});

