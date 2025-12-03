import { logger } from './utils/logger';
import { config } from './config/config';
import { db } from './database/postgres';
import { redis } from './database/redis';
import { runMigrations } from './database/migrations/run-migrations';
import { ApiGateway } from './api/gateway';

let apiGateway: ApiGateway;

async function startServer(): Promise<void> {
  try {
    logger.info('Starting BosonServer...');
    logger.info(`Environment: ${config.server.nodeEnv}`);
    logger.info(`Server will start on ${config.server.host}:${config.server.port}`);

    // Initialize database connections
    await db.connect();
    await redis.connect();

    // Run migrations
    await runMigrations();

    // Initialize and start API gateway
    apiGateway = new ApiGateway();
    await apiGateway.start();

    logger.info('BosonServer started successfully');
  } catch (error) {
    logger.error('Failed to start BosonServer', { error });
    process.exit(1);
  }
}

// Graceful shutdown
async function shutdown(signal: string): Promise<void> {
  logger.info(`${signal} received, shutting down gracefully`);
  
  try {
    if (apiGateway) {
      await apiGateway.stop();
    }
    await redis.disconnect();
    await db.disconnect();
    logger.info('Shutdown complete');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown', { error });
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection', { reason, promise });
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', { error });
  process.exit(1);
});

startServer();

