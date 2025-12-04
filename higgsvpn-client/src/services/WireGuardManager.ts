import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';
import { config } from '../config/config';
import { WireGuardError } from '../utils/errors';

export interface WireGuardConfig {
  privateKey: string;
  publicKey: string;
  serverPublicKey: string;
  serverEndpoint: string;
  allowedIPs: string;
  address: string;
}

export class WireGuardManager {
  private interfaceName: string;
  private configPath: string;
  private keyPair: { privateKey: string; publicKey: string } | null = null;

  constructor() {
    this.interfaceName = config.wireguard.interfaceName;
    
    // Определить путь к конфигурации WireGuard
    // На Linux: /etc/wireguard, на macOS: /usr/local/etc/wireguard или /opt/homebrew/etc/wireguard
    const configDir = this.getWireGuardConfigDir();
    this.configPath = path.join(configDir, `${this.interfaceName}.conf`);
  }

  private getWireGuardConfigDir(): string {
    // В Docker контейнере используем /tmp для конфигурации
    if (process.env.WIREGUARD_CONFIG_DIR) {
      return process.env.WIREGUARD_CONFIG_DIR;
    }
    // Проверить, запущены ли мы в Docker
    if (fs.existsSync('/.dockerenv') || process.env.DOCKER_CONTAINER === 'true') {
      return '/tmp/wireguard';
    }
    // Проверить, где установлен wg-quick
    try {
      const wgPath = execSync('which wg-quick', { encoding: 'utf-8' }).trim();
      if (wgPath.includes('/opt/homebrew')) {
        return '/opt/homebrew/etc/wireguard';
      } else if (wgPath.includes('/usr/local')) {
        return '/usr/local/etc/wireguard';
      }
    } catch {
      // Fallback
    }
    return '/etc/wireguard';
  }

  /**
   * Генерирует пару ключей WireGuard
   */
  async generateKeyPair(): Promise<{ privateKey: string; publicKey: string }> {
    try {
      // Генерировать приватный ключ
      const privateKey = execSync('wg genkey', { encoding: 'utf-8' }).trim();
      
      // Получить публичный ключ из приватного
      const publicKey = execSync('wg pubkey', { 
        input: privateKey,
        encoding: 'utf-8' 
      }).trim();

      this.keyPair = { privateKey, publicKey };
      logger.info('WireGuard key pair generated');
      
      return this.keyPair;
    } catch (error) {
      logger.error('Failed to generate WireGuard keys', { error });
      throw new WireGuardError('Failed to generate WireGuard keys');
    }
  }

  /**
   * Загружает или генерирует ключи
   */
  async loadOrGenerateKeyPair(): Promise<{ privateKey: string; publicKey: string }> {
    if (this.keyPair) {
      return this.keyPair;
    }

    // Убедиться, что keyPair не null после загрузки/генерации
    const keys = await this.ensureKeyPair();
    return keys;
  }

  /**
   * Убеждается, что ключи загружены или сгенерированы
   */
  private async ensureKeyPair(): Promise<{ privateKey: string; publicKey: string }> {
    // Попытаться загрузить из файла
    const keyFile = path.join(process.cwd(), '.wireguard-keys.json');
    if (fs.existsSync(keyFile)) {
      try {
        const keys = JSON.parse(fs.readFileSync(keyFile, 'utf-8'));
        this.keyPair = keys;
        logger.info('WireGuard keys loaded from file');
        if (this.keyPair) {
          return this.keyPair;
        }
      } catch (error) {
        logger.warn('Failed to load WireGuard keys from file', { error });
      }
    }

    // Сгенерировать новые ключи
    const keys = await this.generateKeyPair();
    
    // Сохранить ключи
    try {
      fs.writeFileSync(keyFile, JSON.stringify(keys, null, 2), { mode: 0o600 });
    } catch (error) {
      logger.warn('Failed to save WireGuard keys', { error });
    }

    return keys;
  }

  /**
   * Создает WireGuard интерфейс с конфигурацией
   */
  async createInterface(wireguardConfig: WireGuardConfig): Promise<void> {
    try {
      // Убедиться, что ключи загружены
      if (!this.keyPair) {
        await this.loadOrGenerateKeyPair();
      }

      // Создать конфигурацию WireGuard
      const wgConfig = this.generateWireGuardConfig(wireguardConfig);
      
      // Убедиться, что директория существует
      const configDir = path.dirname(this.configPath);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }

      // Записать конфигурацию
      fs.writeFileSync(this.configPath, wgConfig, { mode: 0o600 });
      logger.info('WireGuard config written', { path: this.configPath });

      // Поднять интерфейс
      // Использовать полный путь к конфигурации, если она не в /etc/wireguard/
      const configFile = this.configPath;
      // Проверить, что configDir правильно определен
      logger.info('WireGuard setup info', { configDir, configPath: this.configPath, interfaceName: this.interfaceName });
      const wgQuickCommand = configDir === '/etc/wireguard' 
        ? `wg-quick up ${this.interfaceName}`
        : `wg-quick up ${configFile}`;
      
      logger.info('Executing WireGuard command', { command: wgQuickCommand, configDir, configPath: this.configPath });
      
      try {
        // Попробовать использовать wg-quick, но игнорировать ошибки sysctl
        const result = execSync(wgQuickCommand, {
          stdio: 'pipe',
          cwd: configDir,
        });
        logger.info('WireGuard interface created and started', { interface: this.interfaceName });
      } catch (error: any) {
        // Проверить, не является ли ошибка только из-за sysctl (read-only файловая система в Docker)
        const errorOutput = error.stderr?.toString() || error.message || '';
        if (errorOutput.includes('sysctl') && errorOutput.includes('Read-only')) {
          // Интерфейс может быть создан, но sysctl не удалось установить
          // Проверить, существует ли интерфейс
          try {
            execSync(`wg show ${this.interfaceName}`, { stdio: 'pipe' });
            logger.warn('WireGuard interface created but sysctl failed (read-only filesystem)', { 
              interface: this.interfaceName,
              note: 'Interface should still work'
            });
            return; // Интерфейс создан, продолжаем
          } catch (checkError) {
            // Интерфейс не создан, пробрасываем ошибку
            logger.error('WireGuard interface not created after sysctl error', { error: checkError });
          }
        }
        
        // Проверить, не существует ли уже интерфейс
        if (error.message && error.message.includes('already exists')) {
          logger.info('WireGuard interface already exists');
          // Попытаться перезапустить
          try {
            const downCommand = configDir === '/etc/wireguard'
              ? `wg-quick down ${this.interfaceName}`
              : `wg-quick down ${configFile}`;
            execSync(downCommand, { stdio: 'pipe', cwd: configDir });
            execSync(wgQuickCommand, { stdio: 'pipe', cwd: configDir });
            logger.info('WireGuard interface restarted');
          } catch (restartError) {
            logger.warn('Failed to restart WireGuard interface', { error: restartError });
          }
        } else {
          throw error;
        }
      }
    } catch (error) {
      logger.error('Failed to create WireGuard interface', { error });
      throw new WireGuardError(`Failed to create interface: ${error}`);
    }
  }

  /**
   * Генерирует конфигурацию WireGuard
   */
  private generateWireGuardConfig(wgConfig: WireGuardConfig): string {
    return `[Interface]
PrivateKey = ${wgConfig.privateKey}
Address = ${wgConfig.address}
ListenPort = ${config.wireguard.port}

[Peer]
PublicKey = ${wgConfig.serverPublicKey}
Endpoint = ${wgConfig.serverEndpoint}
AllowedIPs = ${wgConfig.allowedIPs}
PersistentKeepalive = 25
`;
  }

  /**
   * Удаляет WireGuard интерфейс
   */
  async removeInterface(): Promise<void> {
    try {
      const configDir = path.dirname(this.configPath);
      execSync(`wg-quick down ${this.interfaceName}`, {
        stdio: 'pipe',
        cwd: configDir,
      });
      logger.info('WireGuard interface removed', { interface: this.interfaceName });
    } catch (error: any) {
      // Интерфейс может не существовать
      if (error.message && !error.message.includes('does not exist')) {
        logger.warn('Failed to remove WireGuard interface', { error });
      }
    }
  }

  /**
   * Проверяет статус WireGuard интерфейса
   */
  async getInterfaceStatus(): Promise<{ status: string; publicKey?: string } | null> {
    try {
      const output = execSync(`wg show ${this.interfaceName}`, { encoding: 'utf-8' });
      const publicKey = this.keyPair?.publicKey;
      return { status: 'up', publicKey };
    } catch (error) {
      return null;
    }
  }

  getPublicKey(): string | null {
    return this.keyPair?.publicKey || null;
  }

  getPrivateKey(): string | null {
    return this.keyPair?.privateKey || null;
  }
}

