import { MetricsCollector } from './MetricsCollector';
import { PrometheusExporter } from './PrometheusExporter';
import { DiscoveryService } from '../discovery/DiscoveryService';
import { Metric } from '../../database/models';
import { logger } from '../../utils/logger';

export interface MetricsSubmission {
  nodeId: string;
  timestamp?: number;
  metrics: Metric['metrics'];
}

export class MetricsService {
  private metricsCollector: MetricsCollector;
  private prometheusExporter: PrometheusExporter;
  private discoveryService: DiscoveryService;
  private updateInterval: NodeJS.Timeout | null = null;
  private readonly UPDATE_INTERVAL_MS = 30 * 1000; // 30 seconds

  constructor(discoveryService: DiscoveryService) {
    this.metricsCollector = new MetricsCollector();
    this.prometheusExporter = new PrometheusExporter();
    this.discoveryService = discoveryService;
  }

  async submitMetrics(submission: MetricsSubmission): Promise<void> {
    try {
      await this.metricsCollector.collectMetrics(
        submission.nodeId,
        submission.metrics
      );

      logger.debug('Metrics submitted', { nodeId: submission.nodeId });
    } catch (error) {
      logger.error('Failed to submit metrics', { error, nodeId: submission.nodeId });
      throw error;
    }
  }

  async getLatestMetrics(nodeId: string): Promise<Metric | null> {
    return this.metricsCollector.getLatestMetrics(nodeId);
  }

  async getMetricsHistory(
    nodeId: string,
    startTime: Date,
    endTime: Date,
    interval: 'minute' | 'hour' | 'day' = 'hour'
  ): Promise<Metric[]> {
    return this.metricsCollector.getMetricsHistory(nodeId, startTime, endTime, interval);
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
    return this.metricsCollector.getAggregatedMetrics(nodeId, startTime, endTime);
  }

  async getPrometheusMetrics(): Promise<string> {
    return this.prometheusExporter.getMetrics();
  }

  startMetricsUpdate(): void {
    if (this.updateInterval) {
      return;
    }

    this.updateInterval = setInterval(async () => {
      try {
        await this.prometheusExporter.updateMetrics(
          this.discoveryService,
          this.metricsCollector
        );
      } catch (error) {
        logger.error('Failed to update metrics', { error });
      }
    }, this.UPDATE_INTERVAL_MS);

    logger.info('Metrics update task started');
  }

  stopMetricsUpdate(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
      logger.info('Metrics update task stopped');
    }
  }

  recordApiRequest(method: string, endpoint: string, status: number): void {
    this.prometheusExporter.recordApiRequest(method, endpoint, status);
  }

  recordApiError(method: string, endpoint: string, errorType: string): void {
    this.prometheusExporter.recordApiError(method, endpoint, errorType);
  }

  async cleanupOldMetrics(retentionDays: number = 30): Promise<number> {
    return this.metricsCollector.cleanupOldMetrics(retentionDays);
  }
}

