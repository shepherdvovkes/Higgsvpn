import { EventEmitter } from 'events';
import { StunClient, StunServer, NatType } from '../services/StunClient';
import { ApiClient } from '../services/ApiClient';
import { logger } from '../utils/logger';
import { getLocalIPv4 } from '../utils/network';

export interface IceCandidate {
  type: 'host' | 'server-reflexive' | 'relayed';
  address: string;
  port: number;
  priority: number;
}

export interface NatTraversalResult {
  natType: NatType;
  mappedAddress: string | null;
  mappedPort: number | null;
  candidates: IceCandidate[];
}

export class NatTraversalEngine extends EventEmitter {
  private stunClient: StunClient;
  private apiClient: ApiClient;
  private stunServers: StunServer[] = [];
  private currentResult: NatTraversalResult | null = null;

  constructor(apiClient: ApiClient) {
    super();
    this.stunClient = new StunClient();
    this.apiClient = apiClient;
  }

  async initialize(): Promise<void> {
    try {
      // Get STUN servers from BosonServer
      const servers = await this.apiClient.getStunServers();
      this.stunServers = servers;
      logger.info('STUN servers loaded', { count: servers.length });
    } catch (error) {
      logger.error('Failed to load STUN servers', { error });
      // Use fallback STUN servers
      this.stunServers = [
        { host: 'stun.l.google.com', port: 19302 },
        { host: 'stun1.l.google.com', port: 19302 },
      ];
    }
  }

  async detectNatType(): Promise<NatType> {
    if (this.stunServers.length === 0) {
      await this.initialize();
    }

    if (this.stunServers.length === 0) {
      logger.warn('No STUN servers available, defaulting to Symmetric NAT');
      return 'Symmetric';
    }

    try {
      // Use first available STUN server
      const server = this.stunServers[0];
      const natType = await this.stunClient.detectNatType(server);
      logger.info('NAT type detected', { natType });
      return natType;
    } catch (error: any) {
      const errorMessage = error?.message || error?.code || String(error);
      logger.warn('NAT type detection failed (non-critical, using default)', { 
        error: errorMessage,
        code: error?.code,
        hint: 'Defaulting to Symmetric NAT type. This is expected if STUN servers are unreachable.'
      });
      return 'Symmetric'; // Default to most restrictive
    }
  }

  async discoverMappedAddress(): Promise<{ address: string; port: number } | null> {
    if (this.stunServers.length === 0) {
      await this.initialize();
    }

    if (this.stunServers.length === 0) {
      return null;
    }

    try {
      const server = this.stunServers[0];
      const result = await this.stunClient.discover(server);
      logger.info('Mapped address discovered', { address: result.mappedAddress, port: result.mappedPort });
      return {
        address: result.mappedAddress,
        port: result.mappedPort,
      };
    } catch (error: any) {
      const errorMessage = error?.message || error?.code || String(error);
      logger.warn('Mapped address discovery failed (non-critical)', { 
        error: errorMessage,
        code: error?.code,
        server: `${this.stunServers[0]?.host}:${this.stunServers[0]?.port}`,
        hint: 'This is expected if STUN servers are unreachable, blocked by firewall, or behind a restrictive NAT'
      });
      return null;
    }
  }

  async gatherIceCandidates(localPort: number): Promise<IceCandidate[]> {
    const candidates: IceCandidate[] = [];

    // Host candidate (local IP)
    const localIP = getLocalIPv4();
    if (localIP) {
      candidates.push({
        type: 'host',
        address: localIP,
        port: localPort,
        priority: this.calculatePriority(126, 65535, 0), // Host candidates have highest priority
      });
    }

    // Server-reflexive candidates (from STUN)
    for (const server of this.stunServers) {
      try {
        const result = await this.stunClient.discover(server);
        candidates.push({
          type: 'server-reflexive',
          address: result.mappedAddress,
          port: result.mappedPort,
          priority: this.calculatePriority(100, 65535, 0),
        });
      } catch (error) {
        logger.warn('Failed to get server-reflexive candidate', { error, server });
      }
    }

    // Relayed candidates would come from TURN server
    // This would require TURN client implementation

    this.currentResult = {
      natType: await this.detectNatType(),
      mappedAddress: candidates.find(c => c.type === 'server-reflexive')?.address || null,
      mappedPort: candidates.find(c => c.type === 'server-reflexive')?.port || null,
      candidates,
    };

    logger.info('ICE candidates gathered', { count: candidates.length });
    this.emit('candidatesGathered', candidates);

    return candidates;
  }

  private calculatePriority(typePreference: number, localPreference: number, componentId: number): number {
    // RFC 5245 priority calculation
    return (typePreference << 24) | (localPreference << 8) | (256 - componentId);
  }

  async attemptUdpHolePunching(
    remoteAddress: string,
    remotePort: number,
    localPort: number
  ): Promise<boolean> {
    // UDP Hole Punching implementation
    // This is a simplified version - full implementation would require
    // coordination with the remote peer through a signaling server

    logger.info('Attempting UDP hole punching', { remoteAddress, remotePort, localPort });

    // The actual hole punching would involve:
    // 1. Both peers send packets to each other's mapped addresses
    // 2. This opens "holes" in the NAT
    // 3. Subsequent packets can flow directly

    // For now, return false to indicate relay should be used
    return false;
  }

  getCurrentResult(): NatTraversalResult | null {
    return this.currentResult;
  }

  getStunServers(): StunServer[] {
    return this.stunServers;
  }

  cleanup(): void {
    this.stunClient.close();
  }
}

