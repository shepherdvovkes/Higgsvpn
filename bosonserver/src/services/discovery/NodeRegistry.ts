import { db } from '../../database/postgres';
import { redis } from '../../database/redis';
import { Node } from '../../database/models';
import { logger } from '../../utils/logger';
import { NotFoundError } from '../../utils/errors';

export class NodeRegistry {
  private readonly CACHE_TTL = 60; // 60 seconds

  async registerNode(nodeData: Omit<Node, 'registeredAt' | 'lastHeartbeat'>): Promise<Node> {
    try {
      const node: Node = {
        ...nodeData,
        registeredAt: new Date(),
        lastHeartbeat: new Date(),
      };

      await db.query(
        `INSERT INTO nodes (
          node_id, public_key, network_info, capabilities, location, 
          status, last_heartbeat, registered_at, session_token, expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (node_id) 
        DO UPDATE SET
          public_key = EXCLUDED.public_key,
          network_info = EXCLUDED.network_info,
          capabilities = EXCLUDED.capabilities,
          location = EXCLUDED.location,
          status = EXCLUDED.status,
          last_heartbeat = EXCLUDED.last_heartbeat,
          session_token = EXCLUDED.session_token,
          expires_at = EXCLUDED.expires_at,
          updated_at = NOW()`,
        [
          node.nodeId,
          node.publicKey,
          JSON.stringify(node.networkInfo),
          JSON.stringify(node.capabilities),
          JSON.stringify(node.location),
          node.status,
          node.lastHeartbeat,
          node.registeredAt,
          node.sessionToken || null,
          node.expiresAt || null,
        ]
      );

      // Cache the node
      await redis.set(`node:${node.nodeId}`, node, this.CACHE_TTL);

      logger.info('Node registered', { nodeId: node.nodeId });
      return node;
    } catch (error) {
      logger.error('Failed to register node', { error, nodeId: nodeData.nodeId });
      throw error;
    }
  }

  async getNode(nodeId: string): Promise<Node | null> {
    try {
      // Try cache first
      const cached = await redis.get<Node>(`node:${nodeId}`);
      if (cached) {
        return cached;
      }

      // Query database
      const result = await db.query<Node>(
        'SELECT * FROM nodes WHERE node_id = $1',
        [nodeId]
      );

      if (result.length === 0) {
        return null;
      }

      const node = this.mapRowToNode(result[0]);
      
      // Cache the node
      await redis.set(`node:${nodeId}`, node, this.CACHE_TTL);

      return node;
    } catch (error) {
      logger.error('Failed to get node', { error, nodeId });
      throw error;
    }
  }

  async updateHeartbeat(nodeId: string, metrics?: any, status?: Node['status']): Promise<void> {
    try {
      const updates: string[] = ['last_heartbeat = NOW()'];
      const params: any[] = [nodeId];
      let paramIndex = 2;

      if (status) {
        updates.push(`status = $${paramIndex}`);
        params.push(status);
        paramIndex++;
      }

      await db.query(
        `UPDATE nodes SET ${updates.join(', ')}, updated_at = NOW() WHERE node_id = $1`,
        params
      );

      // Invalidate cache
      await redis.del(`node:${nodeId}`);

      logger.debug('Heartbeat updated', { nodeId });
    } catch (error) {
      logger.error('Failed to update heartbeat', { error, nodeId });
      throw error;
    }
  }

  async updateNodePublicIp(nodeId: string, publicIp: string): Promise<void> {
    try {
      // Get current node to update networkInfo
      const node = await this.getNode(nodeId);
      if (!node) {
        logger.warn('Cannot update public IP: node not found', { nodeId });
        return;
      }

      // Only update if IP has changed
      if (node.networkInfo.publicIp === publicIp) {
        return;
      }

      // Update networkInfo with new public IP
      const updatedNetworkInfo = {
        ...node.networkInfo,
        publicIp,
      };

      await db.query(
        `UPDATE nodes SET network_info = $1, updated_at = NOW() WHERE node_id = $2`,
        [JSON.stringify(updatedNetworkInfo), nodeId]
      );

      // Invalidate cache
      await redis.del(`node:${nodeId}`);

      logger.debug('Node public IP updated', { nodeId, publicIp });
    } catch (error) {
      logger.error('Failed to update node public IP', { error, nodeId, publicIp });
      // Don't throw - this is not critical
    }
  }

  async getAllActiveNodes(): Promise<Node[]> {
    try {
      const result = await db.query<Node>(
        `SELECT * FROM nodes 
         WHERE status IN ('online', 'degraded') 
         AND last_heartbeat > NOW() - INTERVAL '2 minutes'
         ORDER BY last_heartbeat DESC`
      );

      return result.map((row) => this.mapRowToNode(row));
    } catch (error) {
      logger.error('Failed to get active nodes', { error });
      throw error;
    }
  }

  async deleteNode(nodeId: string): Promise<void> {
    try {
      await db.query('DELETE FROM nodes WHERE node_id = $1', [nodeId]);
      await redis.del(`node:${nodeId}`);
      logger.info('Node deleted', { nodeId });
    } catch (error) {
      logger.error('Failed to delete node', { error, nodeId });
      throw error;
    }
  }

  async markInactiveNodesOffline(inactiveThresholdMinutes = 2): Promise<number> {
    try {
      const result = await db.query<{ node_id: string }>(
        `UPDATE nodes 
         SET status = 'offline', updated_at = NOW()
         WHERE status IN ('online', 'degraded')
         AND last_heartbeat < NOW() - INTERVAL '${inactiveThresholdMinutes} minutes'
         RETURNING node_id`
      );

      const updatedCount = result.length;
      
      // Invalidate cache for updated nodes
      for (const row of result) {
        await redis.del(`node:${row.node_id}`);
      }

      if (updatedCount > 0) {
        logger.info('Marked inactive nodes as offline', { count: updatedCount });
      }
      return updatedCount;
    } catch (error) {
      logger.error('Failed to mark inactive nodes as offline', { error });
      throw error;
    }
  }

  async removeInactiveNodes(inactiveThresholdMinutes = 10): Promise<number> {
    try {
      const result = await db.query<{ node_id: string }>(
        `DELETE FROM nodes 
         WHERE last_heartbeat < NOW() - INTERVAL '${inactiveThresholdMinutes} minutes'
         RETURNING node_id`
      );

      const deletedCount = result.length;
      
      // Remove from cache
      for (const row of result) {
        await redis.del(`node:${row.node_id}`);
      }

      if (deletedCount > 0) {
        logger.info('Removed inactive nodes', { count: deletedCount });
      }
      return deletedCount;
    } catch (error) {
      logger.error('Failed to remove inactive nodes', { error });
      throw error;
    }
  }

  private mapRowToNode(row: any): Node {
    return {
      nodeId: row.node_id,
      publicKey: row.public_key,
      networkInfo: row.network_info,
      capabilities: row.capabilities,
      location: row.location,
      status: row.status,
      lastHeartbeat: new Date(row.last_heartbeat),
      registeredAt: new Date(row.registered_at),
      sessionToken: row.session_token || undefined,
      expiresAt: row.expires_at ? new Date(row.expires_at) : undefined,
    };
  }
}

