import { EventEmitter } from 'events';
import * as si from 'systeminformation';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import { WireGuardManager, WireGuardStats } from '../managers/WireGuardManager';
import { ApiClient, MetricsRequest } from '../services/ApiClient';
import { getLocalIPv4 } from '../utils/network';

export interface CollectedMetrics {
  network: {
    latency: number;
    jitter: number;
    packetLoss: number;
    bandwidth: {
      up: number;
      down: number;
    };
  };
  system: {
    cpuUsage: number;
    memoryUsage: number;
    diskUsage: number;
    loadAverage: number;
  };
  wireguard: {
    packets: {
      sent: number;
      received: number;
      errors: number;
    };
    bytes: {
      sent: number;
      received: number;
    };
  };
  connections: {
    active: number;
    total: number;
    failed: number;
  };
}

export class MetricsCollector extends EventEmitter {
  private wireGuardManager: WireGuardManager;
  private apiClient: ApiClient;
  private collectionTimer: NodeJS.Timeout | null = null;
  private previousStats: WireGuardStats | null = null;
  private previousCollectionTime: number = Date.now();
  private latencyHistory: number[] = [];
  private maxLatencyHistory = 10;

  constructor(wireGuardManager: WireGuardManager, apiClient: ApiClient) {
    super();
    this.wireGuardManager = wireGuardManager;
    this.apiClient = apiClient;
  }

  start(): void {
    if (this.collectionTimer) {
      return;
    }

    logger.info('Starting metrics collection', {
      interval: config.metrics.collectionInterval,
    });

    // Collect immediately
    this.collect();

    // Then schedule periodic collection
    this.collectionTimer = setInterval(() => {
      this.collect();
    }, config.metrics.collectionInterval * 1000);
  }

  stop(): void {
    if (this.collectionTimer) {
      clearInterval(this.collectionTimer);
      this.collectionTimer = null;
      logger.info('Metrics collection stopped');
    }
  }

  async collect(): Promise<CollectedMetrics> {
    try {
      const metrics = await this.gatherAllMetrics();
      this.emit('metricsCollected', metrics);
      return metrics;
    } catch (error) {
      logger.error('Failed to collect metrics', { error });
      throw error;
    }
  }

  private async gatherAllMetrics(): Promise<CollectedMetrics> {
    const [networkMetrics, systemMetrics, wireguardMetrics, connectionMetrics] = await Promise.all([
      this.collectNetworkMetrics(),
      this.collectSystemMetrics(),
      this.collectWireGuardMetrics(),
      this.collectConnectionMetrics(),
    ]);

    return {
      network: networkMetrics,
      system: systemMetrics,
      wireguard: wireguardMetrics,
      connections: connectionMetrics,
    };
  }

  private async collectNetworkMetrics(): Promise<CollectedMetrics['network']> {
    // Measure latency to BosonServer
    const latency = await this.measureLatency();
    this.latencyHistory.push(latency);
    if (this.latencyHistory.length > this.maxLatencyHistory) {
      this.latencyHistory.shift();
    }

    // Calculate jitter (variance in latency)
    const jitter = this.calculateJitter();

    // Packet loss would require more sophisticated measurement
    // For now, use WireGuard error count as proxy
    const packetLoss = 0; // TODO: Implement actual packet loss measurement

    // Bandwidth measurement would require tracking over time
    // For now, use WireGuard transfer stats
    const bandwidth = {
      up: 0, // TODO: Calculate from WireGuard stats
      down: 0, // TODO: Calculate from WireGuard stats
    };

    return {
      latency,
      jitter,
      packetLoss,
      bandwidth,
    };
  }

  private async measureLatency(): Promise<number> {
    try {
      const startTime = Date.now();
      await this.apiClient.healthCheck();
      const endTime = Date.now();
      return endTime - startTime;
    } catch (error) {
      logger.warn('Latency measurement failed', { error });
      return 0;
    }
  }

  private calculateJitter(): number {
    if (this.latencyHistory.length < 2) {
      return 0;
    }

    let jitter = 0;
    for (let i = 1; i < this.latencyHistory.length; i++) {
      const diff = Math.abs(this.latencyHistory[i] - this.latencyHistory[i - 1]);
      jitter += diff;
    }
    return jitter / (this.latencyHistory.length - 1);
  }

  private async collectSystemMetrics(): Promise<CollectedMetrics['system']> {
    try {
      const [cpu, mem, fsStats, loadAvg] = await Promise.all([
        si.currentLoad(),
        si.mem(),
        si.fsSize(),
        si.currentLoad(),
      ]);

      const cpuUsage = cpu.currentLoad || 0;
      const memoryUsage = ((mem.used || 0) / (mem.total || 1)) * 100;
      
      // Calculate disk usage (use first disk)
      let diskUsage = 0;
      if (fsStats && fsStats.length > 0) {
        const disk = fsStats[0];
        diskUsage = ((disk.used || 0) / (disk.size || 1)) * 100;
      }

      const loadAverage = loadAvg.avgLoad || 0;

      return {
        cpuUsage,
        memoryUsage,
        diskUsage,
        loadAverage,
      };
    } catch (error) {
      logger.error('Failed to collect system metrics', { error });
      return {
        cpuUsage: 0,
        memoryUsage: 0,
        diskUsage: 0,
        loadAverage: 0,
      };
    }
  }

  private async collectWireGuardMetrics(): Promise<CollectedMetrics['wireguard']> {
    try {
      const stats = await this.wireGuardManager.getStats();
      const currentTime = Date.now();
      const timeDelta = (currentTime - this.previousCollectionTime) / 1000; // seconds

      let packetsSent = stats.packets.sent;
      let packetsReceived = stats.packets.received;
      let bytesSent = stats.bytes.sent;
      let bytesReceived = stats.bytes.received;

      // Calculate deltas if we have previous stats
      if (this.previousStats && timeDelta > 0) {
        packetsSent = stats.packets.sent - this.previousStats.packets.sent;
        packetsReceived = stats.packets.received - this.previousStats.packets.received;
        bytesSent = stats.bytes.sent - this.previousStats.bytes.sent;
        bytesReceived = stats.bytes.received - this.previousStats.bytes.received;
      }

      this.previousStats = stats;
      this.previousCollectionTime = currentTime;

      return {
        packets: {
          sent: packetsSent,
          received: packetsReceived,
          errors: stats.packets.errors,
        },
        bytes: {
          sent: bytesSent,
          received: bytesReceived,
        },
      };
    } catch (error) {
      logger.error('Failed to collect WireGuard metrics', { error });
      return {
        packets: { sent: 0, received: 0, errors: 0 },
        bytes: { sent: 0, received: 0 },
      };
    }
  }

  private async collectConnectionMetrics(): Promise<CollectedMetrics['connections']> {
    try {
      const stats = await this.wireGuardManager.getStats();
      const activePeers = stats.peers.filter(
        (peer) => peer.latestHandshake > 0 && Date.now() / 1000 - peer.latestHandshake < 120
      ).length;

      return {
        active: activePeers,
        total: stats.peers.length,
        failed: 0, // TODO: Track failed connection attempts
      };
    } catch (error) {
      logger.error('Failed to collect connection metrics', { error });
      return {
        active: 0,
        total: 0,
        failed: 0,
      };
    }
  }

  async sendMetrics(nodeId: string, metrics: CollectedMetrics): Promise<void> {
    try {
      const request: MetricsRequest = {
        nodeId,
        timestamp: Date.now(),
        metrics,
      };

      await this.apiClient.sendMetrics(request);
      this.emit('metricsSent', metrics);
    } catch (error) {
      logger.error('Failed to send metrics', { error });
      this.emit('metricsSendError', error);
      throw error;
    }
  }

  getLatencyHistory(): number[] {
    return [...this.latencyHistory];
  }
}

