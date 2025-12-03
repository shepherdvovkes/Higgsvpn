import { execSync } from 'child_process';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { isLinux } from '../utils/platform';

export interface ClientLimit {
  clientId: string;
  rate: string; // e.g., "10mbit"
  burst?: string;
  priority?: number; // 1-10, где 10 - высший приоритет
}

export class ClientRateLimiter extends EventEmitter {
  private limits: Map<string, ClientLimit> = new Map();
  private wireguardInterface: string;

  constructor(wireguardInterface: string) {
    super();
    this.wireguardInterface = wireguardInterface;
  }

  /**
   * Устанавливает ограничение для клиента
   */
  async setClientLimit(limit: ClientLimit): Promise<void> {
    if (!isLinux()) {
      logger.warn('Per-client rate limiting only supported on Linux');
      return;
    }

    try {
      // Использовать tc (traffic control) с HTB (Hierarchical Token Bucket)
      // Создать класс для клиента
      const classId = this.getClientClassId(limit.clientId);
      
      // Создать qdisc если еще не создан
      await this.ensureQdisc();

      // Создать класс для клиента
      execSync(
        `tc class add dev ${this.wireguardInterface} parent 1: classid ${classId} htb rate ${limit.rate} burst ${limit.burst || '32kbit'}`,
        { stdio: 'pipe' }
      );

      // Настроить фильтр по IP клиента (если известен)
      // Это требует знания IP адреса клиента в WireGuard сети

      this.limits.set(limit.clientId, limit);
      logger.info('Client rate limit set', { limit });
    } catch (error) {
      logger.error('Failed to set client rate limit', { error, limit });
      throw error;
    }
  }

  private getClientClassId(clientId: string): string {
    // Генерировать уникальный class ID на основе clientId
    const hash = this.simpleHash(clientId);
    const major = 1;
    const minor = (hash % 65535) + 1;
    return `${major}:${minor}`;
  }

  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash);
  }

  private async ensureQdisc(): Promise<void> {
    try {
      // Проверить, существует ли root qdisc
      execSync(`tc qdisc show dev ${this.wireguardInterface} | grep -q "htb"`, {
        stdio: 'pipe',
      });
    } catch {
      // Создать root qdisc
      execSync(
        `tc qdisc add dev ${this.wireguardInterface} root handle 1: htb default 30`,
        { stdio: 'pipe' }
      );
    }
  }

  async removeClientLimit(clientId: string): Promise<void> {
    const limit = this.limits.get(clientId);
    if (!limit) {
      return;
    }

    try {
      const classId = this.getClientClassId(clientId);
      execSync(`tc class del dev ${this.wireguardInterface} classid ${classId}`, {
        stdio: 'pipe',
      });
      this.limits.delete(clientId);
      logger.info('Client rate limit removed', { clientId });
    } catch (error) {
      logger.error('Failed to remove client rate limit', { error, clientId });
    }
  }

  async cleanup(): Promise<void> {
    for (const clientId of this.limits.keys()) {
      await this.removeClientLimit(clientId);
    }
    this.limits.clear();
    logger.info('Client rate limiter cleaned up');
  }
}

