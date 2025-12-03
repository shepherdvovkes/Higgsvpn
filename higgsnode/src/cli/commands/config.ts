import { Command } from 'commander';
import { logger } from '../../utils/logger';
import { config } from '../../config/config';
import fs from 'fs';
import path from 'path';
import { getConfigFilePath } from '../../utils/platform';

export function configCommand(program: Command): void {
  const configCmd = program
    .command('config')
    .description('Manage configuration');

  configCmd
    .command('get <key>')
    .description('Get configuration value')
    .action((key: string) => {
      try {
        const value = getConfigValue(key);
        if (value !== undefined) {
          console.log(value);
        } else {
          console.error(`Configuration key "${key}" not found`);
          process.exit(1);
        }
      } catch (error) {
        console.error('Failed to get configuration:', error);
        logger.error('Failed to get configuration', { error, key });
        process.exit(1);
      }
    });

  configCmd
    .command('set <key> <value>')
    .description('Set configuration value')
    .action((key: string, value: string) => {
      try {
        setConfigValue(key, value);
        console.log(`Configuration "${key}" set to "${value}"`);
        console.log('Note: Some changes may require restart to take effect');
      } catch (error) {
        console.error('Failed to set configuration:', error);
        logger.error('Failed to set configuration', { error, key, value });
        process.exit(1);
      }
    });

  configCmd
    .command('list')
    .description('List all configuration values')
    .action(() => {
      try {
        listConfig();
      } catch (error) {
        console.error('Failed to list configuration:', error);
        logger.error('Failed to list configuration', { error });
        process.exit(1);
      }
    });
}

function getConfigValue(key: string): string | undefined {
  const keyPath = key.split('.');
  let value: any = config;

  for (const part of keyPath) {
    if (value && typeof value === 'object' && part in value) {
      value = value[part];
    } else {
      return undefined;
    }
  }

  return typeof value === 'string' || typeof value === 'number' ? String(value) : JSON.stringify(value);
}

function setConfigValue(key: string, value: string): void {
  // This is a simplified implementation
  // In a real application, you would:
  // 1. Parse the key path
  // 2. Update the config object
  // 3. Save to a config file
  // 4. Reload configuration

  const configFile = getConfigFilePath('config.json');
  let configData: any = {};

  if (fs.existsSync(configFile)) {
    try {
      const content = fs.readFileSync(configFile, 'utf-8');
      configData = JSON.parse(content);
    } catch (error) {
      logger.warn('Failed to load existing config file', { error });
    }
  }

  // Set nested value
  const keyPath = key.split('.');
  let current = configData;
  for (let i = 0; i < keyPath.length - 1; i++) {
    if (!(keyPath[i] in current)) {
      current[keyPath[i]] = {};
    }
    current = current[keyPath[i]];
  }
  current[keyPath[keyPath.length - 1]] = value;

  // Ensure directory exists
  const configDir = path.dirname(configFile);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  // Save config file
  fs.writeFileSync(configFile, JSON.stringify(configData, null, 2));
  logger.info('Configuration updated', { key, value });
}

function listConfig(): void {
  console.log('Configuration:');
  console.log('==============');
  console.log('');
  console.log(`BosonServer URL: ${config.bosonServer.url}`);
  console.log(`Node ID: ${config.node.id || 'Not set'}`);
  console.log(`WireGuard Interface: ${config.wireguard.interfaceName}`);
  console.log(`WireGuard Port: ${config.wireguard.port}`);
  console.log(`WireGuard Address: ${config.wireguard.address}`);
  console.log(`Heartbeat Interval: ${config.heartbeat.interval}s`);
  console.log(`Metrics Collection Interval: ${config.metrics.collectionInterval}s`);
  console.log(`Max Connections: ${config.resources.maxConnections}`);
  console.log(`Max CPU Usage: ${config.resources.maxCpuUsage}%`);
  console.log(`Max Memory Usage: ${config.resources.maxMemoryUsage}%`);
}

