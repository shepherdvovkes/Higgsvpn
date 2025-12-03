import { NodeRegistry } from '../../../../src/services/discovery/NodeRegistry';
import { Node } from '../../../../src/database/models';

// Mock database
jest.mock('../../../../src/database/postgres', () => ({
  db: {
    query: jest.fn(),
    transaction: jest.fn(),
  },
}));

jest.mock('../../../../src/database/redis', () => ({
  redis: {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  },
}));

describe('NodeRegistry', () => {
  let nodeRegistry: NodeRegistry;
  const mockNode: Omit<Node, 'registeredAt' | 'lastHeartbeat'> = {
    nodeId: 'test-node-id',
    publicKey: 'test-public-key',
    networkInfo: {
      ipv4: '192.168.1.1',
      ipv6: null,
      natType: 'FullCone',
      stunMappedAddress: null,
      localPort: 51820,
    },
    capabilities: {
      maxConnections: 100,
      bandwidth: {
        up: 100,
        down: 100,
      },
      routing: true,
      natting: true,
    },
    location: {
      country: 'US',
      region: 'US-CA',
      coordinates: [37.7749, -122.4194],
    },
    status: 'online',
  };

  beforeEach(() => {
    nodeRegistry = new NodeRegistry();
    jest.clearAllMocks();
  });

  describe('registerNode', () => {
    it('should register a new node', async () => {
      const { db } = require('../../../../src/database/postgres');
      db.query.mockResolvedValue([]);

      const { redis } = require('../../../../src/database/redis');
      redis.set.mockResolvedValue(undefined);

      const result = await nodeRegistry.registerNode(mockNode);

      expect(result.nodeId).toBe(mockNode.nodeId);
      expect(db.query).toHaveBeenCalled();
      expect(redis.set).toHaveBeenCalled();
    });
  });

  describe('getNode', () => {
    it('should get a node from cache', async () => {
      const { redis } = require('../../../../src/database/redis');
      redis.get.mockResolvedValue(mockNode);

      const result = await nodeRegistry.getNode('test-node-id');

      expect(result).toEqual(mockNode);
      expect(redis.get).toHaveBeenCalledWith('node:test-node-id');
    });

    it('should get a node from database if not in cache', async () => {
      const { redis } = require('../../../../src/database/redis');
      const { db } = require('../../../../src/database/postgres');

      redis.get.mockResolvedValue(null);
      db.query.mockResolvedValue([{
        node_id: 'test-node-id',
        public_key: 'test-public-key',
        network_info: mockNode.networkInfo,
        capabilities: mockNode.capabilities,
        location: mockNode.location,
        status: 'online',
        last_heartbeat: new Date(),
        registered_at: new Date(),
        session_token: null,
        expires_at: null,
      }]);

      const result = await nodeRegistry.getNode('test-node-id');

      expect(result).toBeDefined();
      expect(result?.nodeId).toBe('test-node-id');
    });
  });
});

