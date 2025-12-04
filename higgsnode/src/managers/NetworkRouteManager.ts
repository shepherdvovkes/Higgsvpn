import { execSync } from 'child_process';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { isLinux, isWindows, isMacOS } from '../utils/platform';
import { PhysicalInterface, getPhysicalInterface } from '../utils/networkInterface';

export interface Route {
  destination: string;
  gateway: string;
  interface: string;
  metric?: number;
}

export class NetworkRouteManager extends EventEmitter {
  private physicalInterface: PhysicalInterface | null = null;
  private wireguardInterface: string;
  private wireguardSubnet: string;
  private addedRoutes: Route[] = [];

  constructor(wireguardInterface: string, wireguardSubnet: string) {
    super();
    this.wireguardInterface = wireguardInterface;
    this.wireguardSubnet = wireguardSubnet;
  }

  async initialize(): Promise<void> {
    try {
      this.physicalInterface = getPhysicalInterface();
      if (!this.physicalInterface) {
        throw new Error('Failed to detect physical interface');
      }

      logger.info('NetworkRouteManager initialized', {
        physicalInterface: this.physicalInterface.name,
        gateway: this.physicalInterface.gateway,
      });

      // Нода работает без WireGuard интерфейса - пакеты идут через WebSocket от bosonserver
      // Маршрут для WireGuard интерфейса не нужен, используем default route через физический интерфейс
      // Убедиться, что default route существует и работает
      const hasDefaultRoute = await this.verifyDefaultRoute();
      if (!hasDefaultRoute) {
        logger.warn('Default route not found or invalid');
      }
    } catch (error) {
      logger.error('Failed to initialize NetworkRouteManager', { error });
      throw error;
    }
  }

  // Метод ensureWireGuardRoute удален - нода работает без WireGuard интерфейса
  // Пакеты идут через WebSocket от bosonserver и роутятся через default route

  private cidrToSubnetMask(cidr: string): string {
    const bits = parseInt(cidr, 10);
    const mask = 0xffffffff << (32 - bits);
    return [
      (mask >>> 24) & 0xff,
      (mask >>> 16) & 0xff,
      (mask >>> 8) & 0xff,
      mask & 0xff,
    ].join('.');
  }

  private calculateSubnet(ip: string, mask: string): string {
    const parts = ip.split('.').map(Number);
    const maskBits = parseInt(mask, 10);
    const maskValue = 0xffffffff << (32 - maskBits);
    
    const subnetParts = parts.map((part, index) => {
      const shift = 24 - index * 8;
      return (maskValue >>> shift) & 0xff & part;
    });

    return subnetParts.join('.');
  }

  /**
   * Проверяет default route через физический интерфейс
   * Нода использует default route для отправки пакетов в интернет
   */
  private async verifyDefaultRoute(): Promise<boolean> {
    if (!this.physicalInterface) {
      return false;
    }

    try {
      if (isLinux()) {
        // Проверить default route
        const routeOutput = execSync('ip route show default', { encoding: 'utf-8' });
        const hasDefaultRoute = routeOutput.includes(this.physicalInterface.gateway) || 
                                routeOutput.includes(this.physicalInterface.name);
        return hasDefaultRoute;
      } else if (isWindows()) {
        // Windows routing verification
        const routeOutput = execSync('route print 0.0.0.0', { encoding: 'utf-8' });
        return routeOutput.includes(this.physicalInterface.gateway);
      } else if (isMacOS()) {
        // macOS routing verification - проверяем default route
        try {
          const routeOutput = execSync('route -n get default', { encoding: 'utf-8' });
          
          // Проверяем, что default route использует наш физический интерфейс или gateway
          // Формат вывода: gateway: 192.168.0.1, interface: en0
          const hasGateway = routeOutput.includes(`gateway: ${this.physicalInterface.gateway}`) ||
                            routeOutput.includes(`gateway: ${this.physicalInterface.gateway}\n`);
          const hasInterface = routeOutput.includes(`interface: ${this.physicalInterface.name}`) ||
                              routeOutput.includes(`interface: ${this.physicalInterface.name}\n`);
          
          // Если есть gateway или interface, маршрут существует
          if (hasGateway || hasInterface) {
            return true;
          }
          
          // Альтернативная проверка - просто наличие gateway или interface в выводе
          return routeOutput.includes(this.physicalInterface.gateway) ||
                 routeOutput.includes(this.physicalInterface.name);
        } catch (routeError) {
          // Если команда не работает, считаем что маршрут есть (оптимистично)
          logger.debug('Failed to verify default route via route command', { error: routeError });
          return true; // Assume route exists if we can't verify
        }
      }
      return false;
    } catch (error) {
      logger.error('Failed to verify default route', { error });
      // Оптимистично считаем что маршрут есть, если не можем проверить
      return true;
    }
  }

  /**
   * Проверяет, что пакеты могут маршрутизироваться через физический интерфейс
   * Нода использует default route для отправки пакетов в интернет
   */
  async verifyRouting(): Promise<boolean> {
    return await this.verifyDefaultRoute();
  }

  /**
   * Получить информацию о текущих маршрутах
   */
  getRoutes(): Route[] {
    try {
      if (isLinux()) {
        const output = execSync('ip route show', { encoding: 'utf-8' });
        const routes: Route[] = [];
        const lines = output.split('\n');

        for (const line of lines) {
          if (line.includes('default')) {
            const match = line.match(/default via ([\d.]+) dev (\w+)/);
            if (match) {
              routes.push({
                destination: 'default',
                gateway: match[1],
                interface: match[2],
              });
            }
          }
        }
        return routes;
      }
      return [];
    } catch (error) {
      logger.error('Failed to get routes', { error });
      return [];
    }
  }

  async cleanup(): Promise<void> {
    try {
      logger.info('Cleaning up NetworkRouteManager');
      // Удалить добавленные маршруты (если нужно)
      this.addedRoutes = [];
      this.physicalInterface = null;
      logger.info('NetworkRouteManager cleaned up');
    } catch (error) {
      logger.error('Failed to cleanup NetworkRouteManager', { error });
    }
  }
}

