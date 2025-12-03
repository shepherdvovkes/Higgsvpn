export const defaultConfig = {
  bosonServer: {
    url: process.env.BOSON_SERVER_URL || 'http://mail.s0me.uk:3003',
    timeout: 30000,
    retryAttempts: 3,
    retryDelay: 1000,
  },
  node: {
    id: process.env.NODE_ID || '',
    publicKey: process.env.NODE_PUBLIC_KEY || '',
    privateKey: process.env.NODE_PRIVATE_KEY || '',
  },
  wireguard: {
    interfaceName: process.env.WG_INTERFACE_NAME || 'higgsnode',
    port: parseInt(process.env.WG_PORT || '51820', 10),
    address: process.env.WG_ADDRESS || '10.0.0.1/24',
    configPath: process.env.WG_CONFIG_PATH || '',
  },
  heartbeat: {
    interval: parseInt(process.env.HEARTBEAT_INTERVAL || '30', 10),
  },
  metrics: {
    collectionInterval: parseInt(process.env.METRICS_COLLECTION_INTERVAL || '10', 10),
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    file: process.env.LOG_FILE || 'logs/higgsnode.log',
  },
  resources: {
    maxConnections: parseInt(process.env.MAX_CONNECTIONS || '100', 10),
    maxCpuUsage: parseInt(process.env.MAX_CPU_USAGE || '80', 10),
    maxMemoryUsage: parseInt(process.env.MAX_MEMORY_USAGE || '80', 10),
  },
};

