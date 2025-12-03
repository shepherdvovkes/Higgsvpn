import dotenv from 'dotenv';
import path from 'path';
import { defaultConfig } from './defaults';

dotenv.config();

export interface Config {
  bosonServer: {
    url: string;
    timeout: number;
    retryAttempts: number;
    retryDelay: number;
  };
  node: {
    id: string;
    publicKey: string;
    privateKey: string;
  };
  wireguard: {
    interfaceName: string;
    port: number;
    address: string;
    configPath: string;
  };
  heartbeat: {
    interval: number;
  };
  metrics: {
    collectionInterval: number;
  };
  logging: {
    level: string;
    file: string;
  };
  resources: {
    maxConnections: number;
    maxCpuUsage: number;
    maxMemoryUsage: number;
  };
  privacy?: {
    logTraffic: boolean;
    logDNS: boolean;
    logMetadata: boolean;
    anonymizeIPs: boolean;
    maxLogRetention: number;
  };
}

function getConfig(): Config {
  const config: Config = {
    bosonServer: {
      url: process.env.BOSON_SERVER_URL || defaultConfig.bosonServer.url,
      timeout: parseInt(process.env.BOSON_SERVER_TIMEOUT || '30000', 10),
      retryAttempts: parseInt(process.env.BOSON_SERVER_RETRY_ATTEMPTS || '3', 10),
      retryDelay: parseInt(process.env.BOSON_SERVER_RETRY_DELAY || '1000', 10),
    },
    node: {
      id: process.env.NODE_ID || defaultConfig.node.id,
      publicKey: process.env.NODE_PUBLIC_KEY || defaultConfig.node.publicKey,
      privateKey: process.env.NODE_PRIVATE_KEY || defaultConfig.node.privateKey,
    },
    wireguard: {
      interfaceName: process.env.WG_INTERFACE_NAME || defaultConfig.wireguard.interfaceName,
      port: parseInt(process.env.WG_PORT || defaultConfig.wireguard.port.toString(), 10),
      address: process.env.WG_ADDRESS || defaultConfig.wireguard.address,
      configPath: process.env.WG_CONFIG_PATH || defaultConfig.wireguard.configPath,
    },
    heartbeat: {
      interval: parseInt(process.env.HEARTBEAT_INTERVAL || defaultConfig.heartbeat.interval.toString(), 10),
    },
    metrics: {
      collectionInterval: parseInt(
        process.env.METRICS_COLLECTION_INTERVAL || defaultConfig.metrics.collectionInterval.toString(),
        10
      ),
    },
    logging: {
      level: process.env.LOG_LEVEL || defaultConfig.logging.level,
      file: process.env.LOG_FILE || defaultConfig.logging.file,
    },
    resources: {
      maxConnections: parseInt(process.env.MAX_CONNECTIONS || defaultConfig.resources.maxConnections.toString(), 10),
      maxCpuUsage: parseInt(process.env.MAX_CPU_USAGE || defaultConfig.resources.maxCpuUsage.toString(), 10),
      maxMemoryUsage: parseInt(
        process.env.MAX_MEMORY_USAGE || defaultConfig.resources.maxMemoryUsage.toString(),
        10
      ),
    },
    privacy: {
      logTraffic: process.env.LOG_TRAFFIC === 'true' || false,
      logDNS: process.env.LOG_DNS === 'true' || false,
      logMetadata: process.env.LOG_METADATA !== 'false', // Default true
      anonymizeIPs: process.env.ANONYMIZE_IPS !== 'false', // Default true
      maxLogRetention: parseInt(process.env.MAX_LOG_RETENTION_DAYS || '7', 10),
    },
  };

  // Validate required configuration
  if (!config.bosonServer.url) {
    throw new Error('BOSON_SERVER_URL is required');
  }

  return config;
}

export const config = getConfig();

