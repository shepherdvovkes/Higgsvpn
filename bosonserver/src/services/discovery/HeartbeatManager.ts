import { NodeRegistry } from './NodeRegistry';
import { logger } from '../../utils/logger';
import { Node } from '../../database/models';

export interface HeartbeatData {
  metrics?: {
    latency: number;
    jitter: number;
    packetLoss: number;
    cpuUsage: number;
    memoryUsage: number;
    activeConnections: number;
    bandwidth: {
      up: number;
      down: number;
    };
  };
  status?: Node['status'];
}

export class HeartbeatManager {
  private nodeRegistry: NodeRegistry;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private readonly CLEANUP_INTERVAL_MS = 1 * 60 * 1000; // 1 minute - more frequent cleanup

  constructor(nodeRegistry: NodeRegistry) {
    this.nodeRegistry = nodeRegistry;
  }

  async processHeartbeat(nodeId: string, data: HeartbeatData): Promise<{
    status: string;
    nextHeartbeat: number;
    actions: Array<{ type: string; payload: any }>;
  }> {
    try {
      // Determine node status based on metrics
      let status: Node['status'] = 'online';
      if (data.metrics) {
        if (
          data.metrics.cpuUsage > 90 ||
          data.metrics.memoryUsage > 90 ||
          data.metrics.packetLoss > 10
        ) {
          status = 'degraded';
        }
      }

      // Update heartbeat
      await this.nodeRegistry.updateHeartbeat(
        nodeId,
        data.metrics,
        data.status || status
      );

      // Determine next heartbeat interval (adaptive based on status)
      const nextHeartbeat = status === 'online' ? 30 : 10; // seconds

      // Collect any actions needed (e.g., config updates, maintenance)
      const actions: Array<{ type: string; payload: any }> = [];

      logger.debug('Heartbeat processed', { nodeId, status, nextHeartbeat });

      return {
        status: 'ok',
        nextHeartbeat,
        actions,
      };
    } catch (error) {
      logger.error('Failed to process heartbeat', { error, nodeId });
      throw error;
    }
  }

  startCleanupTask(): void {
    if (this.cleanupInterval) {
      return;
    }

    this.cleanupInterval = setInterval(async () => {
      try {
        // First, mark nodes as offline if they haven't sent heartbeat in 2 minutes
        await this.nodeRegistry.markInactiveNodesOffline(2);
        // Then, remove nodes that have been inactive for 10 minutes
        await this.nodeRegistry.removeInactiveNodes(10);
      } catch (error) {
        logger.error('Cleanup task failed', { error });
      }
    }, this.CLEANUP_INTERVAL_MS);

    logger.info('Heartbeat cleanup task started');
  }

  stopCleanupTask(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      logger.info('Heartbeat cleanup task stopped');
    }
  }
}

