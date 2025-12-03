import { execSync } from 'child_process';
import os from 'os';
import path from 'path';

export type Platform = 'win32' | 'linux' | 'darwin';

export function getPlatform(): Platform {
  return os.platform() as Platform;
}

export function isWindows(): boolean {
  return getPlatform() === 'win32';
}

export function isLinux(): boolean {
  return getPlatform() === 'linux';
}

export function isMacOS(): boolean {
  return getPlatform() === 'darwin';
}

export interface WireGuardPaths {
  wg: string;
  wgQuick: string;
  configDir: string;
}

export function getWireGuardPaths(): WireGuardPaths {
  const platform = getPlatform();

  if (platform === 'win32') {
    // Windows: WireGuard is typically installed in Program Files
    const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
    return {
      wg: path.join(programFiles, 'WireGuard', 'wg.exe'),
      wgQuick: path.join(programFiles, 'WireGuard', 'wg-quick.exe'),
      configDir: path.join(os.homedir(), 'AppData', 'Roaming', 'WireGuard'),
    };
  } else if (platform === 'darwin') {
    // macOS: WireGuard tools are typically in /usr/local/bin or /opt/homebrew/bin
    const homebrewPrefix = '/opt/homebrew';
    const localPrefix = '/usr/local';
    
    // Try to find wg in common locations
    let wgPath = '/usr/local/bin/wg';
    let wgQuickPath = '/usr/local/bin/wg-quick';
    
    try {
      // Check if homebrew version exists
      execSync('which wg', { stdio: 'ignore' });
      const wgWhich = execSync('which wg', { encoding: 'utf-8' }).trim();
      const wgQuickWhich = execSync('which wg-quick', { encoding: 'utf-8' }).trim();
      wgPath = wgWhich;
      wgQuickPath = wgQuickWhich;
    } catch {
      // Fallback to default paths
    }

    return {
      wg: wgPath,
      wgQuick: wgQuickPath,
      configDir: '/usr/local/etc/wireguard',
    };
  } else {
    // Linux: WireGuard tools are typically in /usr/bin
    return {
      wg: '/usr/bin/wg',
      wgQuick: '/usr/bin/wg-quick',
      configDir: '/etc/wireguard',
    };
  }
}

export function checkWireGuardInstalled(): boolean {
  try {
    const paths = getWireGuardPaths();
    execSync(`"${paths.wg}" --version`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function requireAdmin(): boolean {
  // On Windows, check if running as administrator
  if (isWindows()) {
    try {
      execSync('net session', { stdio: 'ignore' });
      return false; // Has admin rights
    } catch {
      return true; // Needs admin rights
    }
  }

  // On Unix-like systems, check if running as root
  if (typeof process.getuid === 'function') {
    return process.getuid() !== 0;
  }
  return true; // Assume needs admin if can't check
}

export function getConfigFilePath(filename: string): string {
  const platform = getPlatform();
  
  if (platform === 'win32') {
    return path.join(os.homedir(), 'AppData', 'Roaming', 'higgsnode', filename);
  } else if (platform === 'darwin') {
    return path.join(os.homedir(), '.config', 'higgsnode', filename);
  } else {
    return path.join(os.homedir(), '.config', 'higgsnode', filename);
  }
}

