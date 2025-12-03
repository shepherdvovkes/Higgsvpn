import { db } from '../../database/postgres';
import { redis } from '../../database/redis';
import { Metric } from '../../database/models';
import { logger } from '../../utils/logger';

export class MetricsCollector {
  private readonly CACHE_TTL = 300; // 5 minutes

  async collectMetrics(nodeId: string, metrics: Metric['metrics']): Promise<void> {
    try {
      const metric: Metric = {
        nodeId,
        metrics,
        timestamp: new Date(),
      };

      // Store in database
      await db.query(
        `INSERT INTO metrics (node_id, timestamp, metrics)
         VALUES ($1, NOW(), $2)`,
        [nodeId, JSON.stringify(metrics)]
      );

      // Cache latest metrics
      await redis.set(`metrics:${nodeId}:latest`, metric, this.CACHE_TTL);

      logger.debug('Metrics collected', { nodeId });
    } catch (error) {
      logger.error('Failed to collect metrics', { error, nodeId });
      throw error;
    }
  }

  async getLatestMetrics(nodeId: string): Promise<Metric | null> {
    try {
      // Try cache first
      const cached = await redis.get<Metric>(`metrics:${nodeId}:latest`);
      if (cached) {
        return cached;
      }

      // Query database
      const result = await db.query<Metric>(
        `SELECT * FROM metrics 
         WHERE node_id = $1 
         ORDER BY timestamp DESC 
         LIMIT 1`,
        [nodeId]
      );

      if (result.length === 0) {
        return null;
      }

      return this.mapRowToMetric(result[0]);
    } catch (error) {
      logger.error('Failed to get latest metrics', { error, nodeId });
      return null;
    }
  }

  async getMetricsHistory(
    nodeId: string,
    startTime: Date,
    endTime: Date,
    interval: 'minute' | 'hour' | 'day' = 'hour'
  ): Promise<Metric[]> {
    try {
      const result = await db.query<Metric>(
        `SELECT * FROM metrics 
         WHERE node_id = $1 
         AND timestamp >= $2 
         AND timestamp <= $3 
         ORDER BY timestamp ASC`,
        [nodeId, startTime, endTime]
      );

      return result.map((row) => this.mapRowToMetric(row));
    } catch (error) {
      logger.error('Failed to get metrics history', { error, nodeId });
      return [];
    }
  }

  async getAggregatedMetrics(
    nodeId: string,
    startTime: Date,
    endTime: Date
  ): Promise<{
    avgLatency: number;
    avgJitter: number;
    avgPacketLoss: number;
    avgCpuUsage: number;
    avgMemoryUsage: number;
    totalBytesSent: number;
    totalBytesReceived: number;
  }> {
    try {
      const result = await db.query<{
        avg_latency: number;
        avg_jitter: number;
        avg_packet_loss: number;
        avg_cpu_usage: number;
        avg_memory_usage: number;
        total_bytes_sent: number;
        total_bytes_received: number;
      }>(
        `SELECT 
          AVG((metrics->'network'->>'latency')::numeric) as avg_latency,
          AVG((metrics->'network'->>'jitter')::numeric) as avg_jitter,
          AVG((metrics->'network'->>'packetLoss')::numeric) as avg_packet_loss,
          AVG((metrics->'system'->>'cpuUsage')::numeric) as avg_cpu_usage,
          AVG((metrics->'system'->>'memoryUsage')::numeric) as avg_memory_usage,
          SUM((metrics->'wireguard'->'bytes'->>'sent')::bigint) as total_bytes_sent,
          SUM((metrics->'wireguard'->'bytes'->>'received')::bigint) as total_bytes_received
         FROM metrics 
         WHERE node_id = $1 
         AND timestamp >= $2 
         AND timestamp <= $3`,
        [nodeId, startTime, endTime]
      );

      if (result.length === 0) {
        return {
          avgLatency: 0,
          avgJitter: 0,
          avgPacketLoss: 0,
          avgCpuUsage: 0,
          avgMemoryUsage: 0,
          totalBytesSent: 0,
          totalBytesReceived: 0,
        };
      }

      const row = result[0];
      return {
        avgLatency: parseFloat(String(row.avg_latency || '0')),
        avgJitter: parseFloat(String(row.avg_jitter || '0')),
        avgPacketLoss: parseFloat(String(row.avg_packet_loss || '0')),
        avgCpuUsage: parseFloat(String(row.avg_cpu_usage || '0')),
        avgMemoryUsage: parseFloat(String(row.avg_memory_usage || '0')),
        totalBytesSent: parseInt(String(row.total_bytes_sent || '0'), 10),
        totalBytesReceived: parseInt(String(row.total_bytes_received || '0'), 10),
      };
    } catch (error) {
      logger.error('Failed to get aggregated metrics', { error, nodeId });
      throw error;
    }
  }

  async cleanupOldMetrics(retentionDays: number = 30): Promise<number> {
    try {
      const result = await db.query<{ count: string }>(
        `DELETE FROM metrics 
         WHERE timestamp < NOW() - INTERVAL '${retentionDays} days'
         RETURNING id`
      );

      const deletedCount = result.length;
      logger.info('Cleaned up old metrics', { count: deletedCount, retentionDays });
      return deletedCount;
    } catch (error) {
      logger.error('Failed to cleanup old metrics', { error });
      return 0;
    }
  }

  private mapRowToMetric(row: any): Metric {
    return {
      nodeId: row.node_id,
      timestamp: new Date(row.timestamp),
      metrics: row.metrics,
    };
  }
}

