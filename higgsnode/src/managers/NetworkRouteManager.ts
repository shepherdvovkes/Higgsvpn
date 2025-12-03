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

      // Убедиться, что маршрут для WireGuard сети существует
      await this.ensureWireGuardRoute();
    } catch (error) {
      logger.error('Failed to initialize NetworkRouteManager', { error });
      throw error;
    }
  }

  private async ensureWireGuardRoute(): Promise<void> {
    try {
      if (isLinux()) {
        // Проверить, существует ли маршрут
        try {
          execSync(`ip route show ${this.wireguardSubnet}`, { stdio: 'pipe' });
          logger.debug('WireGuard route already exists');
        } catch {
          // Маршрут не существует, добавить
          execSync(`ip route add ${this.wireguardSubnet} dev ${this.wireguardInterface}`, {
            stdio: 'pipe',
          });
          logger.info('WireGuard route added', { subnet: this.wireguardSubnet });
        }
      } else if (isWindows()) {
        // Windows routing
        try {
          execSync(`route print ${this.wireguardSubnet}`, { stdio: 'pipe' });
          logger.debug('WireGuard route already exists');
        } catch {
          const [ip, mask] = this.wireguardSubnet.split('/');
          execSync(`route add ${ip} mask ${this.cidrToSubnetMask(mask)} ${this.wireguardInterface}`, {
            stdio: 'pipe',
          });
          logger.info('WireGuard route added', { subnet: this.wireguardSubnet });
        }
      } else if (isMacOS()) {
        // macOS routing
        try {
          // Parse subnet (e.g., "10.0.0.0/24")
          const [ip, mask] = this.wireguardSubnet.split('/');
          const subnetMask = this.cidrToSubnetMask(mask);
          const subnet = this.calculateSubnet(ip, mask);
          
          // Check if route exists
          try {
            execSync(`route -n get -net ${subnet} ${subnetMask}`, { stdio: 'pipe' });
            logger.debug('WireGuard route already exists');
          } catch {
            // Route doesn't exist, add it
            execSync(`route add -net ${subnet} -netmask ${subnetMask} -interface ${this.wireguardInterface}`, {
              stdio: 'pipe',
            });
            logger.info('WireGuard route added', { subnet: this.wireguardSubnet });
          }
        } catch (error: any) {
          // Route might already exist
          if (error.message && (
            error.message.includes('already in table') ||
            error.message.includes('File exists')
          )) {
            logger.debug('WireGuard route already exists');
          } else {
            logger.error('Failed to add macOS route', { error });
          }
        }
      }
    } catch (error) {
      logger.error('Failed to ensure WireGuard route', { error });
    }
  }

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
   * Проверяет, что пакеты из WireGuard сети будут маршрутизироваться через физический интерфейс
   */
  async verifyRouting(): Promise<boolean> {
    if (!this.physicalInterface) {
      return false;
    }

    try {
      if (isLinux()) {
        // Проверить default route
        const routeOutput = execSync('ip route show default', { encoding: 'utf-8' });
        const hasDefaultRoute = routeOutput.includes(this.physicalInterface.gateway);
        
        // Проверить IP forwarding
        const forwardingOutput = execSync('sysctl net.ipv4.ip_forward', { encoding: 'utf-8' });
        const forwardingEnabled = forwardingOutput.includes('= 1');

        return hasDefaultRoute && forwardingEnabled;
      } else if (isWindows()) {
        // Windows routing verification
        const routeOutput = execSync('route print 0.0.0.0', { encoding: 'utf-8' });
        return routeOutput.includes(this.physicalInterface.gateway);
      } else if (isMacOS()) {
        // macOS routing verification
        const routeOutput = execSync('route -n get default', { encoding: 'utf-8' });
        return routeOutput.includes(this.physicalInterface.gateway);
      }
      return false;
    } catch (error) {
      logger.error('Failed to verify routing', { error });
      return false;
    }
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

