import { createClient, RedisClientType } from 'redis';
import { config } from '../config/config';
import { logger } from '../utils/logger';

class RedisDatabase {
  private client: RedisClientType | null = null;

  async connect(): Promise<void> {
    try {
      this.client = createClient({
        socket: {
          host: config.redis.host,
          port: config.redis.port,
        },
        ...(config.redis.password ? { password: config.redis.password } : {}),
      });

      this.client.on('error', (err) => {
        logger.error('Redis client error', { error: err });
      });

      this.client.on('connect', () => {
        logger.info('Redis client connecting...');
      });

      this.client.on('ready', () => {
        logger.info('Redis client ready');
      });

      await this.client.connect();
      logger.info('Redis connected successfully');
    } catch (error) {
      logger.error('Failed to connect to Redis', { error });
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
      logger.info('Redis disconnected');
    }
  }

  getClient(): RedisClientType {
    if (!this.client) {
      throw new Error('Redis client not connected');
    }
    return this.client;
  }

  async get<T = string>(key: string): Promise<T | null> {
    if (!this.client) {
      throw new Error('Redis client not connected');
    }
    const value = await this.client.get(key);
    if (value === null) {
      return null;
    }
    try {
      return JSON.parse(value) as T;
    } catch {
      return value as T;
    }
  }

  async set(key: string, value: any, expirationSeconds?: number): Promise<void> {
    if (!this.client) {
      throw new Error('Redis client not connected');
    }
    const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
    if (expirationSeconds) {
      await this.client.setEx(key, expirationSeconds, stringValue);
    } else {
      await this.client.set(key, stringValue);
    }
  }

  async del(key: string): Promise<void> {
    if (!this.client) {
      throw new Error('Redis client not connected');
    }
    await this.client.del(key);
  }

  async exists(key: string): Promise<boolean> {
    if (!this.client) {
      throw new Error('Redis client not connected');
    }
    const result = await this.client.exists(key);
    return result === 1;
  }

  async keys(pattern: string): Promise<string[]> {
    if (!this.client) {
      throw new Error('Redis client not connected');
    }
    return await this.client.keys(pattern);
  }
}

export const redis = new RedisDatabase();

