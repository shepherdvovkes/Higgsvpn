#!/usr/bin/env node

import { ClientService } from './services/ClientService';
import { logger } from './utils/logger';
import { config } from './config/config';

async function main() {
  logger.info('Starting HiggsVPN Client', {
    serverUrl: config.serverUrl,
    clientId: config.clientId || 'generating...',
  });

  const client = new ClientService();

  // Setup event handlers
  client.on('connecting', () => {
    logger.info('Connecting to VPN...');
  });

  client.on('connected', (status) => {
    logger.info('Connected to VPN', status);
    console.log('\n✓ Connected to VPN');
    console.log(`  Node ID: ${status.nodeId}`);
    console.log(`  Route ID: ${status.routeId}`);
  });

  client.on('disconnected', () => {
    logger.info('Disconnected from VPN');
    console.log('\n✗ Disconnected from VPN');
  });

  client.on('error', (error) => {
    logger.error('Client error', { error });
    console.error('\n✗ Error:', error.message);
  });

  client.on('packet', (data) => {
    logger.debug('Packet received', { size: data?.length });
  });

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    logger.info('Received SIGINT, shutting down...');
    await client.disconnect();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM, shutting down...');
    await client.disconnect();
    process.exit(0);
  });

  // Connect to VPN
  try {
    await client.connect({
      minBandwidth: 10,
      maxLatency: 100,
    });
  } catch (error: any) {
    logger.error('Failed to connect', { error });
    console.error('Failed to connect:', error.message);
    process.exit(1);
  }
}

// Run if this is the main module
if (require.main === module) {
  main().catch((error) => {
    logger.error('Fatal error', { error });
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { ClientService } from './services/ClientService';
export { ApiClient } from './services/ApiClient';
export { WebSocketRelay } from './services/WebSocketRelay';

