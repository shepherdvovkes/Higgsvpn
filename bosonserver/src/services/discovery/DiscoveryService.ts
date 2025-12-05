import { NodeRegistry } from './NodeRegistry';
import { HeartbeatManager } from './HeartbeatManager';
import { Node } from '../../database/models';
import { logger } from '../../utils/logger';
import jwt, { SignOptions } from 'jsonwebtoken';
import { config } from '../../config/config';

export interface RegisterNodeRequest {
  nodeId: string;
  publicKey: string;
  networkInfo: Node['networkInfo'];
  capabilities: Node['capabilities'];
  metrics?: {
    latency: number;
    jitter: number;
    packetLoss: number;
    cpuUsage: number;
    memoryUsage: number;
  };
  location: Node['location'];
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

export class DiscoveryService {
  private nodeRegistry: NodeRegistry;
  private heartbeatManager: HeartbeatManager;

  constructor() {
    this.nodeRegistry = new NodeRegistry();
    this.heartbeatManager = new HeartbeatManager(this.nodeRegistry);
  }

  async registerNode(request: RegisterNodeRequest): Promise<RegisterNodeResponse> {
    try {
      // Generate session token
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
      // @ts-expect-error - jsonwebtoken types issue with expiresIn
      const sessionToken = jwt.sign(
        {
          nodeId: request.nodeId,
          type: 'node',
        },
        String(config.jwt.secret),
        {
          expiresIn: config.jwt.expiresIn,
        }
      );

      // Create node object
      const node: Omit<Node, 'registeredAt' | 'lastHeartbeat'> = {
        nodeId: request.nodeId,
        publicKey: request.publicKey,
        networkInfo: request.networkInfo,
        capabilities: request.capabilities,
        location: request.location,
        status: 'online',
        sessionToken,
        expiresAt,
      };

      // Register node
      await this.nodeRegistry.registerNode(node);

      // Get relay and STUN servers configuration
      const relayServers = this.getRelayServers();
      const stunServers = this.getStunServers();

      logger.info('Node registered successfully', { nodeId: request.nodeId });

      return {
        nodeId: request.nodeId,
        status: 'registered',
        relayServers,
        stunServers,
        sessionToken,
        expiresAt: expiresAt.getTime(),
      };
    } catch (error) {
      logger.error('Failed to register node', { error, nodeId: request.nodeId });
      throw error;
    }
  }

  async processHeartbeat(nodeId: string, data: any): Promise<any> {
    return this.heartbeatManager.processHeartbeat(nodeId, data);
  }

  async updateNodePublicIp(nodeId: string, publicIp: string): Promise<void> {
    return this.nodeRegistry.updateNodePublicIp(nodeId, publicIp);
  }

  async getNode(nodeId: string): Promise<Node | null> {
    return this.nodeRegistry.getNode(nodeId);
  }

  async getAllActiveNodes(): Promise<Node[]> {
    return this.nodeRegistry.getAllActiveNodes();
  }

  async deleteNode(nodeId: string): Promise<void> {
    return this.nodeRegistry.deleteNode(nodeId);
  }

  startCleanupTask(): void {
    this.heartbeatManager.startCleanupTask();
  }

  stopCleanupTask(): void {
    this.heartbeatManager.stopCleanupTask();
  }

  private getRelayServers(): Array<{
    id: string;
    host: string;
    port: number;
    protocol: 'tcp' | 'udp' | 'websocket';
  }> {
    // In production, this would be configurable
    return [
      {
        id: 'relay-1',
        host: process.env.RELAY_HOST || 'localhost',
        port: parseInt(process.env.RELAY_PORT || '3000', 10),
        protocol: 'websocket' as const,
      },
    ];
  }

  private getStunServers(): Array<{
    host: string;
    port: number;
  }> {
    // Use public STUN servers by default, or configured ones
    const stunHost = process.env.STUN_HOST;
    const stunPort = parseInt(process.env.STUN_PORT || '3478', 10);
    
    if (stunHost && stunHost !== 'localhost' && stunHost !== '0.0.0.0') {
      return [
        {
          host: stunHost,
          port: stunPort,
        },
      ];
    }
    
    // Default to public STUN servers
    return [
      {
        host: 'stun.l.google.com',
        port: 19302,
      },
      {
        host: 'stun1.l.google.com',
        port: 19302,
      },
    ];
  }
}

