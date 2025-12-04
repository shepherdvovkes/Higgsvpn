import { execSync } from 'child_process';
import { isLinux, isWindows, isMacOS } from './platform';
import { logger } from './logger';

export interface PhysicalInterface {
  name: string;
  ipv4: string;
  ipv6?: string;
  gateway: string;
  isDefault: boolean;
}

/**
 * Определяет физический сетевой интерфейс (default gateway)
 */
export function getPhysicalInterface(): PhysicalInterface | null {
  try {
    if (isLinux()) {
      return getLinuxPhysicalInterface();
    } else if (isWindows()) {
      return getWindowsPhysicalInterface();
    } else if (isMacOS()) {
      return getMacOSPhysicalInterface();
    }
    return null;
  } catch (error) {
    logger.error('Failed to detect physical interface', { error });
    return null;
  }
}

function getLinuxPhysicalInterface(): PhysicalInterface | null {
  try {
    // Получить default gateway и интерфейс
    const routeOutput = execSync('ip route show default', { encoding: 'utf-8' });
    const match = routeOutput.match(/default via ([\d.]+) dev (\w+)/);
    
    if (!match) {
      return null;
    }

    const gateway = match[1];
    const interfaceName = match[2];

    // Получить IP адрес интерфейса
    const ipOutput = execSync(`ip addr show ${interfaceName}`, { encoding: 'utf-8' });
    const ipMatch = ipOutput.match(/inet ([\d.]+)\/\d+/);
    
    if (!ipMatch) {
      return null;
    }

    return {
      name: interfaceName,
      ipv4: ipMatch[1],
      gateway: gateway,
      isDefault: true,
    };
  } catch (error) {
    logger.error('Failed to get Linux physical interface', { error });
    return null;
  }
}

function getWindowsPhysicalInterface(): PhysicalInterface | null {
  try {
    // Метод 1: Использовать PowerShell для более надежного определения
    const psScript = `
      $route = Get-NetRoute -DestinationPrefix "0.0.0.0/0" | Sort-Object RouteMetric | Select-Object -First 1;
      if ($route) {
        $interface = Get-NetIPAddress -InterfaceIndex $route.InterfaceIndex -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike "169.254.*" } | Select-Object -First 1;
        if ($interface) {
          $adapter = Get-NetAdapter -InterfaceIndex $interface.InterfaceIndex | Select-Object -First 1;
          $gateway = $route.NextHop;
          Write-Output "$($adapter.Name)|$($interface.IPAddress)|$gateway|$($interface.InterfaceIndex)"
        }
      }
    `;

    try {
      const output = execSync(
        `powershell -NoProfile -ExecutionPolicy Bypass -Command "${psScript}"`,
        { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' }
      ).trim();

      if (output && output.includes('|')) {
        const parts = output.split('|');
        if (parts.length >= 4) {
          const interfaceName = parts[0];
          const ipv4 = parts[1];
          const gateway = parts[2];
          const interfaceIndex = parts[3];

          logger.debug('Windows physical interface detected via PowerShell', {
            name: interfaceName,
            ipv4,
            gateway,
            interfaceIndex,
          });

          return {
            name: interfaceName,
            ipv4: ipv4,
            gateway: gateway,
            isDefault: true,
          };
        }
      }
    } catch (psError) {
      logger.debug('PowerShell method failed, trying netsh fallback', { error: psError });
    }

    // Метод 2: Fallback через netsh и route print
    const routeOutput = execSync('route print 0.0.0.0', { encoding: 'utf-8' });
    const lines = routeOutput.split('\n');
    
    // Ищем строку с маршрутом по умолчанию
    // Формат: Network Destination, Netmask, Gateway, Interface, Metric
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Ищем строку, которая начинается с "0.0.0.0" и содержит gateway
      if (line.startsWith('0.0.0.0') && line.includes('0.0.0.0')) {
        const parts = line.split(/\s+/).filter(p => p.length > 0);
        
        // Проверяем формат: 0.0.0.0 0.0.0.0 <gateway> <interface_index> <metric>
        if (parts.length >= 5 && parts[0] === '0.0.0.0' && parts[1] === '0.0.0.0') {
          const gateway = parts[2];
          const interfaceIndex = parts[3];
          
          // Получить имя интерфейса по индексу через netsh
          try {
            const interfaceList = execSync('netsh interface show interface', {
              encoding: 'utf-8',
            });
            
            // Парсим вывод netsh для поиска интерфейса
            const interfaceLines = interfaceList.split('\n');
            let interfaceName = null;
            
            // Альтернативный способ: получить через netsh interface ip show config
            try {
              const configOutput = execSync('netsh interface ip show config', {
                encoding: 'utf-8',
              });
              
              // Ищем интерфейс по индексу в конфигурации
              const configSections = configOutput.split(/Configuration for interface/);
              for (const section of configSections) {
                if (section.includes(`Interface Index: ${interfaceIndex}`)) {
                  const nameMatch = section.match(/^"([^"]+)"/m);
                  if (nameMatch) {
                    interfaceName = nameMatch[1];
                    break;
                  }
                }
              }
            } catch (configError) {
              logger.debug('Failed to get interface name via config', { error: configError });
            }
            
            // Если не нашли через config, попробуем через show interface
            if (!interfaceName) {
              for (const ifLine of interfaceLines) {
                // Формат: Admin State    State          Type             Interface Name
                // Ищем строку, которая может содержать индекс
                if (ifLine.trim().length > 0 && !ifLine.includes('Admin State')) {
                  const ifParts = ifLine.trim().split(/\s{2,}/);
                  if (ifParts.length >= 4) {
                    // Проверяем, может ли это быть наш интерфейс
                    // Попробуем получить имя напрямую через netsh
                    const ifName = ifParts[3];
                    try {
                      const ifConfig = execSync(
                        `netsh interface ip show address "${ifName}"`,
                        { encoding: 'utf-8', stdio: 'pipe' }
                      );
                      if (ifConfig.includes(gateway) || ifConfig.includes(interfaceIndex)) {
                        interfaceName = ifName;
                        break;
                      }
                    } catch {
                      // Продолжаем поиск
                    }
                  }
                }
              }
            }
            
            if (interfaceName) {
              // Получить IP адрес интерфейса
              try {
                const ipOutput = execSync(
                  `netsh interface ip show address "${interfaceName}"`,
                  { encoding: 'utf-8' }
                );
                const ipMatch = ipOutput.match(/IP Address:\s+([\d.]+)/);
                
                if (ipMatch) {
                  return {
                    name: interfaceName,
                    ipv4: ipMatch[1],
                    gateway: gateway,
                    isDefault: true,
                  };
                }
              } catch (ipError) {
                logger.debug('Failed to get IP via netsh', { error: ipError, interfaceName });
              }
            }
          } catch (ifError) {
            logger.debug('Failed to get interface name', { error: ifError, interfaceIndex });
          }
        }
      }
    }
    
    return null;
  } catch (error) {
    logger.error('Failed to get Windows physical interface', { error });
    return null;
  }
}

function getMacOSPhysicalInterface(): PhysicalInterface | null {
  try {
    // Получить default gateway
    const routeOutput = execSync('route -n get default', { encoding: 'utf-8' });
    const gatewayMatch = routeOutput.match(/gateway: ([\d.]+)/);
    const interfaceMatch = routeOutput.match(/interface: (\w+)/);
    
    if (!gatewayMatch || !interfaceMatch) {
      return null;
    }

    const gateway = gatewayMatch[1];
    const interfaceName = interfaceMatch[1];

    // Получить IP адрес интерфейса
    const ipOutput = execSync(`ifconfig ${interfaceName}`, { encoding: 'utf-8' });
    const ipMatch = ipOutput.match(/inet ([\d.]+)/);
    
    if (!ipMatch) {
      return null;
    }

    return {
      name: interfaceName,
      ipv4: ipMatch[1],
      gateway: gateway,
      isDefault: true,
    };
  } catch (error) {
    logger.error('Failed to get macOS physical interface', { error });
    return null;
  }
}

