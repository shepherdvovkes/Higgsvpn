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
        
        // Настроить маршрутизацию после успешного создания через wg-quick
        try {
          await this.setupRouting(wireguardConfig);
          logger.debug('Routing configured after wg-quick');
        } catch (routingError: any) {
          logger.warn('Failed to setup routing after wg-quick', { 
            error: routingError.message || routingError
          });
        }
      } catch (error: any) {
        // Собрать все возможные источники ошибок
        const stderrBuffer = error.stderr;
        const stdoutBuffer = error.stdout;
        
        // Извлечь строку из stderr (может быть Buffer или объект с методом toString)
        let errorOutput = '';
        if (stderrBuffer) {
          if (typeof stderrBuffer === 'string') {
            errorOutput = stderrBuffer;
          } else if (stderrBuffer.toString) {
            errorOutput = stderrBuffer.toString();
          } else if (stderrBuffer.data) {
            // Если это Buffer с data массивом
            errorOutput = Buffer.from(stderrBuffer.data).toString();
          }
        }
        
        if (!errorOutput && error.message) {
          errorOutput = error.message;
        }
        
        // Аналогично для stdout
        let stdoutOutput = '';
        if (stdoutBuffer) {
          if (typeof stdoutBuffer === 'string') {
            stdoutOutput = stdoutBuffer;
          } else if (stdoutBuffer.toString) {
            stdoutOutput = stdoutBuffer.toString();
          } else if (stdoutBuffer.data) {
            stdoutOutput = Buffer.from(stdoutBuffer.data).toString();
          }
        }
        
        const fullError = errorOutput + ' ' + stdoutOutput;
        
        logger.warn('WireGuard wg-quick error details', { 
          errorOutput: errorOutput.substring(0, 200), 
          stdoutOutput: stdoutOutput.substring(0, 200),
          fullError: fullError.substring(0, 300),
          status: error.status,
          code: error.code,
          hasStderr: !!stderrBuffer,
          hasStdout: !!stdoutBuffer
        });
        
        // Проверить на ошибку "No such device" - модуль WireGuard не загружен или проблема с доступом
        // Проверяем во всех возможных местах
        if (fullError.includes('No such device') || 
            fullError.includes('Operation not permitted') ||
            errorOutput.includes('No such device') ||
            errorOutput.includes('Operation not permitted')) {
          logger.warn('WireGuard device access issue detected, trying manual setup', { 
            error: errorOutput.substring(0, 200),
            fullError: fullError.substring(0, 300)
          });
          try {
            await this.createInterfaceManually(wireguardConfig);
            return;
          } catch (manualError: any) {
            logger.error('Manual WireGuard setup failed', { 
              error: manualError.message || manualError,
              stack: manualError.stack
            });
            // Продолжаем без WireGuard
            throw new WireGuardError('WireGuard interface creation failed, continuing with WebSocket only');
          }
        }
        
        // Проверить, не является ли ошибка только из-за sysctl (read-only файловая система в Docker)
        if (fullError.includes('sysctl') && fullError.includes('Read-only')) {
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
            // Интерфейс не создан, попробуем создать вручную
            logger.warn('WireGuard interface not found after wg-quick, trying manual setup', { 
              checkError: checkError instanceof Error ? checkError.message : checkError,
              originalError: errorOutput.substring(0, 200)
            });
            try {
              await this.createInterfaceManually(wireguardConfig);
              return;
            } catch (manualError: any) {
              logger.error('Manual WireGuard setup also failed', { 
                error: manualError.message || manualError
              });
              // Продолжаем без WireGuard, используем только WebSocket
              throw new WireGuardError('WireGuard interface creation failed, continuing with WebSocket only');
            }
          }
        }
        
        // Проверить, не существует ли уже интерфейс
        if (fullError.includes('already exists') || fullError.includes('File exists')) {
          logger.info('WireGuard interface already exists, checking status');
          try {
            execSync(`wg show ${this.interfaceName}`, { stdio: 'pipe' });
            logger.info('WireGuard interface is active');
            
            // Настроить маршрутизацию даже если интерфейс уже существует
            try {
              await this.setupRouting(wireguardConfig);
              logger.debug('Routing configured for existing interface');
            } catch (routingError: any) {
              logger.warn('Failed to setup routing for existing interface', { 
                error: routingError.message || routingError
              });
            }
            
            return;
          } catch (checkError) {
            // Интерфейс существует, но не активен, попробуем перезапустить
            logger.info('WireGuard interface exists but not active, restarting');
            try {
              const downCommand = configDir === '/etc/wireguard'
                ? `wg-quick down ${this.interfaceName}`
                : `wg-quick down ${configFile}`;
              execSync(downCommand, { stdio: 'pipe', cwd: configDir });
              execSync(wgQuickCommand, { stdio: 'pipe', cwd: configDir });
              logger.info('WireGuard interface restarted');
            } catch (restartError) {
              logger.warn('Failed to restart WireGuard interface, trying manual setup', { 
                error: restartError instanceof Error ? restartError.message : restartError
              });
              try {
                await this.createInterfaceManually(wireguardConfig);
                return;
              } catch (manualError: any) {
                logger.error('Manual setup after restart failed', { 
                  error: manualError.message || manualError
                });
                throw new WireGuardError('WireGuard interface creation failed, continuing with WebSocket only');
              }
            }
          }
        } else {
          // Другая ошибка - попробуем ручное создание как последний шанс
          logger.warn('Unknown WireGuard error, attempting manual setup as fallback', { 
            error: errorOutput.substring(0, 300),
            stdout: stdoutOutput.substring(0, 200)
          });
          try {
            await this.createInterfaceManually(wireguardConfig);
            return;
          } catch (manualError: any) {
            logger.error('All WireGuard setup methods failed', { 
              originalError: errorOutput.substring(0, 200),
              manualError: manualError.message || manualError
            });
            // Продолжаем без WireGuard
            throw new WireGuardError('WireGuard interface creation failed, continuing with WebSocket only');
          }
        }
      }
    } catch (error) {
      logger.error('Failed to create WireGuard interface', { error });
      throw new WireGuardError(`Failed to create interface: ${error}`);
    }
  }

  /**
   * Создает WireGuard интерфейс вручную (fallback метод)
   */
  private async createInterfaceManually(wgConfig: WireGuardConfig): Promise<void> {
    try {
      logger.info('Creating WireGuard interface manually', { interface: this.interfaceName });
      
      // Проверить, существует ли интерфейс
      try {
        const existingOutput = execSync(`wg show ${this.interfaceName}`, { 
          stdio: 'pipe',
          encoding: 'utf-8'
        });
        logger.info('WireGuard interface already exists and is active', { 
          interface: this.interfaceName,
          output: existingOutput.substring(0, 100)
        });
        return;
      } catch (checkError: any) {
        // Интерфейс не существует или не активен, продолжаем создание
        logger.debug('WireGuard interface does not exist, will create', { 
          checkError: checkError.message || checkError
        });
      }
      
      // Удалить интерфейс, если он существует, но не работает
      try {
        execSync(`ip link delete dev ${this.interfaceName}`, { stdio: 'pipe' });
        logger.debug('Removed existing interface before recreation');
      } catch {
        // Интерфейс не существует, это нормально
      }
      
      // Создать интерфейс
      try {
        execSync(`ip link add dev ${this.interfaceName} type wireguard`, { 
          stdio: 'pipe',
          encoding: 'utf-8'
        });
        logger.debug('WireGuard interface created via ip link');
      } catch (linkError: any) {
        const linkErrorMsg = linkError.stderr?.toString() || linkError.message || '';
        if (linkErrorMsg.includes('File exists') || linkErrorMsg.includes('already exists')) {
          logger.debug('Interface already exists, continuing');
        } else {
          throw new WireGuardError(`Failed to create interface: ${linkErrorMsg}`);
        }
      }
      
      // Настроить WireGuard используя wg set команды напрямую
      // wg setconf не поддерживает Address, поэтому используем wg set
      const tempKeyPath = `/tmp/wg-${this.interfaceName}-key-${Date.now()}.tmp`;
      try {
        // Сохранить приватный ключ во временный файл
        fs.writeFileSync(tempKeyPath, wgConfig.privateKey, { mode: 0o600, encoding: 'utf-8' });
        logger.debug('Temporary private key file created', { path: tempKeyPath });
        
        try {
          // Установить приватный ключ
          execSync(`wg set ${this.interfaceName} private-key ${tempKeyPath}`, {
            encoding: 'utf-8',
            stdio: 'pipe',
          });
          logger.debug('WireGuard private key set');
          
          // Добавить peer
          const peerCommands = [
            `wg set ${this.interfaceName} peer ${wgConfig.serverPublicKey}`,
            `wg set ${this.interfaceName} peer ${wgConfig.serverPublicKey} allowed-ips ${wgConfig.allowedIPs}`,
            `wg set ${this.interfaceName} peer ${wgConfig.serverPublicKey} endpoint ${wgConfig.serverEndpoint}`,
            `wg set ${this.interfaceName} peer ${wgConfig.serverPublicKey} persistent-keepalive 25`,
          ];
          
          for (const cmd of peerCommands) {
            execSync(cmd, {
              encoding: 'utf-8',
              stdio: 'pipe',
            });
          }
          logger.debug('WireGuard peer configuration applied');
        } finally {
          // Удалить временный файл с ключом
          try {
            fs.unlinkSync(tempKeyPath);
          } catch {
            // Игнорируем ошибки удаления
          }
        }
      } catch (wgSetError: any) {
        const wgSetErrorMsg = wgSetError.stderr?.toString() || wgSetError.message || '';
        logger.error('Failed to apply WireGuard config via wg set', { 
          error: wgSetErrorMsg,
          interface: this.interfaceName
        });
        // Попытаться удалить временный файл при ошибке
        try {
          fs.unlinkSync(tempKeyPath);
        } catch {
          // Игнорируем
        }
        throw new WireGuardError(`Failed to apply WireGuard config: ${wgSetErrorMsg}`);
      }
      
      // Настроить IP адрес
      try {
        execSync(`ip -4 address add ${wgConfig.address} dev ${this.interfaceName}`, { 
          stdio: 'pipe',
          encoding: 'utf-8'
        });
        logger.debug('IP address configured');
      } catch (ipError: any) {
        const ipErrorMsg = ipError.stderr?.toString() || ipError.message || '';
        if (ipErrorMsg.includes('File exists')) {
          logger.debug('IP address already configured');
        } else {
          logger.warn('Failed to configure IP address', { error: ipErrorMsg });
          // Продолжаем, так как IP может быть уже настроен
        }
      }
      
      // Поднять интерфейс
      try {
        execSync(`ip link set mtu 1420 up dev ${this.interfaceName}`, { 
          stdio: 'pipe',
          encoding: 'utf-8'
        });
        logger.debug('WireGuard interface brought up');
      } catch (upError: any) {
        const upErrorMsg = upError.stderr?.toString() || upError.message || '';
        logger.error('Failed to bring up interface', { error: upErrorMsg });
        throw new WireGuardError(`Failed to bring up interface: ${upErrorMsg}`);
      }
      
      // Настроить маршрутизацию через WireGuard интерфейс
      try {
        await this.setupRouting(wgConfig);
        logger.debug('Routing configured');
      } catch (routingError: any) {
        logger.warn('Failed to setup routing, continuing without it', { 
          error: routingError.message || routingError
        });
        // Не критично, продолжаем
      }
      
      // Проверить, что интерфейс работает
      try {
        const verifyOutput = execSync(`wg show ${this.interfaceName}`, { 
          stdio: 'pipe',
          encoding: 'utf-8'
        });
        logger.info('WireGuard interface created and configured manually', { 
          interface: this.interfaceName,
          configPreview: verifyOutput.substring(0, 150)
        });
      } catch (checkError: any) {
        const checkErrorMsg = checkError.stderr?.toString() || checkError.message || '';
        logger.error('WireGuard interface created but verification failed', { 
          error: checkErrorMsg,
          interface: this.interfaceName
        });
        throw new WireGuardError(`Failed to verify WireGuard interface: ${checkErrorMsg}`);
      }
    } catch (error: any) {
      const errorMsg = error.message || error.stderr?.toString() || error.toString();
      logger.error('Failed to create WireGuard interface manually', { 
        error: errorMsg,
        interface: this.interfaceName,
        stack: error.stack
      });
      
      // Попытаться очистить интерфейс при ошибке
      try {
        execSync(`ip link delete dev ${this.interfaceName}`, { 
          stdio: 'pipe',
          encoding: 'utf-8'
        });
        logger.debug('Cleaned up interface after error');
      } catch (cleanupError) {
        // Игнорируем ошибки очистки
        logger.debug('Cleanup failed (interface may not exist)', { 
          cleanupError: cleanupError instanceof Error ? cleanupError.message : cleanupError
        });
      }
      
      throw new WireGuardError(`Failed to create interface manually: ${errorMsg}`);
    }
  }

  /**
   * Настраивает маршрутизацию через WireGuard интерфейс
   */
  private async setupRouting(wgConfig: WireGuardConfig): Promise<void> {
    try {
      // Извлечь IP сервера из endpoint для исключения из маршрутизации через VPN
      const serverHost = wgConfig.serverEndpoint.split(':')[0];
      
      // Получить текущий default route
      let defaultRoute: string | null = null;
      try {
        const routeOutput = execSync('ip route show default', { 
          encoding: 'utf-8',
          stdio: 'pipe'
        });
        defaultRoute = routeOutput.trim();
        logger.debug('Current default route', { route: defaultRoute });
      } catch {
        logger.warn('No default route found');
      }
      
      // Если allowedIPs = 0.0.0.0/0, настроить default route через WireGuard
      if (wgConfig.allowedIPs === '0.0.0.0/0') {
        // Сохранить оригинальный default route (если есть)
        // Добавить маршрут для сервера через оригинальный интерфейс (чтобы избежать loop)
        if (defaultRoute && serverHost) {
          try {
            // Получить интерфейс из default route
            const defaultInterface = defaultRoute.match(/dev\s+(\S+)/)?.[1];
            if (defaultInterface) {
              // Добавить маршрут к серверу через оригинальный интерфейс
              execSync(`ip route add ${serverHost}/32 via $(ip route | grep default | awk '{print $3}' | head -1) dev ${defaultInterface} 2>/dev/null || ip route add ${serverHost}/32 dev ${defaultInterface}`, {
                stdio: 'pipe',
                encoding: 'utf-8'
              });
              logger.debug('Route to WireGuard server added via original interface', { serverHost });
            }
          } catch (serverRouteError) {
            logger.debug('Failed to add route to server, may already exist', { 
              error: serverRouteError instanceof Error ? serverRouteError.message : serverRouteError
            });
          }
        }
        
        // Настроить default route через WireGuard интерфейс
        // Используем таблицу маршрутизации с более высоким приоритетом
        try {
          // Удалить существующий default route через WireGuard (если есть)
          try {
            execSync(`ip route del default dev ${this.interfaceName}`, { stdio: 'pipe' });
          } catch {
            // Игнорируем, если маршрута нет
          }
          
          // Добавить default route через WireGuard
          execSync(`ip route add default dev ${this.interfaceName}`, {
            stdio: 'pipe',
            encoding: 'utf-8'
          });
          logger.info('Default route configured through WireGuard interface', { 
            interface: this.interfaceName
          });
        } catch (routeError: any) {
          const routeErrorMsg = routeError.stderr?.toString() || routeError.message || '';
          // Если ошибка "File exists", маршрут уже настроен
          if (routeErrorMsg.includes('File exists') || routeErrorMsg.includes('already exists')) {
            logger.debug('Default route already exists');
          } else {
            throw routeError;
          }
        }
      } else {
        // Если allowedIPs не 0.0.0.0/0, добавить маршруты только для указанных подсетей
        const allowedIPs = wgConfig.allowedIPs.split(',').map(ip => ip.trim());
        for (const allowedIP of allowedIPs) {
          try {
            execSync(`ip route add ${allowedIP} dev ${this.interfaceName}`, {
              stdio: 'pipe',
              encoding: 'utf-8'
            });
            logger.debug('Route added for allowed IPs', { allowedIP, interface: this.interfaceName });
          } catch (routeError: any) {
            const routeErrorMsg = routeError.stderr?.toString() || routeError.message || '';
            if (routeErrorMsg.includes('File exists')) {
              logger.debug('Route already exists', { allowedIP });
            } else {
              logger.warn('Failed to add route for allowed IPs', { 
                allowedIP, 
                error: routeErrorMsg
              });
            }
          }
        }
      }
    } catch (error: any) {
      logger.error('Failed to setup routing', { 
        error: error.message || error,
        interface: this.interfaceName
      });
      throw error;
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

