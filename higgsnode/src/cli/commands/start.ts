import { logger } from '../../utils/logger';
import { checkWireGuardInstalled, requireAdmin } from '../../utils/platform';
import { NodeService } from '../../services/NodeService';

export async function startCommand(): Promise<void> {
  try {
    // Check if WireGuard is installed
    if (!checkWireGuardInstalled()) {
      console.error('Error: WireGuard is not installed or not found in PATH');
      console.error('Please install WireGuard before running HiggsNode');
      process.exit(1);
    }

    // Check if running with admin/root privileges
    if (requireAdmin()) {
      console.error('Error: This application requires administrator/root privileges');
      console.error('Please run with elevated privileges');
      process.exit(1);
    }

    console.log('Starting HiggsNode...');
    logger.info('Starting HiggsNode');

    const nodeService = new NodeService();
    await nodeService.start();

    // NodeService registers cleanup function via registerCleanup()
    // The cleanup handlers in index.ts will handle SIGTERM, SIGINT, uncaughtException, unhandledRejection
    // This ensures proper unregister from bosonserver on all shutdown scenarios
    
    // Keep process alive - cleanup will be handled by signal handlers in index.ts
  } catch (error) {
    console.error('Failed to start HiggsNode:', error);
    logger.error('Failed to start HiggsNode', { error });
    process.exit(1);
  }
}

