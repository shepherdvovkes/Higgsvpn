import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { isLinux, isWindows, isMacOS } from '../utils/platform';

export interface PortMapping {
  internalPort: number;
  externalPort: number;
  protocol: 'tcp' | 'udp';
  description: string;
  ttl: number; // В секундах
}

export class PortForwardingService extends EventEmitter {
  private upnpClient: any = null;
  private natPmpClient: any = null;
  private activeMappings: Map<number, PortMapping> = new Map();
  private refreshTimers: Map<number, NodeJS.Timeout> = new Map();

  constructor() {
    super();
  }

  /**
   * Инициализирует UPnP/NAT-PMP клиент
   */
  async initialize(): Promise<void> {
    try {
      logger.info('Initializing port forwarding service');

      // Попробовать UPnP (работает на большинстве роутеров)
      if (await this.initializeUPnP()) {
        logger.info('UPnP initialized successfully');
        return;
      }

      // Попробовать NAT-PMP (macOS/iOS роутеры)
      if (isMacOS() && await this.initializeNAT_PMP()) {
        logger.info('NAT-PMP initialized successfully');
        return;
      }

      logger.warn('Neither UPnP nor NAT-PMP available, port forwarding disabled');
      this.emit('unavailable');
    } catch (error) {
      logger.error('Failed to initialize port forwarding', { error });
      throw error;
    }
  }

  /**
   * Инициализирует UPnP клиент
   */
  private async initializeUPnP(): Promise<boolean> {
    try {
      // Использовать библиотеку nat-upnp или node-upnp
      // Для начала используем простую проверку доступности
      // В production нужно установить: npm install nat-upnp
      const natUpnp = await import('nat-upnp' as any).catch(() => null);
      if (!natUpnp) {
        logger.debug('nat-upnp package not installed');
        return false;
      }

      this.upnpClient = natUpnp.createClient();

      // Проверить доступность UPnP роутера
      return new Promise((resolve) => {
        this.upnpClient.getExternalIP((err: any, ip: string) => {
          if (err || !ip) {
            resolve(false);
          } else {
            logger.info('UPnP router found', { externalIP: ip });
            resolve(true);
          }
        });
      });
    } catch (error) {
      logger.debug('UPnP not available', { error });
      return false;
    }
  }

  /**
   * Инициализирует NAT-PMP клиент
   */
  private async initializeNAT_PMP(): Promise<boolean> {
    try {
      // NAT-PMP для macOS/iOS
      // В production нужно установить: npm install nat-pmp
      const natPmp = await import('nat-pmp' as any).catch(() => null);
      if (!natPmp) {
        logger.debug('nat-pmp package not installed');
        return false;
      }

      this.natPmpClient = natPmp.connect();

      return new Promise((resolve) => {
        this.natPmpClient.externalIp((err: any, info: any) => {
          if (err || !info) {
            resolve(false);
          } else {
            logger.info('NAT-PMP router found', { externalIP: info.ip });
            resolve(true);
          }
        });
      });
    } catch (error) {
      logger.debug('NAT-PMP not available', { error });
      return false;
    }
  }

  /**
   * Добавляет проброс порта
   */
  async addPortMapping(mapping: PortMapping): Promise<boolean> {
    try {
      if (this.upnpClient) {
        return await this.addUPnPMapping(mapping);
      } else if (this.natPmpClient) {
        return await this.addNAT_PMPMapping(mapping);
      }
      return false;
    } catch (error) {
      logger.error('Failed to add port mapping', { error, mapping });
      return false;
    }
  }

  private async addUPnPMapping(mapping: PortMapping): Promise<boolean> {
    return new Promise((resolve) => {
      this.upnpClient.portMapping({
        public: mapping.externalPort,
        private: mapping.internalPort,
        ttl: mapping.ttl,
        description: mapping.description,
      }, (err: any) => {
        if (err) {
          logger.error('UPnP port mapping failed', { error: err, mapping });
          resolve(false);
        } else {
          this.activeMappings.set(mapping.internalPort, mapping);
          logger.info('UPnP port mapping added', { mapping });
          this.scheduleRefresh(mapping);
          resolve(true);
        }
      });
    });
  }

  private async addNAT_PMPMapping(mapping: PortMapping): Promise<boolean> {
    return new Promise((resolve) => {
      this.natPmpClient.portMapping({
        public: mapping.externalPort,
        private: mapping.internalPort,
        ttl: mapping.ttl,
      }, (err: any) => {
        if (err) {
          logger.error('NAT-PMP port mapping failed', { error: err, mapping });
          resolve(false);
        } else {
          this.activeMappings.set(mapping.internalPort, mapping);
          logger.info('NAT-PMP port mapping added', { mapping });
          this.scheduleRefresh(mapping);
          resolve(true);
        }
      });
    });
  }

  /**
   * Планирует обновление маппинга перед истечением TTL
   */
  private scheduleRefresh(mapping: PortMapping): void {
    // Очистить существующий таймер
    const existingTimer = this.refreshTimers.get(mapping.internalPort);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Обновить за 30 секунд до истечения TTL
    const refreshTime = Math.max(1000, (mapping.ttl - 30) * 1000);
    
    const timer = setTimeout(async () => {
      if (this.activeMappings.has(mapping.internalPort)) {
        await this.addPortMapping(mapping);
      }
    }, refreshTime);

    this.refreshTimers.set(mapping.internalPort, timer);
  }

  /**
   * Удаляет проброс порта
   */
  async removePortMapping(internalPort: number): Promise<void> {
    const mapping = this.activeMappings.get(internalPort);
    if (!mapping) {
      return;
    }

    // Очистить таймер обновления
    const timer = this.refreshTimers.get(internalPort);
    if (timer) {
      clearTimeout(timer);
      this.refreshTimers.delete(internalPort);
    }

    try {
      if (this.upnpClient) {
        this.upnpClient.portUnmapping({
          public: mapping.externalPort,
          private: mapping.internalPort,
        });
      } else if (this.natPmpClient) {
        this.natPmpClient.portUnmapping({
          public: mapping.externalPort,
          private: mapping.internalPort,
        });
      }

      this.activeMappings.delete(internalPort);
      logger.info('Port mapping removed', { internalPort });
    } catch (error) {
      logger.error('Failed to remove port mapping', { error, internalPort });
    }
  }

  /**
   * Получает внешний IP адрес
   */
  async getExternalIP(): Promise<string | null> {
    try {
      if (this.upnpClient) {
        return new Promise((resolve) => {
          this.upnpClient.getExternalIP((err: any, ip: string) => {
            resolve(err ? null : ip);
          });
        });
      } else if (this.natPmpClient) {
        return new Promise((resolve) => {
          this.natPmpClient.externalIp((err: any, info: any) => {
            resolve(err ? null : info?.ip || null);
          });
        });
      }
      return null;
    } catch (error) {
      logger.error('Failed to get external IP', { error });
      return null;
    }
  }

  async cleanup(): Promise<void> {
    // Удалить все активные маппинги
    for (const internalPort of this.activeMappings.keys()) {
      await this.removePortMapping(internalPort);
    }

    // Очистить все таймеры
    for (const timer of this.refreshTimers.values()) {
      clearTimeout(timer);
    }
    this.refreshTimers.clear();

    logger.info('Port forwarding service cleaned up');
  }
}

