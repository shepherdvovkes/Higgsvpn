import { execSync, exec } from 'child_process';
import { promisify } from 'util';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import { config } from '../config/config';
import { getWireGuardPaths, getConfigFilePath, isWindows } from '../utils/platform';
import { logger } from '../utils/logger';
import { WireGuardError } from '../utils/errors';
import { MTUManager } from './MTUManager';

const execAsync = promisify(exec);

export interface WireGuardKeyPair {
  privateKey: string;
  publicKey: string;
}

export interface WireGuardStats {
  packets: {
    sent: number;
    received: number;
    errors: number;
  };
  bytes: {
    sent: number;
    received: number;
  };
  peers: Array<{
    publicKey: string;
    endpoint: string;
    allowedIps: string;
    latestHandshake: number;
    transfer: {
      received: number;
      sent: number;
    };
  }>;
}

export interface WireGuardInterface {
  name: string;
  publicKey: string;
  listenPort: number;
  address: string;
  status: 'up' | 'down' | 'unknown';
}

export class WireGuardManager extends EventEmitter {
  private interfaceName: string;
  private paths: ReturnType<typeof getWireGuardPaths>;
  private keyPair: WireGuardKeyPair | null = null;
  private configPath: string;
  private mtuManager: MTUManager;

  constructor() {
    super();
    this.interfaceName = config.wireguard.interfaceName;
    this.paths = getWireGuardPaths();
    // On Windows, WireGuard config files must be in %APPDATA%\WireGuard\
    if (isWindows()) {
      this.configPath = path.join(this.paths.configDir, `${this.interfaceName}.conf`);
    } else {
      this.configPath = getConfigFilePath(`${this.interfaceName}.conf`);
    }
    this.mtuManager = new MTUManager();
  }

  async generateKeyPair(): Promise<WireGuardKeyPair> {
    try {
      logger.info('Generating WireGuard key pair');

      // Generate private key
      const privateKeyOutput = execSync(`"${this.paths.wg}" genkey`, { encoding: 'utf-8' });
      const privateKey = privateKeyOutput.trim();

      // Generate public key from private key
      const publicKeyOutput = execSync(`"${this.paths.wg}" pubkey`, {
        input: privateKey,
        encoding: 'utf-8',
      });
      const publicKey = publicKeyOutput.trim();

      this.keyPair = { privateKey, publicKey };

      // Save keys securely
      await this.saveKeys();

      logger.info('WireGuard key pair generated', { publicKey: publicKey.substring(0, 20) + '...' });
      this.emit('keyPairGenerated', this.keyPair);

      return this.keyPair;
    } catch (error) {
      logger.error('Failed to generate WireGuard key pair', { error });
      throw new WireGuardError(`Failed to generate key pair: ${error}`);
    }
  }

  async loadOrGenerateKeyPair(): Promise<WireGuardKeyPair> {
    // Try to load existing keys
    const keysPath = getConfigFilePath('keys.json');
    
    if (fs.existsSync(keysPath)) {
      try {
        const keysData = fs.readFileSync(keysPath, 'utf-8');
        const keys = JSON.parse(keysData) as WireGuardKeyPair;
        this.keyPair = keys;
        logger.info('WireGuard keys loaded from file');
        return this.keyPair;
      } catch (error) {
        logger.warn('Failed to load keys, generating new pair', { error });
      }
    }

    // Generate new keys if loading failed
    return this.generateKeyPair();
  }

  private async saveKeys(): Promise<void> {
    if (!this.keyPair) {
      return;
    }

    const keysPath = getConfigFilePath('keys.json');
    const keysDir = path.dirname(keysPath);

    // Ensure directory exists
    if (!fs.existsSync(keysDir)) {
      fs.mkdirSync(keysDir, { recursive: true });
    }

    // Save keys with restricted permissions (Unix-like systems)
    fs.writeFileSync(keysPath, JSON.stringify(this.keyPair, null, 2), { mode: 0o600 });
    logger.debug('WireGuard keys saved', { path: keysPath });
  }

  getKeyPair(): WireGuardKeyPair | null {
    return this.keyPair;
  }

  getPublicKey(): string | null {
    return this.keyPair?.publicKey || null;
  }

  async createInterface(): Promise<void> {
    if (!this.keyPair) {
      throw new WireGuardError('Key pair not generated. Call loadOrGenerateKeyPair() first.');
    }

    try {
      logger.info('Creating WireGuard interface', { interface: this.interfaceName });

      // Create configuration file
      const configContent = this.generateConfig();
      await this.writeConfig(configContent);

      // Bring up interface
      // On Windows, wg-quick doesn't exist, so we use wg.exe directly
      if (isWindows()) {
        // Windows: Create interface using wg.exe and netsh
        await this.createWindowsInterface();
      } else {
        // Linux/macOS: Use wg-quick
        try {
          execSync(`"${this.paths.wgQuick}" up "${this.interfaceName}"`, {
            stdio: 'pipe',
          });
          logger.info('WireGuard interface created and started');
        } catch (error: any) {
          // Check if interface already exists
          if (error.message && error.message.includes('already exists')) {
            logger.info('WireGuard interface already exists');
          } else {
            throw error;
          }
        }
      }
        
      // Set optimal MTU after interface is created
      try {
        const optimalMTU = await this.mtuManager.detectOptimalMTU(this.interfaceName);
        await this.mtuManager.setMTU(this.interfaceName, optimalMTU);
      } catch (error) {
        logger.warn('Failed to set optimal MTU', { error });
      }
        
      this.emit('interfaceCreated', this.interfaceName);
    } catch (error) {
      logger.error('Failed to create WireGuard interface', { error });
      throw new WireGuardError(`Failed to create interface: ${error}`);
    }
  }

  private generateConfig(): string {
    if (!this.keyPair) {
      throw new WireGuardError('Key pair not available');
    }

    return `[Interface]
PrivateKey = ${this.keyPair.privateKey}
Address = ${config.wireguard.address}
ListenPort = ${config.wireguard.port}

# This interface is managed by HiggsNode
`;
  }

  private async writeConfig(content: string): Promise<void> {
    const configDir = path.dirname(this.configPath);
    
    // Ensure directory exists
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    // Write config file
    fs.writeFileSync(this.configPath, content, { mode: 0o600 });
    logger.debug('WireGuard config written', { path: this.configPath });
  }

  async addPeer(publicKey: string, allowedIps: string, endpoint?: string): Promise<void> {
    try {
      logger.info('Adding WireGuard peer', { publicKey: publicKey.substring(0, 20) + '...' });

      let command = `"${this.paths.wg}" set "${this.interfaceName}" peer "${publicKey}" allowed-ips "${allowedIps}"`;
      
      if (endpoint) {
        command += ` endpoint "${endpoint}"`;
      }

      execSync(command, { stdio: 'pipe' });
      logger.info('WireGuard peer added');
      this.emit('peerAdded', { publicKey, allowedIps, endpoint });
    } catch (error) {
      logger.error('Failed to add WireGuard peer', { error });
      throw new WireGuardError(`Failed to add peer: ${error}`);
    }
  }

  async removePeer(publicKey: string): Promise<void> {
    try {
      logger.info('Removing WireGuard peer', { publicKey: publicKey.substring(0, 20) + '...' });
      execSync(`"${this.paths.wg}" set "${this.interfaceName}" peer "${publicKey}" remove`, {
        stdio: 'pipe',
      });
      logger.info('WireGuard peer removed');
      this.emit('peerRemoved', { publicKey });
    } catch (error) {
      logger.error('Failed to remove WireGuard peer', { error });
      throw new WireGuardError(`Failed to remove peer: ${error}`);
    }
  }

  async getStats(): Promise<WireGuardStats> {
    try {
      const output = execSync(`"${this.paths.wg}" show "${this.interfaceName}" dump`, {
        encoding: 'utf-8',
        stdio: 'pipe',
      });

      return this.parseStats(output);
    } catch (error: any) {
      // If interface doesn't exist, return empty stats without logging error
      if (error.message && (error.message.includes('No such file') || error.message.includes('Unable to access interface'))) {
        return {
          packets: { sent: 0, received: 0, errors: 0 },
          bytes: { sent: 0, received: 0 },
          peers: [],
        };
      }
      logger.debug('Failed to get WireGuard stats', { error: error.message });
      // Return empty stats on error
      return {
        packets: { sent: 0, received: 0, errors: 0 },
        bytes: { sent: 0, received: 0 },
        peers: [],
      };
    }
  }

  private parseStats(output: string): WireGuardStats {
    const lines = output.trim().split('\n');
    const stats: WireGuardStats = {
      packets: { sent: 0, received: 0, errors: 0 },
      bytes: { sent: 0, received: 0 },
      peers: [],
    };

    // Skip first line (interface info)
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split('\t');
      if (parts.length >= 8) {
        const publicKey = parts[0];
        const endpoint = parts[2] !== '(none)' ? parts[2] : undefined;
        const allowedIps = parts[3];
        const latestHandshake = parseInt(parts[4], 10) || 0;
        const transferReceived = parseInt(parts[5], 10) || 0;
        const transferSent = parseInt(parts[6], 10) || 0;

        stats.bytes.received += transferReceived;
        stats.bytes.sent += transferSent;
        stats.packets.received += Math.floor(transferReceived / 1500); // Approximate
        stats.packets.sent += Math.floor(transferSent / 1500); // Approximate

        stats.peers.push({
          publicKey,
          endpoint: endpoint || '',
          allowedIps,
          latestHandshake,
          transfer: {
            received: transferReceived,
            sent: transferSent,
          },
        });
      }
    }

    return stats;
  }

  async getInterfaceStatus(): Promise<WireGuardInterface | null> {
    try {
      const output = execSync(`"${this.paths.wg}" show "${this.interfaceName}"`, {
        encoding: 'utf-8',
      });

      const lines = output.trim().split('\n');
      if (lines.length === 0) {
        return null;
      }

      // Parse interface info from first line
      const interfaceLine = lines[0];
      const publicKeyMatch = interfaceLine.match(/public key: (.+)/);
      const listenPortMatch = interfaceLine.match(/listening port: (\d+)/);

      return {
        name: this.interfaceName,
        publicKey: publicKeyMatch ? publicKeyMatch[1] : this.getPublicKey() || '',
        listenPort: listenPortMatch ? parseInt(listenPortMatch[1], 10) : config.wireguard.port,
        address: config.wireguard.address,
        status: 'up',
      };
    } catch (error) {
      // Interface might not exist
      return {
        name: this.interfaceName,
        publicKey: this.getPublicKey() || '',
        listenPort: config.wireguard.port,
        address: config.wireguard.address,
        status: 'down',
      };
    }
  }

  async stopInterface(): Promise<void> {
    try {
      logger.info('Stopping WireGuard interface', { interface: this.interfaceName });
      
      if (isWindows()) {
        // On Windows, manually remove the interface
        await this.deleteWindowsInterface();
      } else {
        // Linux/macOS: Use wg-quick
        execSync(`"${this.paths.wgQuick}" down "${this.interfaceName}"`, { stdio: 'pipe' });
      }
      
      logger.info('WireGuard interface stopped');
      this.emit('interfaceStopped', this.interfaceName);
    } catch (error: any) {
      // Interface might not exist, which is fine
      if (error.message && (error.message.includes('does not exist') || error.message.includes('No such file') || error.message.includes('Unable to access interface'))) {
        logger.debug('WireGuard interface does not exist, skipping stop');
      } else {
        logger.warn('Failed to stop WireGuard interface (non-critical)', { error: error.message });
        // Don't throw error, as interface might not exist
      }
    }
  }

  async deleteInterface(): Promise<void> {
    await this.stopInterface();
    
    // Remove config file
    if (fs.existsSync(this.configPath)) {
      fs.unlinkSync(this.configPath);
      logger.debug('WireGuard config file removed', { path: this.configPath });
    }
  }

  getInterfaceName(): string {
    return this.interfaceName;
  }

  /**
   * Create WireGuard interface on Windows using wg.exe directly
   * Windows doesn't have wg-quick, so we need to use wg.exe and netsh
   */
  private async createWindowsInterface(): Promise<void> {
    if (!this.keyPair) {
      throw new WireGuardError('Key pair not available');
    }

    try {
      // On Windows, WireGuard interfaces are managed through config files
      // The config file should be in %APPDATA%\WireGuard\
      // But we can also use wg.exe directly to set up the interface
      
      // First, check if interface already exists
      try {
        execSync(`"${this.paths.wg}" show "${this.interfaceName}"`, {
          stdio: 'pipe',
        });
        logger.info('WireGuard interface already exists');
        return;
      } catch {
        // Interface doesn't exist, continue with creation
      }

      // Get IP address and subnet from config
      const addressParts = config.wireguard.address.split('/');
      const ip = addressParts[0];
      const subnet = addressParts[1] || '24';

      // Create interface using netsh (Windows way)
      // Note: WireGuard on Windows creates interfaces automatically when config files are present
      // We'll use wg.exe to set the interface up manually
      
      // Set private key
      execSync(`"${this.paths.wg}" set "${this.interfaceName}" private-key -`, {
        input: this.keyPair.privateKey,
        encoding: 'utf-8',
        stdio: 'pipe',
      });

      // Set listen port
      execSync(`"${this.paths.wg}" set "${this.interfaceName}" listen-port ${config.wireguard.port}`, {
        stdio: 'pipe',
      });

      // Set address using netsh (Windows network configuration)
      // The interface name in Windows might be different (like "WireGuard Tunnel: higgsnode")
      // We need to find the actual interface name
      const interfaceNameWin = await this.findWindowsInterfaceName();
      
      if (interfaceNameWin) {
        // Set IP address on the interface
        execSync(`netsh interface ip set address "${interfaceNameWin}" static ${ip} 255.255.255.0`, {
          stdio: 'pipe',
        });
      }

      logger.info('WireGuard interface created and started on Windows');
    } catch (error: any) {
      // If interface creation fails, try to use the config file approach
      logger.warn('Direct interface creation failed, trying config file approach', { error });
      
      // On Windows, WireGuard GUI automatically picks up config files from
      // %APPDATA%\WireGuard\*.conf
      // The config file is already created in writeConfig()
      // We just need to verify it exists
      if (fs.existsSync(this.configPath)) {
        logger.info('WireGuard config file created. Interface should be available through WireGuard GUI.');
        logger.info('You may need to activate it manually in WireGuard GUI or restart WireGuard service.');
      } else {
        throw new WireGuardError(`Failed to create interface: ${error}`);
      }
    }
  }

  /**
   * Delete WireGuard interface on Windows
   */
  private async deleteWindowsInterface(): Promise<void> {
    try {
      // Find the actual Windows interface name
      const interfaceNameWin = await this.findWindowsInterfaceName();
      if (interfaceNameWin) {
        try {
          execSync(`netsh interface ip set address "${interfaceNameWin}" dhcp`, { stdio: 'pipe' });
          execSync(`netsh interface set interface "${interfaceNameWin}" admin=disable`, { stdio: 'pipe' });
          logger.debug('WireGuard Windows interface disabled', { interface: interfaceNameWin });
        } catch {
          // Interface might not exist or already disabled
        }
      }
      // Also try to remove using wg.exe
      try {
        execSync(`"${this.paths.wg}" syncconf "${this.interfaceName}" /dev/null`, { stdio: 'pipe' });
        logger.debug('WireGuard interface removed using wg.exe', { interface: this.interfaceName });
      } catch {
        // Interface might not exist
      }
    } catch (error) {
      logger.debug('Failed to delete WireGuard Windows interface (non-critical)', { error });
      // Don't throw, as interface might not exist
    }
  }

  /**
   * Find the actual Windows interface name for WireGuard
   * Windows uses names like "WireGuard Tunnel: higgsnode"
   */
  private async findWindowsInterfaceName(): Promise<string | null> {
    try {
      const output = execSync('netsh interface show interface', {
        encoding: 'utf-8',
        stdio: 'pipe',
      });

      const lines = output.split('\n');
      for (const line of lines) {
        if (line.includes('WireGuard') && line.includes(this.interfaceName)) {
          // Extract interface name (usually the last part before status)
          const parts = line.trim().split(/\s+/);
          if (parts.length > 0) {
            return parts[parts.length - 1]; // Usually the name is at the end
          }
        }
      }
    } catch {
      // Ignore errors
    }
    return null;
  }
}

