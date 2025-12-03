import { Registry, Counter, Gauge, Histogram } from 'prom-client';
import { DiscoveryService } from '../discovery/DiscoveryService';
import { MetricsCollector } from './MetricsCollector';
import { logger } from '../../utils/logger';

export class PrometheusExporter {
  private registry: Registry;
  private activeNodesGauge: Gauge;
  private activeConnectionsGauge: Gauge;
  private relayBandwidthGauge: Gauge;
  private nodeLatencyHistogram: Histogram;
  private nodeCpuGauge: Gauge;
  private nodeMemoryGauge: Gauge;
  private apiRequestsCounter: Counter;
  private apiErrorsCounter: Counter;

  constructor() {
    this.registry = new Registry();
    this.registry.setDefaultLabels({ app: 'bosonserver' });

    // Define metrics
    this.activeNodesGauge = new Gauge({
      name: 'bosonserver_active_nodes',
      help: 'Number of active nodes',
      labelNames: ['status'],
    });

    this.activeConnectionsGauge = new Gauge({
      name: 'bosonserver_active_connections',
      help: 'Number of active connections',
    });

    this.relayBandwidthGauge = new Gauge({
      name: 'bosonserver_relay_bandwidth_bytes',
      help: 'Relay bandwidth in bytes',
      labelNames: ['direction'],
    });

    this.nodeLatencyHistogram = new Histogram({
      name: 'bosonserver_node_latency_ms',
      help: 'Node latency in milliseconds',
      labelNames: ['node_id'],
      buckets: [10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
    });

    this.nodeCpuGauge = new Gauge({
      name: 'bosonserver_node_cpu_usage_percent',
      help: 'Node CPU usage percentage',
      labelNames: ['node_id'],
    });

    this.nodeMemoryGauge = new Gauge({
      name: 'bosonserver_node_memory_usage_percent',
      help: 'Node memory usage percentage',
      labelNames: ['node_id'],
    });

    this.apiRequestsCounter = new Counter({
      name: 'bosonserver_api_requests_total',
      help: 'Total number of API requests',
      labelNames: ['method', 'endpoint', 'status'],
    });

    this.apiErrorsCounter = new Counter({
      name: 'bosonserver_api_errors_total',
      help: 'Total number of API errors',
      labelNames: ['method', 'endpoint', 'error_type'],
    });

    // Register all metrics
    this.registry.registerMetric(this.activeNodesGauge);
    this.registry.registerMetric(this.activeConnectionsGauge);
    this.registry.registerMetric(this.relayBandwidthGauge);
    this.registry.registerMetric(this.nodeLatencyHistogram);
    this.registry.registerMetric(this.nodeCpuGauge);
    this.registry.registerMetric(this.nodeMemoryGauge);
    this.registry.registerMetric(this.apiRequestsCounter);
    this.registry.registerMetric(this.apiErrorsCounter);
  }

  async updateMetrics(
    discoveryService: DiscoveryService,
    metricsCollector: MetricsCollector
  ): Promise<void> {
    try {
      // Update active nodes count
      const nodes = await discoveryService.getAllActiveNodes();
      const nodesByStatus = nodes.reduce((acc, node) => {
        acc[node.status] = (acc[node.status] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      // Reset and set new values
      this.activeNodesGauge.reset();
      for (const [status, count] of Object.entries(nodesByStatus)) {
        this.activeNodesGauge.set({ status }, count);
      }

      // Update node-specific metrics
      for (const node of nodes) {
        const latestMetrics = await metricsCollector.getLatestMetrics(node.nodeId);
        if (latestMetrics) {
          this.nodeLatencyHistogram.observe(
            { node_id: node.nodeId },
            latestMetrics.metrics.network.latency
          );
          this.nodeCpuGauge.set(
            { node_id: node.nodeId },
            latestMetrics.metrics.system.cpuUsage
          );
          this.nodeMemoryGauge.set(
            { node_id: node.nodeId },
            latestMetrics.metrics.system.memoryUsage
          );
        }
      }
    } catch (error) {
      logger.error('Failed to update Prometheus metrics', { error });
    }
  }

  recordApiRequest(method: string, endpoint: string, status: number): void {
    this.apiRequestsCounter.inc({ method, endpoint, status: status.toString() });
  }

  recordApiError(method: string, endpoint: string, errorType: string): void {
    this.apiErrorsCounter.inc({ method, endpoint, error_type: errorType });
  }

  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  getRegistry(): Registry {
    return this.registry;
  }
}

