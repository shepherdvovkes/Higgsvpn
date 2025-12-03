import { EventEmitter } from 'events';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import { ResourceError } from '../utils/errors';
import { MetricsCollector, CollectedMetrics } from '../collectors/MetricsCollector';

export type ResourceStatus = 'normal' | 'degraded' | 'critical';

export interface ResourceLimits {
  maxConnections: number;
  maxCpuUsage: number;
  maxMemoryUsage: number;
}

export interface ResourceState {
  status: ResourceStatus;
  currentConnections: number;
  cpuUsage: number;
  memoryUsage: number;
  limits: ResourceLimits;
}

export class ResourceManager extends EventEmitter {
  private metricsCollector: MetricsCollector;
  private state: ResourceState;
  private monitoringTimer: NodeJS.Timeout | null = null;
  private monitoringInterval = 5000; // 5 seconds

  constructor(metricsCollector: MetricsCollector) {
    super();
    this.metricsCollector = metricsCollector;
    this.state = {
      status: 'normal',
      currentConnections: 0,
      cpuUsage: 0,
      memoryUsage: 0,
      limits: {
        maxConnections: config.resources.maxConnections,
        maxCpuUsage: config.resources.maxCpuUsage,
        maxMemoryUsage: config.resources.maxMemoryUsage,
      },
    };

    // Listen to metrics updates
    this.metricsCollector.on('metricsCollected', (metrics: CollectedMetrics) => {
      this.updateState(metrics);
    });
  }

  start(): void {
    if (this.monitoringTimer) {
      return;
    }

    logger.info('Starting resource monitoring');
    this.monitor();
    this.monitoringTimer = setInterval(() => {
      this.monitor();
    }, this.monitoringInterval);
  }

  stop(): void {
    if (this.monitoringTimer) {
      clearInterval(this.monitoringTimer);
      this.monitoringTimer = null;
      logger.info('Resource monitoring stopped');
    }
  }

  private async monitor(): Promise<void> {
    try {
      const metrics = await this.metricsCollector.collect();
      this.updateState(metrics);
      this.checkLimits();
    } catch (error) {
      logger.error('Resource monitoring failed', { error });
    }
  }

  private updateState(metrics: CollectedMetrics): void {
    const previousStatus = this.state.status;

    this.state.cpuUsage = metrics.system.cpuUsage;
    this.state.memoryUsage = metrics.system.memoryUsage;
    this.state.currentConnections = metrics.connections.active;

    // Determine status based on resource usage
    const cpuExceeded = this.state.cpuUsage > this.state.limits.maxCpuUsage;
    const memoryExceeded = this.state.memoryUsage > this.state.limits.maxMemoryUsage;
    const connectionsExceeded = this.state.currentConnections >= this.state.limits.maxConnections;

    if (cpuExceeded || memoryExceeded || connectionsExceeded) {
      if (cpuExceeded && memoryExceeded) {
        this.state.status = 'critical';
      } else {
        this.state.status = 'degraded';
      }
    } else {
      this.state.status = 'normal';
    }

    // Emit status change event
    if (previousStatus !== this.state.status) {
      logger.warn('Resource status changed', {
        from: previousStatus,
        to: this.state.status,
        cpuUsage: this.state.cpuUsage,
        memoryUsage: this.state.memoryUsage,
        connections: this.state.currentConnections,
      });
      this.emit('statusChange', this.state.status, previousStatus);
    }
  }

  private checkLimits(): void {
    const violations: string[] = [];

    if (this.state.cpuUsage > this.state.limits.maxCpuUsage) {
      violations.push(`CPU usage ${this.state.cpuUsage.toFixed(1)}% exceeds limit ${this.state.limits.maxCpuUsage}%`);
    }

    if (this.state.memoryUsage > this.state.limits.maxMemoryUsage) {
      violations.push(
        `Memory usage ${this.state.memoryUsage.toFixed(1)}% exceeds limit ${this.state.limits.maxMemoryUsage}%`
      );
    }

    if (this.state.currentConnections >= this.state.limits.maxConnections) {
      violations.push(
        `Connections ${this.state.currentConnections} at/above limit ${this.state.limits.maxConnections}`
      );
    }

    if (violations.length > 0) {
      this.emit('limitViolation', violations);
    }
  }

  canAcceptConnection(): boolean {
    if (this.state.status === 'critical') {
      return false;
    }

    if (this.state.currentConnections >= this.state.limits.maxConnections) {
      return false;
    }

    // Check if resources are available
    if (this.state.cpuUsage > this.state.limits.maxCpuUsage * 0.9) {
      return false;
    }

    if (this.state.memoryUsage > this.state.limits.maxMemoryUsage * 0.9) {
      return false;
    }

    return true;
  }

  getState(): ResourceState {
    return { ...this.state };
  }

  getStatus(): ResourceStatus {
    return this.state.status;
  }

  updateLimits(limits: Partial<ResourceLimits>): void {
    const previousLimits = { ...this.state.limits };
    this.state.limits = { ...this.state.limits, ...limits };

    logger.info('Resource limits updated', {
      previous: previousLimits,
      current: this.state.limits,
    });

    this.emit('limitsUpdated', this.state.limits);
  }

  async applyGracefulDegradation(): Promise<void> {
    if (this.state.status === 'normal') {
      return;
    }

    logger.warn('Applying graceful degradation', { status: this.state.status });

    // Reduce quality of service
    // This could involve:
    // - Reducing connection limits
    // - Throttling bandwidth
    // - Reducing processing priority

    this.emit('gracefulDegradation', this.state.status);
  }

  getResourceUtilization(): {
    cpu: number;
    memory: number;
    connections: number;
  } {
    return {
      cpu: this.state.cpuUsage,
      memory: this.state.memoryUsage,
      connections: this.state.currentConnections,
    };
  }

  getResourceAvailability(): {
    cpu: number; // Percentage available
    memory: number; // Percentage available
    connections: number; // Number of available connections
  } {
    return {
      cpu: Math.max(0, 100 - this.state.cpuUsage),
      memory: Math.max(0, 100 - this.state.memoryUsage),
      connections: Math.max(0, this.state.limits.maxConnections - this.state.currentConnections),
    };
  }
}

