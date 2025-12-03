import { logger } from '../../utils/logger';
import { config } from '../../config/config';
import { checkWireGuardInstalled } from '../../utils/platform';

export async function statusCommand(): Promise<void> {
  try {
    console.log('HiggsNode Status');
    console.log('================');
    console.log('');

    // Check WireGuard installation
    const wgInstalled = checkWireGuardInstalled();
    console.log(`WireGuard: ${wgInstalled ? 'Installed' : 'Not Installed'}`);
    console.log('');

    // Configuration info
    console.log('Configuration:');
    console.log(`  BosonServer URL: ${config.bosonServer.url}`);
    console.log(`  Node ID: ${config.node.id || 'Not set'}`);
    console.log(`  WireGuard Interface: ${config.wireguard.interfaceName}`);
    console.log(`  WireGuard Port: ${config.wireguard.port}`);
    console.log('');

    // TODO: Add actual status information
    // This would involve:
    // 1. Checking if node is registered
    // 2. Connection status
    // 3. Active sessions
    // 4. Resource usage

    console.log('Status: Not running');
  } catch (error) {
    console.error('Failed to get status:', error);
    logger.error('Failed to get status', { error });
    process.exit(1);
  }
}

