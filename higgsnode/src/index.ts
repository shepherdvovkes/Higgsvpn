import { startCommand } from './cli/commands/start';
import { logger } from './utils/logger';

let cleanupFunction: (() => Promise<void>) | null = null;
let isShuttingDown = false;

// Регистрация cleanup функции
export function registerCleanup(cleanup: () => Promise<void>) {
  cleanupFunction = cleanup;
}

async function gracefulShutdown(signal: string) {
  // Prevent multiple shutdown attempts
  if (isShuttingDown) {
    logger.warn('Shutdown already in progress, ignoring signal', { signal });
    return;
  }
  
  isShuttingDown = true;
  logger.info(`${signal} received, shutting down gracefully`);
  
  if (cleanupFunction) {
    try {
      // Set a timeout to force exit if cleanup takes too long
      const timeout = setTimeout(() => {
        logger.error('Cleanup timeout exceeded, forcing exit');
        process.exit(1);
      }, 10000); // 10 seconds timeout
      
      await cleanupFunction();
      clearTimeout(timeout);
      logger.info('Cleanup completed successfully');
    } catch (error) {
      logger.error('Error during cleanup', { error });
    }
  } else {
    logger.warn('No cleanup function registered');
  }
  
  process.exit(0);
}

// Handle graceful shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Обработка необработанных ошибок
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection', { reason, promise });
  gracefulShutdown('unhandledRejection');
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', { error });
  gracefulShutdown('uncaughtException');
});

// If running directly (not as CLI command), start the node
if (require.main === module) {
  startCommand().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export * from './services/NodeService';
export * from './managers/ConnectionManager';
export * from './managers/WireGuardManager';
export * from './collectors/MetricsCollector';
export * from './config/config';

