import { Command } from 'commander';
import { logger } from '../../utils/logger';
import { execSync } from 'child_process';
import { checkWireGuardInstalled, getWireGuardPaths, isLinux } from '../../utils/platform';
import { getPhysicalInterface } from '../../utils/networkInterface';

export interface DiagnosticResult {
  name: string;
  success: boolean;
  error?: string;
  details?: any;
}

export function diagnoseCommand(program: Command): void {
  program
    .command('diagnose')
    .description('Run diagnostic checks')
    .option('-v, --verbose', 'Verbose output')
    .action(async (options) => {
      console.log('Running diagnostic checks...\n');

      const checks = [
        checkSystemRequirements,
        checkNetworkConfiguration,
        checkWireGuard,
        checkNAT,
        checkRouting,
        checkFirewall,
      ];

      let passed = 0;
      let failed = 0;

      for (const check of checks) {
        try {
          const result = await check(options.verbose);
          if (result.success) {
            console.log(`✓ ${result.name}`);
            if (options.verbose && result.details) {
              console.log(`  Details:`, result.details);
            }
            passed++;
          } else {
            console.log(`✗ ${result.name}: ${result.error}`);
            if (options.verbose && result.details) {
              console.log(`  Details:`, result.details);
            }
            failed++;
          }
        } catch (error: any) {
          console.log(`✗ Error running check: ${error.message}`);
          failed++;
        }
      }

      console.log(`\nResults: ${passed} passed, ${failed} failed`);
    });
}

async function checkSystemRequirements(verbose: boolean): Promise<DiagnosticResult> {
  // Проверить права доступа, версии, зависимости
  try {
    const wireguardInstalled = checkWireGuardInstalled();
    if (!wireguardInstalled) {
      return {
        name: 'System Requirements',
        success: false,
        error: 'WireGuard not installed',
      };
    }

    return {
      name: 'System Requirements',
      success: true,
      details: { wireguardInstalled: true },
    };
  } catch (error: any) {
    return {
      name: 'System Requirements',
      success: false,
      error: error.message,
    };
  }
}

async function checkNetworkConfiguration(verbose: boolean): Promise<DiagnosticResult> {
  // Проверить сетевую конфигурацию
  try {
    const interface_ = getPhysicalInterface();
    
    if (!interface_) {
      return {
        name: 'Network Configuration',
        success: false,
        error: 'Failed to detect physical interface',
      };
    }

    return {
      name: 'Network Configuration',
      success: true,
      details: interface_,
    };
  } catch (error: any) {
    return {
      name: 'Network Configuration',
      success: false,
      error: error.message,
    };
  }
}

async function checkWireGuard(verbose: boolean): Promise<DiagnosticResult> {
  // Проверить WireGuard
  try {
    const paths = getWireGuardPaths();
    
    execSync(`"${paths.wg}" --version`, { stdio: 'pipe' });
    
    return {
      name: 'WireGuard',
      success: true,
      details: { version: 'installed' },
    };
  } catch (error: any) {
    return {
      name: 'WireGuard',
      success: false,
      error: error.message,
    };
  }
}

async function checkNAT(verbose: boolean): Promise<DiagnosticResult> {
  // Проверить NAT
  try {
    if (isLinux()) {
      const forwarding = execSync('sysctl net.ipv4.ip_forward', { encoding: 'utf-8' });
      const enabled = forwarding.includes('= 1');
      
      return {
        name: 'NAT',
        success: enabled,
        error: enabled ? undefined : 'IP forwarding not enabled',
        details: { forwarding: enabled },
      };
    }
    
    return {
      name: 'NAT',
      success: true,
      details: { platform: 'not Linux' },
    };
  } catch (error: any) {
    return {
      name: 'NAT',
      success: false,
      error: error.message,
    };
  }
}

async function checkRouting(verbose: boolean): Promise<DiagnosticResult> {
  // Проверить маршрутизацию
  try {
    if (isLinux()) {
      const routes = execSync('ip route show', { encoding: 'utf-8' });
      const hasDefault = routes.includes('default');
      
      return {
        name: 'Routing',
        success: hasDefault,
        error: hasDefault ? undefined : 'No default route found',
        details: { hasDefaultRoute: hasDefault },
      };
    }
    
    return {
      name: 'Routing',
      success: true,
    };
  } catch (error: any) {
    return {
      name: 'Routing',
      success: false,
      error: error.message,
    };
  }
}

async function checkFirewall(verbose: boolean): Promise<DiagnosticResult> {
  // Проверить firewall
  try {
    if (isLinux()) {
      execSync('iptables -L', { stdio: 'pipe' });
      return {
        name: 'Firewall',
        success: true,
        details: { iptables: 'accessible' },
      };
    }
    
    return {
      name: 'Firewall',
      success: true,
    };
  } catch (error: any) {
    return {
      name: 'Firewall',
      success: false,
      error: error.message,
    };
  }
}

