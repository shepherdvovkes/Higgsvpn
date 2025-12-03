import { Node } from '../../database/models';
import { Route } from '../../database/models';
import { LoadBalancer } from './LoadBalancer';
import { logger } from '../../utils/logger';

export interface RouteRequirements {
  minBandwidth?: number;
  maxLatency?: number;
  preferredLocation?: string;
  preferredCountry?: string;
  targetNodeId?: string;
}

export interface RouteSelection {
  id: string;
  type: 'direct' | 'relay' | 'cascade';
  path: string[];
  estimatedLatency: number;
  estimatedBandwidth: number;
  cost: number;
  priority: number;
}

export class RouteSelector {
  private loadBalancer: LoadBalancer;

  constructor() {
    this.loadBalancer = new LoadBalancer();
  }

  /**
   * Select optimal route based on requirements
   */
  async selectRoute(
    nodes: Node[],
    clientNetworkInfo: {
      ipv4: string;
      natType: string;
      stunMappedAddress?: string | null;
    },
    requirements: RouteRequirements
  ): Promise<RouteSelection | null> {
    try {
      // If target node is specified, try direct connection first
      if (requirements.targetNodeId) {
        const targetNode = nodes.find((n) => n.nodeId === requirements.targetNodeId);
        if (targetNode) {
          const directRoute = this.attemptDirectRoute(targetNode, clientNetworkInfo);
          if (directRoute) {
            return directRoute;
          }
        }
      }

      // Select best node using load balancer
      const selectedNode = this.loadBalancer.selectNode(nodes, requirements);
      if (!selectedNode) {
        logger.warn('No suitable node found for routing');
        return null;
      }

      // Try direct route first
      const directRoute = this.attemptDirectRoute(selectedNode, clientNetworkInfo);
      if (directRoute) {
        return directRoute;
      }

      // Fallback to relay route
      const relayRoute = this.createRelayRoute(selectedNode);
      return relayRoute;
    } catch (error) {
      logger.error('Failed to select route', { error });
      return null;
    }
  }

  /**
   * Attempt to create a direct P2P route
   */
  private attemptDirectRoute(
    node: Node,
    clientNetworkInfo: {
      ipv4: string;
      natType: string;
      stunMappedAddress?: string | null;
    }
  ): RouteSelection | null {
    // Direct connection is possible if:
    // 1. Both have public IPs, or
    // 2. NAT types allow hole punching (not both symmetric)

    const clientNatType = clientNetworkInfo.natType;
    const nodeNatType = node.networkInfo.natType;

    // Both symmetric NATs cannot establish direct connection
    if (clientNatType === 'Symmetric' && nodeNatType === 'Symmetric') {
      return null;
    }

    // If client has public IP or mapped address, direct connection is possible
    if (clientNetworkInfo.stunMappedAddress || clientNatType !== 'Symmetric') {
      return {
        id: `direct-${node.nodeId}-${Date.now()}`,
        type: 'direct',
        path: [node.nodeId],
        estimatedLatency: 50, // Base latency for direct connection
        estimatedBandwidth: node.capabilities.bandwidth.down,
        cost: 1,
        priority: 100,
      };
    }

    return null;
  }

  /**
   * Create a relay route through the server
   */
  private createRelayRoute(node: Node): RouteSelection {
    return {
      id: `relay-${node.nodeId}-${Date.now()}`,
      type: 'relay',
      path: [node.nodeId],
      estimatedLatency: 100, // Higher latency for relay
      estimatedBandwidth: Math.min(node.capabilities.bandwidth.down, 100), // Limited by relay
      cost: 2,
      priority: 50,
    };
  }

  /**
   * Calculate geographic distance between two coordinates
   */
  private calculateDistance(
    coords1: [number, number] | null,
    coords2: [number, number] | null
  ): number | null {
    if (!coords1 || !coords2) {
      return null;
    }

    const [lat1, lon1] = coords1;
    const [lat2, lon2] = coords2;

    const R = 6371; // Earth's radius in km
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) *
        Math.cos(this.toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;

    return distance;
  }

  private toRad(degrees: number): number {
    return (degrees * Math.PI) / 180;
  }
}

