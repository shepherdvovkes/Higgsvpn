import { ClientService } from '../src/services/ClientService';
import { ApiClient } from '../src/services/ApiClient';
import { WebSocketRelay } from '../src/services/WebSocketRelay';

jest.mock('../src/services/ApiClient');
jest.mock('../src/services/WebSocketRelay');
jest.mock('../src/utils/network', () => ({
  getLocalIPv4: jest.fn(() => '192.168.1.1'),
}));

describe('ClientService', () => {
  let clientService: ClientService;
  let mockApiClient: jest.Mocked<ApiClient>;
  let mockRelay: jest.Mocked<WebSocketRelay>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockApiClient = {
      healthCheck: jest.fn(),
      requestRoute: jest.fn(),
      getRoute: jest.fn(),
    } as any;

    mockRelay = {
      connect: jest.fn(),
      disconnect: jest.fn(),
      sendPacket: jest.fn(),
      isRelayConnected: jest.fn(),
      on: jest.fn(),
    } as any;

    (ApiClient as unknown as jest.Mock).mockImplementation(() => mockApiClient);
    (WebSocketRelay as unknown as jest.Mock).mockImplementation(() => mockRelay);

    clientService = new ClientService('test-client-id');
  });

  describe('connect', () => {
    it('should successfully connect to VPN', async () => {
      mockApiClient.healthCheck.mockResolvedValue(true);
      mockApiClient.requestRoute.mockResolvedValue({
        routes: [],
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
      });
      mockRelay.connect.mockResolvedValue(undefined);

      await clientService.connect();

      expect(mockApiClient.healthCheck).toHaveBeenCalled();
      expect(mockApiClient.requestRoute).toHaveBeenCalled();
      expect(mockRelay.connect).toHaveBeenCalled();
      expect(clientService.getStatus().connected).toBe(true);
    });

    it('should throw error if server is not healthy', async () => {
      mockApiClient.healthCheck.mockResolvedValue(false);

      await expect(clientService.connect()).rejects.toThrow('Server is not healthy');
    });

    it('should throw error if route request fails', async () => {
      mockApiClient.healthCheck.mockResolvedValue(true);
      mockApiClient.requestRoute.mockRejectedValue(new Error('Route request failed'));

      await expect(clientService.connect()).rejects.toThrow('Route request failed');
    });
  });

  describe('disconnect', () => {
    it('should disconnect from VPN', async () => {
      // First connect
      mockApiClient.healthCheck.mockResolvedValue(true);
      mockApiClient.requestRoute.mockResolvedValue({
        routes: [],
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
      });
      mockRelay.connect.mockResolvedValue(undefined);

      await clientService.connect();
      await clientService.disconnect();

      expect(mockRelay.disconnect).toHaveBeenCalled();
      expect(clientService.getStatus().connected).toBe(false);
    });
  });

  describe('sendPacket', () => {
    it('should send packet through relay', () => {
      const packet = Buffer.from('test packet');
      clientService.getStatus().connected = true;

      clientService.sendPacket(packet);

      expect(mockRelay.sendPacket).toHaveBeenCalledWith(packet);
    });

    it('should throw error if not connected', () => {
      clientService.getStatus().connected = false;

      expect(() => clientService.sendPacket(Buffer.from('test'))).toThrow('Not connected');
    });
  });
});

