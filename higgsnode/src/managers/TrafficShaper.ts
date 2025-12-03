import { execSync } from 'child_process';
import { logger } from '../utils/logger';
import { isLinux } from '../utils/platform';

export interface TrafficLimit {
  interface: string;
  rate: string; // e.g., "100mbit"
  burst?: string;
  latency?: string;
}

export class TrafficShaper {
  private limits: Map<string, TrafficLimit> = new Map();

  /**
   * Устанавливает ограничение пропускной способности для интерфейса
   */
  async setRateLimit(limit: TrafficLimit): Promise<void> {
    if (!isLinux()) {
      logger.warn('Traffic shaping only supported on Linux');
      return;
    }

    try {
      const interfaceName = limit.interface;
      
      // Удалить существующее правило, если есть
      await this.removeRateLimit(interfaceName);

      // Создать qdisc для traffic shaping
      const qdiscCommand = `tc qdisc add dev ${interfaceName} root tbf rate ${limit.rate} burst ${limit.burst || '32kbit'} latency ${limit.latency || '400ms'}`;
      execSync(qdiscCommand, { stdio: 'pipe' });

      this.limits.set(interfaceName, limit);
      logger.info('Rate limit set', { limit });
    } catch (error) {
      logger.error('Failed to set rate limit', { error, limit });
      throw error;
    }
  }

  /**
   * Удаляет ограничение пропускной способности
   */
  async removeRateLimit(interfaceName: string): Promise<void> {
    try {
      execSync(`tc qdisc del dev ${interfaceName} root 2>/dev/null || true`, { stdio: 'pipe' });
      this.limits.delete(interfaceName);
      logger.info('Rate limit removed', { interface: interfaceName });
    } catch (error) {
      // Игнорировать ошибки, если правило не существует
    }
  }

  /**
   * Очищает все правила
   */
  async cleanup(): Promise<void> {
    for (const interfaceName of this.limits.keys()) {
      await this.removeRateLimit(interfaceName);
    }
    this.limits.clear();
    logger.info('Traffic shaper cleaned up');
  }
}

