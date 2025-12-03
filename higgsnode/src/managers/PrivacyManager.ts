import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { config } from '../config/config';

export interface PrivacySettings {
  logTraffic: boolean;
  logDNS: boolean;
  logMetadata: boolean;
  anonymizeIPs: boolean;
  maxLogRetention: number; // В днях
}

export class PrivacyManager extends EventEmitter {
  private settings: PrivacySettings;

  constructor() {
    super();
    this.settings = {
      logTraffic: (config as any).privacy?.logTraffic || false,
      logDNS: (config as any).privacy?.logDNS || false,
      logMetadata: (config as any).privacy?.logMetadata || true,
      anonymizeIPs: (config as any).privacy?.anonymizeIPs || true,
      maxLogRetention: (config as any).privacy?.maxLogRetention || 7,
    };
  }

  /**
   * Анонимизирует IP адрес (оставляет только первые 3 октета)
   */
  anonymizeIP(ip: string): string {
    if (!this.settings.anonymizeIPs) {
      return ip;
    }

    const parts = ip.split('.');
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
    }
    
    // IPv6 анонимизация (оставляем первые 64 бита)
    if (ip.includes(':')) {
      const parts = ip.split(':');
      if (parts.length >= 4) {
        return `${parts[0]}:${parts[1]}:${parts[2]}:${parts[3]}::`;
      }
    }
    
    return ip;
  }

  /**
   * Проверяет, можно ли логировать трафик
   */
  canLogTraffic(): boolean {
    return this.settings.logTraffic;
  }

  /**
   * Проверяет, можно ли логировать DNS запросы
   */
  canLogDNS(): boolean {
    return this.settings.logDNS;
  }

  /**
   * Логирует метаданные соединения (без содержимого)
   */
  logConnectionMetadata(metadata: {
    clientId: string;
    destinationIP: string;
    destinationPort: number;
    protocol: string;
    bytesTransferred: number;
    duration: number;
  }): void {
    if (!this.settings.logMetadata) {
      return;
    }

    const anonymizedMetadata = {
      ...metadata,
      destinationIP: this.anonymizeIP(metadata.destinationIP),
      clientId: this.anonymizeIP(metadata.clientId), // Если clientId это IP
    };

    logger.info('Connection metadata', anonymizedMetadata);
    this.emit('metadataLogged', anonymizedMetadata);
  }

  /**
   * Обновляет настройки приватности
   */
  updateSettings(settings: Partial<PrivacySettings>): void {
    this.settings = { ...this.settings, ...settings };
    logger.info('Privacy settings updated', { settings: this.settings });
    this.emit('settingsUpdated', this.settings);
  }

  getSettings(): PrivacySettings {
    return { ...this.settings };
  }
}

