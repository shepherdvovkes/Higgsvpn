import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { RoutingEngine } from '../engines/RoutingEngine';
import { WireGuardManager } from '../managers/WireGuardManager';
import { NetworkRouteManager } from './NetworkRouteManager';

export interface HealthStatus {
  routing: boolean;
  nat: boolean;
  wireguard: boolean;
  networkRoute: boolean;
  overall: boolean;
}

export class HealthCheckManager extends EventEmitter {
  private routingEngine: RoutingEngine;
  private wireGuardManager: WireGuardManager;
  private networkRouteManager: NetworkRouteManager;
  private checkInterval: NodeJS.Timeout | null = null;
  private readonly CHECK_INTERVAL = 30000; // 30 секунд
  private consecutiveFailures = 0;
  private readonly MAX_FAILURES = 3;

  constructor(
    routingEngine: RoutingEngine,
    wireGuardManager: WireGuardManager,
    networkRouteManager: NetworkRouteManager
  ) {
    super();
    this.routingEngine = routingEngine;
    this.wireGuardManager = wireGuardManager;
    this.networkRouteManager = networkRouteManager;
  }

  start(): void {
    if (this.checkInterval) {
      return;
    }

    logger.info('Starting health checks');
    this.checkInterval = setInterval(() => {
      this.performHealthCheck();
    }, this.CHECK_INTERVAL);

    // Выполнить первую проверку сразу
    this.performHealthCheck();
  }

  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      logger.info('Health checks stopped');
    }
  }

  private async performHealthCheck(): Promise<void> {
    try {
      const status = await this.checkHealth();
      
      if (status.overall) {
        this.consecutiveFailures = 0;
        this.emit('healthy', status);
      } else {
        this.consecutiveFailures++;
        logger.warn('Health check failed', {
          status,
          consecutiveFailures: this.consecutiveFailures,
        });

        if (this.consecutiveFailures >= this.MAX_FAILURES) {
          await this.attemptRecovery(status);
        }

        this.emit('unhealthy', status);
      }
    } catch (error) {
      logger.error('Health check error', { error });
      this.emit('error', error);
    }
  }

  private async checkHealth(): Promise<HealthStatus> {
    const status: HealthStatus = {
      routing: false,
      nat: false,
      wireguard: false,
      networkRoute: false,
      overall: false,
    };

    // Проверить WireGuard
    try {
      const wgStatus = await this.wireGuardManager.getInterfaceStatus();
      status.wireguard = wgStatus?.status === 'up';
    } catch {
      status.wireguard = false;
    }

    // Проверить NAT
    status.nat = this.routingEngine.isNatEnabled();

    // Проверить маршрутизацию
    try {
      status.networkRoute = await this.networkRouteManager.verifyRouting();
    } catch {
      status.networkRoute = false;
    }

    // Общий статус
    status.overall = status.wireguard && status.nat && status.networkRoute;

    return status;
  }

  private async attemptRecovery(status: HealthStatus): Promise<void> {
    logger.warn('Attempting automatic recovery', { status });

    try {
      // Восстановить WireGuard если не работает
      if (!status.wireguard) {
        logger.info('Recovering WireGuard interface');
        // Пересоздать интерфейс
        await this.wireGuardManager.stopInterface();
        await this.wireGuardManager.createInterface();
      }

      // Восстановить NAT если не работает
      if (!status.nat) {
        logger.info('Recovering NAT');
        await this.routingEngine.disableNat();
        await this.routingEngine.enableNat();
      }

      // Восстановить маршрутизацию
      if (!status.networkRoute) {
        logger.info('Recovering network routing');
        await this.networkRouteManager.initialize();
      }

      this.consecutiveFailures = 0;
      logger.info('Recovery completed');
      this.emit('recovered');
    } catch (error) {
      logger.error('Recovery failed', { error });
      this.emit('recoveryFailed', error);
    }
  }

  async getHealthStatus(): Promise<HealthStatus> {
    return this.checkHealth();
  }
}

