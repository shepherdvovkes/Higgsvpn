import dgram from 'dgram';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { config } from '../config/config';

const DNS_SERVERS = ['1.1.1.1', '8.8.8.8', '1.0.0.1']; // Cloudflare, Google, Cloudflare IPv4

export class DNSHandler extends EventEmitter {
  private server: dgram.Socket | null = null;
  private wireguardInterface: string;
  private isRunning = false;

  constructor(wireguardInterface: string) {
    super();
    this.wireguardInterface = wireguardInterface;
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    try {
      logger.info('Starting DNS handler');

      // Создать UDP сервер для перехвата DNS запросов
      this.server = dgram.createSocket('udp4');

      // Handle errors BEFORE binding
      this.server.on('error', (error: any) => {
        if (error.code === 'EACCES') {
          logger.warn('DNS handler requires root/administrator privileges, skipping');
          this.server = null;
          this.isRunning = false;
        } else if (error.code === 'EADDRINUSE') {
          logger.warn('DNS port 53 is already in use, skipping DNS handler');
          this.server = null;
          this.isRunning = false;
        } else {
          logger.warn('DNS server error (non-critical)', { error: error.code || error.message });
          this.server = null;
          this.isRunning = false;
        }
        // Не выбрасываем ошибку и не эмитим error event, так как DNS не критичен
      });

      this.server.on('message', async (msg, rinfo) => {
        await this.handleDNSQuery(msg, rinfo);
      });

      // Привязать к порту 53 (требует root)
      try {
        this.server.bind(53, () => {
          if (this.server) {
            this.isRunning = true;
            logger.info('DNS handler started on port 53');
            this.emit('started');
          }
        });
      } catch (bindError: any) {
        // Синхронная ошибка при bind (редко, но возможно)
        if (bindError.code === 'EACCES' || bindError.code === 'EADDRINUSE') {
          logger.warn('DNS handler cannot start (requires privileges or port in use), skipping');
          this.server = null;
        } else {
          logger.warn('DNS handler bind failed (non-critical)', { error: bindError.code || bindError.message });
          this.server = null;
        }
      }
    } catch (error: any) {
      // Общая обработка ошибок
      if (error.code === 'EACCES' || error.code === 'EADDRINUSE') {
        logger.warn('DNS handler cannot start (requires privileges or port in use), skipping');
      } else {
        logger.warn('Failed to start DNS handler (non-critical)', { error: error.code || error.message });
      }
      this.server = null;
      // Не выбрасываем ошибку, так как DNS может быть настроен через WireGuard конфигурацию
    }
  }

  private async handleDNSQuery(query: Buffer, rinfo: dgram.RemoteInfo): Promise<void> {
    try {
      // Простой DNS forwarder - переслать запрос на безопасный DNS сервер
      const dnsServer = DNS_SERVERS[0]; // Использовать первый доступный

      // Создать UDP клиент для пересылки запроса
      const client = dgram.createSocket('udp4');

      client.on('message', (response) => {
        // Переслать ответ обратно клиенту
        if (this.server) {
          this.server.send(response, rinfo.port, rinfo.address);
        }
        client.close();
      });

      client.on('error', (error) => {
        logger.error('DNS forward error', { error });
        client.close();
      });

      // Отправить запрос на DNS сервер
      client.send(query, 53, dnsServer);

      // Таймаут
      setTimeout(() => {
        client.close();
      }, 5000);
    } catch (error) {
      logger.error('Failed to handle DNS query', { error });
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      if (this.server) {
        this.server.close();
        this.server = null;
      }
      this.isRunning = false;
      logger.info('DNS handler stopped');
      this.emit('stopped');
    } catch (error) {
      logger.error('Failed to stop DNS handler', { error });
    }
  }
}

