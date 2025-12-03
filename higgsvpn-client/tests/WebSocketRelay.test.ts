import { WebSocketRelay } from '../src/services/WebSocketRelay';
import WebSocket from 'ws';

jest.mock('ws');

describe('WebSocketRelay', () => {
  let relay: WebSocketRelay;
  let mockWs: jest.Mocked<WebSocket>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockWs = {
      on: jest.fn(),
      send: jest.fn(),
      close: jest.fn(),
      readyState: WebSocket.OPEN,
    } as any;

    (WebSocket as unknown as jest.Mock).mockImplementation(() => mockWs);

    relay = new WebSocketRelay('wss://localhost:3000/relay', 'token-123');
  });

  describe('connect', () => {
    it('should connect to WebSocket relay', async () => {
      const connectPromise = relay.connect();

      // Simulate WebSocket open event
      const onOpenCallback = (mockWs.on as jest.Mock).mock.calls.find(
        (call) => call[0] === 'open'
      )?.[1];
      if (onOpenCallback) {
        onOpenCallback();
      }

      await connectPromise;

      expect(WebSocket).toHaveBeenCalledWith('wss://localhost:3000/relay', {
        headers: {
          Authorization: 'Bearer token-123',
        },
      });
      expect(relay.isRelayConnected()).toBe(true);
    });

    it('should handle connection errors', async () => {
      const connectPromise = relay.connect();

      // Simulate WebSocket error event
      const onErrorCallback = (mockWs.on as jest.Mock).mock.calls.find(
        (call) => call[0] === 'error'
      )?.[1];
      if (onErrorCallback) {
        onErrorCallback(new Error('Connection failed'));
      }

      await expect(connectPromise).rejects.toThrow();
    });
  });

  describe('sendPacket', () => {
    it('should send packet as base64', () => {
      relay.isRelayConnected = jest.fn(() => true);
      const packet = Buffer.from('test packet');

      relay.sendPacket(packet);

      expect(mockWs.send).toHaveBeenCalled();
      const sentData = JSON.parse((mockWs.send as jest.Mock).mock.calls[0][0]);
      expect(sentData.type).toBe('packet');
      expect(sentData.data).toBe(packet.toString('base64'));
    });

    it('should not send if not connected', () => {
      relay.isRelayConnected = jest.fn(() => false);

      relay.sendPacket(Buffer.from('test'));

      expect(mockWs.send).not.toHaveBeenCalled();
    });
  });

  describe('disconnect', () => {
    it('should close WebSocket connection', () => {
      relay.isRelayConnected = jest.fn(() => true);

      relay.disconnect();

      expect(mockWs.close).toHaveBeenCalled();
      expect(relay.isRelayConnected()).toBe(false);
    });
  });
});

