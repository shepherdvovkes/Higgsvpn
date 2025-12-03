import { execSync } from 'child_process';
import { logger } from '../utils/logger';
import { getPhysicalInterface } from '../utils/networkInterface';
import { isWindows } from '../utils/platform';

export class MTUManager {
  private readonly WIREGUARD_OVERHEAD = 80; // WireGuard overhead (encryption + headers)
  private readonly WEBSOCKET_OVERHEAD = 14; // WebSocket frame overhead
  private readonly DEFAULT_MTU = 1420; // Безопасное значение по умолчанию

  /**
   * Определяет оптимальный MTU для WireGuard интерфейса
   */
  async detectOptimalMTU(interfaceName: string): Promise<number> {
    try {
      const physicalInterface = getPhysicalInterface();
      if (!physicalInterface) {
        logger.warn('Cannot detect physical interface, using default MTU');
        return this.DEFAULT_MTU;
      }

      let physicalMTU: number | undefined;

      if (isWindows()) {
        // Windows: использовать netsh для получения MTU
        try {
          const mtuOutput = execSync(
            `netsh interface ipv4 show interfaces`,
            { encoding: 'utf-8', stdio: 'pipe' }
          );
          
          // Найти интерфейс по имени
          const lines = mtuOutput.split('\n');
          for (const line of lines) {
            if (line.includes(physicalInterface.name)) {
              const mtuMatch = line.match(/MTU[:\s]+(\d+)/i);
              if (mtuMatch) {
                physicalMTU = parseInt(mtuMatch[1], 10);
                break;
              }
            }
          }
          
          if (!physicalMTU) {
            // Если не нашли, попробовать через PowerShell
            try {
              const psOutput = execSync(
                `powershell -Command "(Get-NetAdapter -Name '${physicalInterface.name}').MTU"`,
                { encoding: 'utf-8', stdio: 'pipe' }
              ).trim();
              physicalMTU = parseInt(psOutput, 10);
            } catch {
              // Если PowerShell тоже не сработал, используем значение по умолчанию
            }
          }
        } catch {
          // Если не удалось определить, используем значение по умолчанию
          return this.DEFAULT_MTU;
        }
      } else {
        // Linux/macOS: использовать ip команду
        const mtuOutput = execSync(`ip link show ${physicalInterface.name}`, { encoding: 'utf-8' });
        const mtuMatch = mtuOutput.match(/mtu (\d+)/);
        
        if (!mtuMatch) {
          return this.DEFAULT_MTU;
        }
        
        physicalMTU = parseInt(mtuMatch[1], 10);
      }

      if (!physicalMTU || isNaN(physicalMTU)) {
        return this.DEFAULT_MTU;
      }
      
      // Рассчитать оптимальный MTU для WireGuard
      // MTU = Physical MTU - WireGuard overhead - WebSocket overhead (если используется relay)
      const optimalMTU = physicalMTU - this.WIREGUARD_OVERHEAD - this.WEBSOCKET_OVERHEAD;

      // Убедиться, что MTU не меньше минимального значения
      const finalMTU = Math.max(1280, optimalMTU); // Минимум 1280 для IPv6

      logger.info('Optimal MTU detected', {
        physicalMTU,
        optimalMTU: finalMTU,
        interface: interfaceName,
      });

      return finalMTU;
    } catch (error) {
      logger.error('Failed to detect optimal MTU', { error });
      return this.DEFAULT_MTU;
    }
  }

  /**
   * Устанавливает MTU для интерфейса
   */
  async setMTU(interfaceName: string, mtu: number): Promise<void> {
    try {
      if (isWindows()) {
        // Windows: сначала проверить, существует ли интерфейс
        try {
          // Попробовать найти интерфейс через netsh
          const interfaceOutput = execSync(
            `netsh interface show interface name="${interfaceName}"`,
            { stdio: 'pipe' }
          );
          
          // Если интерфейс найден, попробовать установить MTU
          try {
            // Попробовать через netsh
            execSync(
              `netsh interface ipv4 set subinterface "${interfaceName}" mtu=${mtu} store=persistent`,
              { stdio: 'pipe' }
            );
            logger.info('MTU set via netsh', { interface: interfaceName, mtu });
            return;
          } catch {
            // Если netsh не работает, попробовать через PowerShell
            try {
              execSync(
                `powershell -Command "Set-NetIPInterface -InterfaceAlias '${interfaceName}' -NlMtuBytes ${mtu}"`,
                { stdio: 'pipe' }
              );
              logger.info('MTU set via PowerShell', { interface: interfaceName, mtu });
              return;
            } catch {
              // Если и PowerShell не работает, попробовать найти WireGuard интерфейс по другому имени
              const wgInterfaceName = `WireGuard Tunnel: ${interfaceName}`;
              try {
                execSync(
                  `powershell -Command "Set-NetIPInterface -InterfaceAlias '${wgInterfaceName}' -NlMtuBytes ${mtu}"`,
                  { stdio: 'pipe' }
                );
                logger.info('MTU set via PowerShell (WireGuard name)', { interface: wgInterfaceName, mtu });
                return;
              } catch {
                logger.warn('Interface not found or MTU cannot be set', { interface: interfaceName });
              }
            }
          }
        } catch {
          // Интерфейс не найден, это нормально если он еще не создан
          logger.debug('Interface not found, skipping MTU setup', { interface: interfaceName });
          return;
        }
      } else {
        // Linux/macOS: использовать ip команду
        execSync(`ip link set ${interfaceName} mtu ${mtu}`, { stdio: 'pipe' });
        logger.info('MTU set', { interface: interfaceName, mtu });
      }
    } catch (error) {
      logger.warn('Failed to set MTU (non-critical)', { error, interface: interfaceName, mtu });
      // Не бросаем ошибку, так как это не критично
    }
  }

  /**
   * Выполняет Path MTU Discovery
   */
  async pathMTUDiscovery(target: string = '8.8.8.8'): Promise<number> {
    try {
      // Попробовать разные размеры пакетов
      for (let size = 1500; size >= 1280; size -= 20) {
        try {
          if (isWindows()) {
            // Windows: использовать ping с флагом -f (Don't Fragment) и -l (buffer size)
            execSync(`ping -n 1 -f -l ${size - 28} ${target}`, {
              stdio: 'pipe',
              timeout: 2000,
            });
          } else {
            // Linux/macOS: использовать ping с флагом -M do (Don't Fragment) и -s (size)
            execSync(`ping -M do -s ${size - 28} -c 1 ${target}`, {
              stdio: 'pipe',
              timeout: 2000,
            });
          }
          // Если ping успешен, это максимальный размер
          return size;
        } catch {
          // Продолжить с меньшим размером
          continue;
        }
      }
      return 1280; // Минимальный размер
    } catch (error) {
      logger.error('Path MTU discovery failed', { error });
      return this.DEFAULT_MTU;
    }
  }
}

