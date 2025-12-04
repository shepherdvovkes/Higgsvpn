import { execSync } from 'child_process';
import { EventEmitter } from 'events';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import { isWindows, isLinux, isMacOS } from '../utils/platform';
import { WireGuardManager } from '../managers/WireGuardManager';
import { getPhysicalInterface, PhysicalInterface } from '../utils/networkInterface';

export interface RoutingRule {
  id: string;
  source: string;
  destination: string;
  action: 'allow' | 'deny' | 'nat';
}

export class RoutingEngine extends EventEmitter {
  private wireGuardManager: WireGuardManager;
  private rules: Map<string, RoutingRule> = new Map();
  private natEnabled = false;
  private physicalInterface: PhysicalInterface | null = null;
  private natRules: string[] = []; // Для отслеживания добавленных правил
  private savedRules: string[] = []; // Для сохранения существующих правил

  constructor(wireGuardManager: WireGuardManager) {
    super();
    this.wireGuardManager = wireGuardManager;
  }

  async setupRouting(): Promise<void> {
    try {
      logger.info('Setting up routing');

      const interfaceName = this.wireGuardManager.getInterfaceName();
      const address = config.wireguard.address;
      const [ip, mask] = address.split('/');

      if (isWindows()) {
        await this.setupWindowsRouting(interfaceName, ip, mask);
      } else if (isLinux()) {
        await this.setupLinuxRouting(interfaceName, ip, mask);
      } else if (isMacOS()) {
        await this.setupMacOSRouting(interfaceName, ip, mask);
      }

      logger.info('Routing setup completed');
      this.emit('routingSetup');
    } catch (error) {
      logger.error('Failed to setup routing', { error });
      throw error;
    }
  }

  private async setupWindowsRouting(interfaceName: string, ip: string, mask: string): Promise<void> {
    try {
      // Windows routing setup using netsh
      // Правильный синтаксис: netsh interface ipv4 add route prefix=<network>/<mask> interface="<name>" metric=<metric>
      const subnet = this.calculateSubnet(ip, mask);
      const subnetMask = this.cidrToSubnetMask(mask);
      
      // Получить метрику интерфейса (обычно 1 для WireGuard)
      const metric = 1;
      
      // Проверить, существует ли маршрут
      try {
        const routeOutput = execSync(`route print ${subnet}`, { encoding: 'utf-8', stdio: 'pipe' });
        if (routeOutput.includes(subnet)) {
          logger.debug('Windows route already exists', { subnet, mask });
          return;
        }
      } catch {
        // Маршрут не существует, продолжить
      }
      
      // Добавить маршрут для WireGuard подсети
      try {
        // Попробовать правильный синтаксис netsh
        execSync(
          `netsh interface ipv4 add route prefix=${subnet}/${mask} interface="${interfaceName}" metric=${metric}`,
          { stdio: 'pipe' }
        );
        logger.debug('Windows route added via netsh', { subnet, mask, interface: interfaceName, metric });
      } catch (netshError: any) {
        // Если netsh не работает, попробовать через route add (требует IP адрес интерфейса)
        if (netshError.message && netshError.message.includes('already exists')) {
          logger.debug('Route already exists', { subnet, mask });
        } else {
          try {
            // Попробовать использовать IP адрес интерфейса для route add
            execSync(
              `route add ${subnet} mask ${subnetMask} ${ip} metric ${metric}`,
              { stdio: 'pipe' }
            );
            logger.debug('Windows route added via route add', { subnet, mask, interfaceIP: ip });
          } catch (routeError: any) {
            if (routeError.message && (routeError.message.includes('already exists') || routeError.message.includes('already in table'))) {
              logger.debug('Route already exists', { subnet, mask });
            } else {
              logger.warn('Failed to add Windows route (non-critical)', { error: routeError, subnet, mask });
              // Не критично, продолжим
            }
          }
        }
      }
    } catch (error: any) {
      logger.warn('Failed to setup Windows routing (non-critical)', { error, interfaceName, ip, mask });
      // Не критично, продолжим
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

  private async setupLinuxRouting(interfaceName: string, ip: string, mask: string): Promise<void> {
    try {
      // Linux routing setup using ip command
      const subnet = this.calculateSubnet(ip, mask);
      execSync(`ip route add ${subnet}/${mask} dev ${interfaceName}`, { stdio: 'pipe' });
      logger.debug('Linux route added', { subnet, mask, interface: interfaceName });
    } catch (error: any) {
      // Route might already exist
      if (!error.message || !error.message.includes('File exists')) {
        logger.warn('Failed to add Linux route', { error });
      }
    }
  }

  private async setupMacOSRouting(interfaceName: string, ip: string, mask: string): Promise<void> {
    try {
      // macOS routing setup using route command
      const subnet = this.calculateSubnet(ip, mask);
      execSync(`route add -net ${subnet}/${mask} -interface ${interfaceName}`, { stdio: 'pipe' });
      logger.debug('macOS route added', { subnet, mask, interface: interfaceName });
    } catch (error: any) {
      // Route might already exist
      if (!error.message || !error.message.includes('already in table')) {
        logger.warn('Failed to add macOS route', { error });
      }
    }
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

  async enableNat(): Promise<void> {
    if (this.natEnabled) {
      return;
    }

    try {
      logger.info('Enabling NAT');

      // Определить физический интерфейс
      this.physicalInterface = getPhysicalInterface();
      if (!this.physicalInterface) {
        throw new Error('Failed to detect physical network interface');
      }

      logger.info('Physical interface detected', {
        name: this.physicalInterface.name,
        ipv4: this.physicalInterface.ipv4,
        gateway: this.physicalInterface.gateway,
      });

      // Сохранить текущие правила
      await this.saveCurrentRules();

      // Note: WireGuard interface is not created - HiggsNode receives packets via API
      // No need to check conflicts with WireGuard interface

      if (isWindows()) {
        await this.enableWindowsNat();
      } else if (isLinux()) {
        await this.enableLinuxNat();
      } else if (isMacOS()) {
        await this.enableMacOSNat();
      }

      this.natEnabled = true;
      logger.info('NAT enabled');
      this.emit('natEnabled');
    } catch (error) {
      logger.error('Failed to enable NAT', { error });
      throw error;
    }
  }

  private async enableWindowsNat(): Promise<void> {
    if (!this.physicalInterface) {
      throw new Error('Physical interface not detected');
    }

    try {
      const physicalInterface = this.physicalInterface.name;

      logger.info('Enabling Windows NAT for physical interface', {
        physicalInterface,
      });

      // Note: WireGuard interface is NOT created
      // HiggsNode receives packets via API from BOSONSERVER
      // We only need IP forwarding enabled for NAT functionality

      // 1. Включить IP forwarding через реестр
      await this.enableWindowsIPForwarding();

      // 2. No WireGuard interface routing needed - packets come via API
      // 3. No firewall rules between interfaces needed - no WireGuard interface
      // 4. Basic NAT setup is handled by Windows automatically when IP forwarding is enabled

      logger.info('Windows NAT enabled successfully', {
        physicalInterface,
      });
    } catch (error) {
      logger.error('Failed to enable Windows NAT', { error });
      throw error;
    }
  }

  private async enableWindowsIPForwarding(): Promise<void> {
    try {
      // Включить IP forwarding через PowerShell (требует прав администратора)
      const psScript = `
        $regPath = "HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters"
        $forwarding = Get-ItemProperty -Path $regPath -Name "IPEnableRouter" -ErrorAction SilentlyContinue
        if ($forwarding -eq $null -or $forwarding.IPEnableRouter -ne 1) {
          Set-ItemProperty -Path $regPath -Name "IPEnableRouter" -Value 1 -Type DWord
          Write-Output "enabled"
        } else {
          Write-Output "already_enabled"
        }
      `;

      try {
        const output = execSync(
          `powershell -NoProfile -ExecutionPolicy Bypass -Command "${psScript}"`,
          { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' }
        ).trim();

        if (output.includes('enabled')) {
          logger.info('Windows IP forwarding enabled via registry');
          // Перезапуск не требуется, но может потребоваться перезагрузка для некоторых версий Windows
          logger.warn('IP forwarding enabled. System restart may be required for changes to take effect.');
        } else {
          logger.debug('Windows IP forwarding already enabled');
        }
      } catch (psError) {
        logger.warn('Failed to enable IP forwarding via PowerShell, trying netsh', { error: psError });
        // Альтернативный способ через netsh (может не работать на всех версиях)
        try {
          execSync('netsh interface ipv4 set global forwarding=enabled', { stdio: 'pipe' });
          logger.info('Windows IP forwarding enabled via netsh');
        } catch (netshError) {
          logger.error('Failed to enable IP forwarding', { error: netshError });
          throw new Error('Failed to enable IP forwarding on Windows');
        }
      }
    } catch (error) {
      logger.error('Failed to enable Windows IP forwarding', { error });
      throw error;
    }
  }

  private async ensureWireGuardRoute(
    interfaceName: string,
    subnet: string,
    mask: string
  ): Promise<void> {
    try {
      // subnet здесь - это IP адрес интерфейса (например, 10.0.0.1), нужно вычислить сеть (10.0.0.0)
      const networkSubnet = this.calculateSubnet(subnet, mask);
      
      // Проверить, существует ли маршрут
      const routeOutput = execSync(`route print ${networkSubnet}`, { encoding: 'utf-8', stdio: 'pipe' });
      
      if (!routeOutput.includes(networkSubnet)) {
        // Маршрут не существует, добавить через netsh (более надежный способ на Windows)
        try {
          execSync(
            `netsh interface ipv4 add route ${networkSubnet}/${mask} "${interfaceName}" metric=1 store=active`,
            { stdio: 'pipe' }
          );
          logger.debug('WireGuard route added via netsh', { subnet: networkSubnet, mask, interface: interfaceName });
        } catch (netshError: any) {
          // Если netsh не работает, попробовать через route add (требует IP адрес интерфейса)
          try {
            // Получить IP адрес интерфейса WireGuard
            let interfaceIP: string | null = null;
            
            try {
              const ipOutput = execSync(
                `netsh interface ip show address "${interfaceName}"`,
                { encoding: 'utf-8', stdio: 'pipe' }
              );
              const ipMatch = ipOutput.match(/IP Address:\s+([\d.]+)/);
              if (ipMatch) {
                interfaceIP = ipMatch[1];
              }
            } catch {
              // Интерфейс может еще не существовать, используем subnet как fallback
              interfaceIP = subnet;
            }
            
            if (interfaceIP) {
              const subnetMask = this.cidrToSubnetMask(mask);
              execSync(
                `route add ${networkSubnet} mask ${subnetMask} ${interfaceIP} metric 1`,
                { stdio: 'pipe' }
              );
              logger.debug('WireGuard route added via route add', { subnet: networkSubnet, mask, interface: interfaceName, interfaceIP });
            } else {
              logger.warn('Could not determine WireGuard interface IP address, skipping route', { interface: interfaceName });
            }
          } catch (routeError: any) {
            if (routeError.message && (routeError.message.includes('already exists') || routeError.message.includes('already in table'))) {
              logger.debug('Route already exists', { subnet: networkSubnet });
            } else {
              logger.warn('Failed to add Windows route', { error: routeError, subnet: networkSubnet, mask });
            }
          }
        }
      } else {
        logger.debug('WireGuard route already exists', { subnet: networkSubnet });
      }
    } catch (error: any) {
      if (error.message && (error.message.includes('already exists') || error.message.includes('already in table'))) {
        logger.debug('Route already exists', { subnet });
      } else {
        logger.warn('Failed to ensure WireGuard route', { error, subnet, mask });
      }
    }
  }

  private async setupWindowsFirewallForwarding(
    wireguardInterface: string,
    physicalInterface: string
  ): Promise<void> {
    try {
      // Настроить Windows Firewall для разрешения forwarding между интерфейсами
      // Windows Firewall не поддерживает remoteinterface, поэтому используем более простые правила
      // Разрешаем весь трафик на интерфейсах (NAT будет обрабатываться системой)

      // Правило 1: Разрешить исходящий трафик с WireGuard интерфейса
      const ruleNameOut = `HiggsNode-Forward-${wireguardInterface}-Out`;
      try {
        execSync(
          `netsh advfirewall firewall delete rule name="${ruleNameOut}"`,
          { stdio: 'pipe' }
        );
      } catch {
        // Правило может не существовать
      }

      try {
        execSync(
          `netsh advfirewall firewall add rule name="${ruleNameOut}" dir=out action=allow interface="${wireguardInterface}"`,
          { stdio: 'pipe' }
        );
        this.natRules.push(ruleNameOut);
        logger.debug('Windows Firewall forwarding rule added (outbound)', { ruleNameOut });
      } catch (error: any) {
        // Если не удалось добавить по имени интерфейса, попробовать через PowerShell
        logger.debug('Failed to add firewall rule via netsh, trying PowerShell', { error });
        try {
          const psScript = `New-NetFirewallRule -DisplayName "${ruleNameOut}" -Direction Outbound -Action Allow -InterfaceAlias "${wireguardInterface}" -ErrorAction SilentlyContinue`;
          execSync(
            `powershell -NoProfile -ExecutionPolicy Bypass -Command "${psScript}"`,
            { stdio: 'pipe' }
          );
          this.natRules.push(ruleNameOut);
        } catch {
          logger.debug('Failed to add firewall rule via PowerShell');
        }
      }

      // Правило 2: Разрешить входящий трафик на физический интерфейс
      const ruleNameIn = `HiggsNode-Forward-${physicalInterface}-In`;
      try {
        execSync(
          `netsh advfirewall firewall delete rule name="${ruleNameIn}"`,
          { stdio: 'pipe' }
        );
      } catch {
        // Правило может не существовать
      }

      try {
        execSync(
          `netsh advfirewall firewall add rule name="${ruleNameIn}" dir=in action=allow interface="${physicalInterface}"`,
          { stdio: 'pipe' }
        );
        this.natRules.push(ruleNameIn);
        logger.debug('Windows Firewall forwarding rule added (inbound)', { ruleNameIn });
      } catch (error: any) {
        // Если не удалось добавить по имени интерфейса, попробовать через PowerShell
        logger.debug('Failed to add firewall rule via netsh, trying PowerShell', { error });
        try {
          const psScript = `New-NetFirewallRule -DisplayName "${ruleNameIn}" -Direction Inbound -Action Allow -InterfaceAlias "${physicalInterface}" -ErrorAction SilentlyContinue`;
          execSync(
            `powershell -NoProfile -ExecutionPolicy Bypass -Command "${psScript}"`,
            { stdio: 'pipe' }
          );
          this.natRules.push(ruleNameIn);
        } catch {
          logger.debug('Failed to add firewall rule via PowerShell');
        }
      }
    } catch (error) {
      logger.warn('Failed to setup Windows Firewall forwarding rules', { error });
      // Не критично, продолжим
    }
  }

  private async setupWindowsNATRouting(
    wireguardInterface: string,
    physicalInterface: string,
    wireguardSubnet: string,
    wireguardMask: string
  ): Promise<void> {
    try {
      // Windows не имеет прямого эквивалента iptables MASQUERADE
      // Вместо этого используем комбинацию:
      // 1. Маршрутизация через таблицу маршрутов
      // 2. Windows автоматически делает NAT для трафика, идущего через default gateway
      // 3. Дополнительно можно использовать netsh interface portproxy для специфичных портов

      // Убедиться, что default route идет через физический интерфейс
      const defaultRoute = execSync('route print 0.0.0.0', { encoding: 'utf-8' });
      
      if (!defaultRoute.includes(physicalInterface)) {
        logger.warn('Default route does not go through physical interface', {
          physicalInterface,
          defaultRoute: defaultRoute.substring(0, 200),
        });
      }

      // Добавить маршрут для WireGuard подсети через WireGuard интерфейс
      // Это гарантирует, что трафик к клиентам идет через WireGuard
      await this.ensureWireGuardRoute(wireguardInterface, wireguardSubnet, wireguardMask);

      logger.debug('Windows NAT routing configured', {
        wireguardInterface,
        physicalInterface,
        wireguardSubnet,
      });
    } catch (error) {
      logger.warn('Failed to setup Windows NAT routing', { error });
      // Не критично, продолжим
    }
  }

  private async enableLinuxNat(): Promise<void> {
    if (!this.physicalInterface) {
      throw new Error('Physical interface not detected');
    }

    try {
      const wireguardInterface = this.wireGuardManager.getInterfaceName();
      const physicalInterface = this.physicalInterface.name;

      // 1. Enable IP forwarding
      execSync('sysctl -w net.ipv4.ip_forward=1', { stdio: 'pipe' });
      logger.debug('IP forwarding enabled');

      // 2. Enable IPv6 forwarding
      try {
        execSync('sysctl -w net.ipv6.conf.all.forwarding=1', { stdio: 'pipe' });
        logger.debug('IPv6 forwarding enabled');
      } catch (error) {
        logger.debug('IPv6 forwarding not available', { error });
      }

      // 3. Создать отдельную цепочку для HiggsNode (для легкой очистки)
      try {
        execSync('iptables -N HIGGSNODE_FORWARD 2>/dev/null', { stdio: 'pipe' });
      } catch {
        // Цепочка уже существует, это нормально
      }

      try {
        execSync('iptables -t nat -N HIGGSNODE_NAT 2>/dev/null', { stdio: 'pipe' });
      } catch {
        // Цепочка уже существует, это нормально
      }

      // 4. NAT правило: от WireGuard к физическому интерфейсу
      const natRule = `iptables -t nat -A HIGGSNODE_NAT -i ${wireguardInterface} -o ${physicalInterface} -j MASQUERADE`;
      execSync(natRule, { stdio: 'pipe' });
      this.natRules.push(natRule);
      logger.debug('NAT rule added', { rule: natRule });

      // 5. Подключить цепочку к основной таблице
      execSync(`iptables -t nat -A POSTROUTING -j HIGGSNODE_NAT`, { stdio: 'pipe' });

      // 6. Forwarding правила: разрешить трафик от WireGuard к физическому интерфейсу
      const forwardOutRule = `iptables -A HIGGSNODE_FORWARD -i ${wireguardInterface} -o ${physicalInterface} -j ACCEPT`;
      execSync(forwardOutRule, { stdio: 'pipe' });
      this.natRules.push(forwardOutRule);

      // 7. Forwarding правила: разрешить обратный трафик
      const forwardInRule = `iptables -A HIGGSNODE_FORWARD -i ${physicalInterface} -o ${wireguardInterface} -m state --state RELATED,ESTABLISHED -j ACCEPT`;
      execSync(forwardInRule, { stdio: 'pipe' });
      this.natRules.push(forwardInRule);

      // 8. Подключить цепочку forwarding к основной таблице
      execSync(`iptables -A FORWARD -j HIGGSNODE_FORWARD`, { stdio: 'pipe' });

      // 9. IPv6 NAT (если поддерживается)
      await this.enableIPv6NAT();

      logger.info('Linux NAT enabled successfully', {
        wireguardInterface,
        physicalInterface,
      });
    } catch (error) {
      logger.error('Failed to enable Linux NAT', { error });
      throw error;
    }
  }

  private async enableIPv6NAT(): Promise<void> {
    if (!this.physicalInterface) {
      return;
    }

    try {
      const wireguardInterface = this.wireGuardManager.getInterfaceName();
      const physicalInterface = this.physicalInterface.name;

      // IPv6 NAT (используя ip6tables)
      try {
        execSync(
          `ip6tables -t nat -A POSTROUTING -i ${wireguardInterface} -o ${physicalInterface} -j MASQUERADE`,
          { stdio: 'pipe' }
        );
        logger.info('IPv6 NAT enabled');
      } catch (error) {
        // Некоторые системы не поддерживают IPv6 NAT
        logger.warn('IPv6 NAT not supported', { error });
      }

      // IPv6 forwarding rules
      try {
        execSync(
          `ip6tables -A FORWARD -i ${wireguardInterface} -o ${physicalInterface} -j ACCEPT`,
          { stdio: 'pipe' }
        );
        execSync(
          `ip6tables -A FORWARD -i ${physicalInterface} -o ${wireguardInterface} -m state --state RELATED,ESTABLISHED -j ACCEPT`,
          { stdio: 'pipe' }
        );
        logger.debug('IPv6 forwarding rules added');
      } catch (error) {
        logger.debug('IPv6 forwarding rules not available', { error });
      }
    } catch (error) {
      logger.warn('Failed to enable IPv6 NAT', { error });
    }
  }

  /**
   * Сохраняет текущие iptables правила перед изменением
   */
  private async saveCurrentRules(): Promise<void> {
    try {
      if (isLinux()) {
        const output = execSync('iptables-save', { encoding: 'utf-8' });
        this.savedRules = output.split('\n');
        logger.debug('Current iptables rules saved', { ruleCount: this.savedRules.length });
      }
    } catch (error) {
      logger.warn('Failed to save current iptables rules', { error });
    }
  }

  /**
   * Проверяет конфликты с существующими правилами
   */
  private async checkConflicts(interfaceName: string): Promise<string[]> {
    const conflicts: string[] = [];

    try {
      if (isLinux()) {
        // Проверить, есть ли правила для этого интерфейса
        try {
          const output = execSync(`iptables -L FORWARD -v -n | grep ${interfaceName}`, {
            encoding: 'utf-8',
            stdio: 'pipe',
          });

          if (output.trim().length > 0) {
            conflicts.push(`Existing FORWARD rules found for ${interfaceName}`);
          }
        } catch {
          // Нет конфликтов или ошибка проверки
        }
      }
    } catch (error) {
      // Нет конфликтов или ошибка проверки
    }

    return conflicts;
  }

  private async enableMacOSNat(): Promise<void> {
    try {
      // macOS NAT using pfctl
      const interfaceName = this.wireGuardManager.getInterfaceName();
      const pfConfig = `nat on ${interfaceName} from any to any -> (${interfaceName})`;
      
      // This would require writing to /etc/pf.conf and reloading
      // For now, just log
      logger.debug('macOS NAT configuration (requires pfctl setup)', { interface: interfaceName });
    } catch (error) {
      logger.warn('Failed to enable macOS NAT', { error });
    }
  }

  async disableNat(): Promise<void> {
    if (!this.natEnabled) {
      return;
    }

    try {
      logger.info('Disabling NAT');

      if (isLinux()) {
        await this.disableLinuxNat();
      } else if (isWindows()) {
        await this.disableWindowsNat();
      } else if (isMacOS()) {
        await this.disableMacOSNat();
      }

      this.natEnabled = false;
      this.physicalInterface = null;
      this.natRules = [];
      logger.info('NAT disabled');
      this.emit('natDisabled');
    } catch (error) {
      logger.error('Failed to disable NAT', { error });
    }
  }

  private async disableLinuxNat(): Promise<void> {
    try {
      // Удалить правила в обратном порядке
      try {
        execSync('iptables -D FORWARD -j HIGGSNODE_FORWARD', { stdio: 'pipe' });
      } catch {
        // Правило может не существовать
      }

      try {
        execSync('iptables -t nat -D POSTROUTING -j HIGGSNODE_NAT', { stdio: 'pipe' });
      } catch {
        // Правило может не существовать
      }

      // Очистить цепочки
      try {
        execSync('iptables -F HIGGSNODE_FORWARD', { stdio: 'pipe' });
        execSync('iptables -X HIGGSNODE_FORWARD', { stdio: 'pipe' });
      } catch {
        // Цепочка может не существовать
      }

      try {
        execSync('iptables -t nat -F HIGGSNODE_NAT', { stdio: 'pipe' });
        execSync('iptables -t nat -X HIGGSNODE_NAT', { stdio: 'pipe' });
      } catch {
        // Цепочка может не существовать
      }

      // Удалить IPv6 правила
      try {
        const wireguardInterface = this.wireGuardManager.getInterfaceName();
        const physicalInterface = this.physicalInterface?.name;
        if (physicalInterface) {
          execSync(
            `ip6tables -t nat -D POSTROUTING -i ${wireguardInterface} -o ${physicalInterface} -j MASQUERADE`,
            { stdio: 'pipe' }
          );
        }
      } catch {
        // Правило может не существовать
      }

      logger.info('Linux NAT disabled and cleaned up');
    } catch (error) {
      logger.error('Failed to disable Linux NAT', { error });
    }
  }

  private async disableWindowsNat(): Promise<void> {
    try {
      logger.info('Disabling Windows NAT');

      // Удалить правила firewall
      for (const ruleName of this.natRules) {
        try {
          execSync(`netsh advfirewall firewall delete rule name="${ruleName}"`, {
            stdio: 'pipe',
          });
          logger.debug('Windows Firewall rule removed', { ruleName });
        } catch (error) {
          // Правило может не существовать
          logger.debug('Failed to remove firewall rule (may not exist)', { ruleName, error });
        }
      }

      // Очистить список правил
      this.natRules = [];

      logger.info('Windows NAT disabled and cleaned up');
    } catch (error) {
      logger.error('Failed to disable Windows NAT', { error });
    }
  }

  private async disableMacOSNat(): Promise<void> {
    // macOS NAT using pfctl
    logger.debug('macOS NAT disabled');
  }

  async addFirewallRule(rule: RoutingRule): Promise<void> {
    try {
      logger.info('Adding firewall rule', { ruleId: rule.id });

      if (isWindows()) {
        await this.addWindowsFirewallRule(rule);
      } else if (isLinux()) {
        await this.addLinuxFirewallRule(rule);
      } else if (isMacOS()) {
        await this.addMacOSFirewallRule(rule);
      }

      this.rules.set(rule.id, rule);
      this.emit('ruleAdded', rule);
    } catch (error) {
      logger.error('Failed to add firewall rule', { error, ruleId: rule.id });
      throw error;
    }
  }

  private async addWindowsFirewallRule(rule: RoutingRule): Promise<void> {
    try {
      const ruleName = `HiggsNode-Rule-${rule.id}`;
      const action = rule.action === 'allow' ? 'allow' : 'block';
      const interfaceName = this.wireGuardManager.getInterfaceName();

      // Удалить существующее правило если есть
      try {
        execSync(`netsh advfirewall firewall delete rule name="${ruleName}"`, {
          stdio: 'pipe',
        });
      } catch {
        // Правило может не существовать
      }

      // Добавить правило
      let command = `netsh advfirewall firewall add rule name="${ruleName}" dir=out action=${action}`;

      // Добавить параметры источника и назначения
      if (rule.source && rule.source !== 'any') {
        command += ` remoteip=${rule.source}`;
      }
      if (rule.destination && rule.destination !== 'any') {
        command += ` remoteip=${rule.destination}`;
      }

      // Указать интерфейс
      command += ` interface="${interfaceName}"`;

      execSync(command, { stdio: 'pipe' });
      logger.info('Windows Firewall rule added', {
        ruleId: rule.id,
        ruleName,
        action,
        source: rule.source,
        destination: rule.destination,
      });
    } catch (error) {
      logger.error('Failed to add Windows Firewall rule', { error, ruleId: rule.id });
      throw error;
    }
  }

  private async addLinuxFirewallRule(rule: RoutingRule): Promise<void> {
    try {
      const interfaceName = this.wireGuardManager.getInterfaceName();
      const action = rule.action === 'allow' ? 'ACCEPT' : 'DROP';
      
      execSync(
        `iptables -A FORWARD -i ${interfaceName} -s ${rule.source} -d ${rule.destination} -j ${action}`,
        { stdio: 'pipe' }
      );
      
      logger.debug('Linux firewall rule added', { ruleId: rule.id });
    } catch (error) {
      logger.warn('Failed to add Linux firewall rule (may require root)', { error });
    }
  }

  private async addMacOSFirewallRule(rule: RoutingRule): Promise<void> {
    // macOS firewall rules using pfctl
    logger.debug('macOS firewall rule (requires pfctl configuration)', { ruleId: rule.id });
  }

  async removeFirewallRule(ruleId: string): Promise<void> {
    const rule = this.rules.get(ruleId);
    if (!rule) {
      return;
    }

    try {
      logger.info('Removing firewall rule', { ruleId });

      if (isWindows()) {
        const ruleName = `HiggsNode-Rule-${ruleId}`;
        try {
          execSync(`netsh advfirewall firewall delete rule name="${ruleName}"`, {
            stdio: 'pipe',
          });
          logger.debug('Windows Firewall rule removed', { ruleId, ruleName });
        } catch (error) {
          // Rule might not exist
          logger.debug('Failed to remove Windows Firewall rule (may not exist)', {
            ruleId,
            error,
          });
        }
      } else if (isLinux()) {
        const interfaceName = this.wireGuardManager.getInterfaceName();
        const action = rule.action === 'allow' ? 'ACCEPT' : 'DROP';
        
        try {
          execSync(
            `iptables -D FORWARD -i ${interfaceName} -s ${rule.source} -d ${rule.destination} -j ${action}`,
            { stdio: 'pipe' }
          );
        } catch (error) {
          // Rule might not exist
        }
      }

      this.rules.delete(ruleId);
      this.emit('ruleRemoved', ruleId);
    } catch (error) {
      logger.error('Failed to remove firewall rule', { error, ruleId });
    }
  }

  async cleanup(): Promise<void> {
    try {
      logger.info('Cleaning up routing');

      // Remove all firewall rules
      for (const ruleId of this.rules.keys()) {
        await this.removeFirewallRule(ruleId);
      }

      // Disable NAT
      await this.disableNat();

      this.emit('cleanup');
    } catch (error) {
      logger.error('Failed to cleanup routing', { error });
    }
  }

  getRules(): RoutingRule[] {
    return Array.from(this.rules.values());
  }

  isNatEnabled(): boolean {
    return this.natEnabled;
  }
}

