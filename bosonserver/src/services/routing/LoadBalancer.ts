import { Node } from '../../database/models';
import { logger } from '../../utils/logger';

export class LoadBalancer {
  /**
   * Select the best node based on load balancing criteria
   */
  selectNode(nodes: Node[], requirements?: {
    minBandwidth?: number;
    maxLatency?: number;
    preferredLocation?: string;
    preferredCountry?: string;
  }): Node | null {
    if (nodes.length === 0) {
      return null;
    }

    // Filter nodes based on requirements
    let filteredNodes = nodes.filter((node) => {
      if (requirements?.minBandwidth) {
        const bandwidth = node.capabilities.bandwidth.down;
        if (bandwidth < requirements.minBandwidth) {
          return false;
        }
      }

      if (requirements?.preferredCountry) {
        return node.location.country === requirements.preferredCountry;
      }

      if (requirements?.preferredLocation) {
        return node.location.region === requirements.preferredLocation;
      }

      return true;
    });

    // If no nodes match filters, use all nodes
    if (filteredNodes.length === 0) {
      filteredNodes = nodes;
    }

    // Score nodes based on multiple factors
    const scoredNodes = filteredNodes.map((node) => ({
      node,
      score: this.calculateScore(node, requirements),
    }));

    // Sort by score (highest first)
    scoredNodes.sort((a, b) => b.score - a.score);

    const selected = scoredNodes[0]?.node || null;
    logger.debug('Node selected by load balancer', {
      nodeId: selected?.nodeId,
      totalNodes: nodes.length,
      filteredNodes: filteredNodes.length,
    });

    return selected;
  }

  /**
   * Calculate a score for a node based on various factors
   */
  private calculateScore(node: Node, requirements?: {
    maxLatency?: number;
  }): number {
    let score = 100;

    // Prefer online nodes over degraded
    if (node.status === 'degraded') {
      score -= 20;
    }

    // Prefer nodes with more available bandwidth
    const bandwidthUtilization = node.capabilities.bandwidth.down;
    score += Math.min(bandwidthUtilization / 100, 50); // Up to 50 points for bandwidth

    // Prefer nodes with more available connections
    const connectionUtilization = node.capabilities.maxConnections;
    score += Math.min(connectionUtilization / 10, 30); // Up to 30 points for connections

    // Penalize nodes that are close to capacity
    // (This would require current metrics, simplified here)

    return score;
  }

  /**
   * Distribute load across multiple nodes
   */
  distributeLoad(nodes: Node[], count: number): Node[] {
    if (nodes.length === 0 || count <= 0) {
      return [];
    }

    const selected: Node[] = [];
    const used = new Set<string>();

    // Simple round-robin with scoring
    for (let i = 0; i < count && selected.length < nodes.length; i++) {
      const available = nodes.filter((n) => !used.has(n.nodeId));
      if (available.length === 0) {
        break;
      }

      const selectedNode = this.selectNode(available);
      if (selectedNode) {
        selected.push(selectedNode);
        used.add(selectedNode.nodeId);
      }
    }

    return selected;
  }
}

