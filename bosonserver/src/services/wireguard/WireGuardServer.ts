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
  private relayService?: any; // RelayService, injected via setter
  private clientSessions = new Map<string, { nodeId: string; clientId: string; sessionId?: string; lastSeen: number }>();
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
      let session = this.clientSessions.get(clientKey);

      // If not found by IP:port (NAT case), try to find by clientId through relayService
      if (!session && this.relayService) {
        // Try to find client by matching against all active WebSocket sessions
        // This handles NAT where the source IP changes
        const activeSessions = this.relayService.getActiveWebSocketSessionIds();
        for (const sessionId of activeSessions) {
          try {
            const wsSession = await this.relayService.getSession(sessionId);
            if (wsSession && wsSession.clientId) {
              // Check if this clientId is registered in our clientSessions
              for (const [key, sess] of this.clientSessions.entries()) {
                if (sess.clientId === wsSession.clientId && sess.nodeId === wsSession.nodeId) {
                  // Found a match! Update the clientKey to the actual source IP (NAT public IP)
                  // This allows future packets to be matched directly
                  session = sess;
                  // Update the session with new clientKey (actual source IP after NAT)
                  this.clientSessions.set(clientKey, {
                    ...session,
                    lastSeen: Date.now(),
                  });
                  // Keep the old key too in case client switches back
                  logger.info('Matched client by sessionId, updated clientKey for NAT', {
                    clientId: session.clientId,
                    oldKey: key,
                    newKey: clientKey,
                    nodeId: session.nodeId,
                  });
                  break;
                }
              }
              if (session) break;
            }
          } catch (error) {
            // Continue searching
          }
        }
      }

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

      // Send packet to node via API or WebSocket relay
      await this.sendPacketToNode(session.nodeId, session.clientId, data, session.sessionId);

      // Update last seen
      session.lastSeen = Date.now();
      this.clientSessions.set(clientKey, session);
    } catch (error) {
      logger.error('Failed to handle WireGuard packet', { error });
    }
  }

  private async sendPacketToNode(nodeId: string, clientId: string, packet: Buffer, sessionId?: string): Promise<void> {
    try {
      // Try WebSocket relay first if sessionId is available
      if (sessionId && this.relayService) {
        const sent = await this.relayService.sendToSession(sessionId, packet);
        if (sent) {
          logger.debug('Packet sent to node via WebSocket relay', { nodeId, clientId, sessionId });
          return;
        }
      }

      // Try to find sessionId by clientId if not provided
      if (!sessionId && this.relayService) {
        // Find session by clientId
        const activeSessions = this.relayService.getActiveWebSocketSessionIds();
        for (const sid of activeSessions) {
          const session = await this.relayService.getSession(sid);
          if (session && session.clientId === clientId && session.nodeId === nodeId) {
            const sent = await this.relayService.sendToSession(sid, packet);
            if (sent) {
              logger.debug('Packet sent to node via WebSocket relay (found session)', { nodeId, clientId, sessionId: sid });
              return;
            }
          }
        }
      }

      // Fallback to direct API call
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
        logger.debug('Packet sent to node via direct API', { nodeId, clientId });
      } catch (apiError: any) {
        // If direct API call fails, emit event for ApiGateway to handle
        logger.debug('Direct node API call failed, emitting packetToNode event', { error: apiError.message });
        this.emit('packetToNode', {
          nodeId,
          clientId,
          packet,
          sessionId,
        });
      }
    } catch (error) {
      logger.error('Failed to send packet to node', { error, nodeId, clientId });
    }
  }

  setRelayService(relayService: any): void {
    this.relayService = relayService;
  }

  async registerClientSession(
    clientId: string,
    nodeId: string,
    clientAddress: string,
    clientPort: number,
    sessionId?: string
  ): Promise<void> {
    const clientKey = `${clientAddress}:${clientPort}`;
    this.clientSessions.set(clientKey, {
      nodeId,
      clientId,
      sessionId,
      lastSeen: Date.now(),
    });
    logger.info('WireGuard client session registered', { clientId, nodeId, clientKey, sessionId });
  }

  getClientSession(clientId: string): { nodeId: string; clientId: string; address: string; port: number } | null {
    for (const [key, session] of this.clientSessions.entries()) {
      if (session.clientId === clientId) {
        const [address, port] = key.split(':');
        return {
          ...session,
          address,
          port: parseInt(port, 10),
        };
      }
    }
    return null;
  }

  /**
   * Get all registered WireGuard client IDs
   */
  getRegisteredClientIds(): Set<string> {
    const clientIds = new Set<string>();
    for (const session of this.clientSessions.values()) {
      clientIds.add(session.clientId);
    }
    return clientIds;
  }

  /**
   * Check if a client ID has an active WireGuard registration
   */
  hasClientRegistration(clientId: string): boolean {
    return this.getClientSession(clientId) !== null;
  }

  async sendPacketToClientById(clientId: string, packet: Buffer): Promise<boolean> {
    const session = this.getClientSession(clientId);
    if (!session) {
      logger.debug('WireGuard client session not found', { clientId });
      return false;
    }

    await this.sendPacketToClient(session.address, session.port, packet);
    return true;
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



