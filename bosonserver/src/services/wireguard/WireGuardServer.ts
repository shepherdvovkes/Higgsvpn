import dgram from 'dgram';
import { EventEmitter } from 'events';
import { logger } from '../../utils/logger';
import { config } from '../../config/config';
import { DiscoveryService } from '../discovery/DiscoveryService';
import axios, { AxiosInstance } from 'axios';

export interface WireGuardPacket {
  sessionId: string;
  clientId: string;
  nodeId: string;
  data: Buffer;
  timestamp: number;
}

export class WireGuardServer extends EventEmitter {
  private server: dgram.Socket | null = null;
  private discoveryService: DiscoveryService;
  private apiClient: AxiosInstance;
  private clientSessions = new Map<string, { nodeId: string; clientId: string; lastSeen: number }>();
  private readonly WIREGUARD_PORT = parseInt(process.env.WIREGUARD_PORT || '51820', 10);
  private readonly SESSION_TIMEOUT = 300000; // 5 minutes

  constructor(discoveryService: DiscoveryService) {
    super();
    this.discoveryService = discoveryService;
    
    // Create API client for sending packets to nodes
    const bosonServerUrl = process.env.BOSON_SERVER_URL || 'http://localhost:3000';
    this.apiClient = axios.create({
      baseURL: bosonServerUrl,
      timeout: 5000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  async start(): Promise<void> {
    try {
      logger.info('Starting WireGuard UDP server', { port: this.WIREGUARD_PORT });

      this.server = dgram.createSocket('udp4');

      this.server.on('message', async (msg: Buffer, rinfo: dgram.RemoteInfo) => {
        await this.handlePacket(msg, rinfo);
      });

      this.server.on('error', (error) => {
        logger.error('WireGuard server error', { error });
        this.emit('error', error);
      });

      this.server.on('listening', () => {
        const address = this.server?.address();
        logger.info('WireGuard UDP server listening', { 
          address: address?.address, 
          port: address?.port 
        });
        this.emit('listening');
      });

      this.server.bind(this.WIREGUARD_PORT);

      // Start session cleanup
      this.startSessionCleanup();
    } catch (error) {
      logger.error('Failed to start WireGuard server', { error });
      throw error;
    }
  }

  private async handlePacket(data: Buffer, rinfo: dgram.RemoteInfo): Promise<void> {
    try {
      // Get or create session for this client
      const clientKey = `${rinfo.address}:${rinfo.port}`;
      const session = this.clientSessions.get(clientKey);

      if (!session) {
        // New client - need to get node assignment from routing service
        // For now, we'll need to get this from the routing request
        // This is a simplified version - in production, client should request route first
        logger.warn('Packet from unknown client, ignoring', { clientKey });
        return;
      }

      // Check if this is a WireGuard packet (first byte 0x01-0x04)
      const firstByte = data[0];
      if (firstByte < 0x01 || firstByte > 0x04) {
        logger.debug('Invalid WireGuard packet format', { firstByte });
        return;
      }

      // Send packet to node via API
      await this.sendPacketToNode(session.nodeId, session.clientId, data);

      // Update last seen
      session.lastSeen = Date.now();
    } catch (error) {
      logger.error('Failed to handle WireGuard packet', { error });
    }
  }

  private async sendPacketToNode(nodeId: string, clientId: string, packet: Buffer): Promise<void> {
    try {
      // Get node info to find its API endpoint
      const node = await this.discoveryService.getNode(nodeId);
      if (!node) {
        logger.warn('Node not found', { nodeId });
        return;
      }

      // Get node's API URL from networkInfo or use default
      const nodeApiUrl = node.networkInfo?.ipv4 
        ? `http://${node.networkInfo.ipv4}:${process.env.NODE_API_PORT || '3000'}`
        : process.env.DEFAULT_NODE_API_URL || 'http://localhost:3000';

      // Send packet to node via API
      try {
        await axios.post(
          `${nodeApiUrl}/api/v1/packets`,
          {
            clientId,
            nodeId,
            packet: packet.toString('base64'),
            timestamp: Date.now(),
          },
          {
            timeout: 5000,
            headers: {
              'Content-Type': 'application/json',
            },
          }
        );
      } catch (apiError: any) {
        // If direct API call fails, use relay through BOSONSERVER
        logger.debug('Direct node API call failed, using relay', { error: apiError.message });
        
        // Use WebSocket relay or HTTP relay through BOSONSERVER
        // This will be handled by RelayService
        this.emit('packetToNode', {
          nodeId,
          clientId,
          packet,
        });
      }
    } catch (error) {
      logger.error('Failed to send packet to node', { error, nodeId, clientId });
    }
  }

  async registerClientSession(
    clientId: string,
    nodeId: string,
    clientAddress: string,
    clientPort: number
  ): Promise<void> {
    const clientKey = `${clientAddress}:${clientPort}`;
    this.clientSessions.set(clientKey, {
      nodeId,
      clientId,
      lastSeen: Date.now(),
    });
    logger.info('Client session registered', { clientId, nodeId, clientKey });
  }

  async sendPacketToClient(
    clientAddress: string,
    clientPort: number,
    packet: Buffer
  ): Promise<void> {
    if (!this.server) {
      logger.warn('WireGuard server not started');
      return;
    }

    try {
      this.server.send(packet, clientPort, clientAddress, (error) => {
        if (error) {
          logger.error('Failed to send packet to client', { error, clientAddress, clientPort });
        }
      });
    } catch (error) {
      logger.error('Failed to send packet to client', { error, clientAddress, clientPort });
    }
  }

  private startSessionCleanup(): void {
    setInterval(() => {
      const now = Date.now();
      for (const [key, session] of this.clientSessions.entries()) {
        if (now - session.lastSeen > this.SESSION_TIMEOUT) {
          this.clientSessions.delete(key);
          logger.debug('Client session expired', { key, clientId: session.clientId });
        }
      }
    }, 60000); // Check every minute
  }

  async stop(): Promise<void> {
    if (this.server) {
      this.server.close();
      this.server = null;
      logger.info('WireGuard UDP server stopped');
    }
    this.clientSessions.clear();
  }
}

