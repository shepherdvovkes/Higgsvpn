export interface Node {
  nodeId: string;
  publicKey: string;
  networkInfo: {
    ipv4: string;
    ipv6: string | null;
    natType: 'FullCone' | 'RestrictedCone' | 'PortRestricted' | 'Symmetric';
    stunMappedAddress: string | null;
    localPort: number;
    publicIp?: string; // Real/public IP from where node connects
  };
  capabilities: {
    maxConnections: number;
    bandwidth: {
      up: number;
      down: number;
    };
    routing: boolean;
    natting: boolean;
  };
  location: {
    country: string;
    region: string;
    coordinates: [number, number] | null;
  };
  status: 'online' | 'degraded' | 'offline';
  lastHeartbeat: Date;
  registeredAt: Date;
  sessionToken?: string;
  expiresAt?: Date;
}

export interface Route {
  id: string;
  type: 'direct' | 'relay' | 'cascade';
  path: string[];
  estimatedLatency: number;
  estimatedBandwidth: number;
  cost: number;
  priority: number;
  createdAt: Date;
  expiresAt: Date;
}

export interface Metric {
  nodeId: string;
  timestamp: Date;
  metrics: {
    network: {
      latency: number;
      jitter: number;
      packetLoss: number;
      bandwidth: {
        up: number;
        down: number;
      };
    };
    system: {
      cpuUsage: number;
      memoryUsage: number;
      diskUsage: number;
      loadAverage: number;
    };
    wireguard: {
      packets: {
        sent: number;
        received: number;
        errors: number;
      };
      bytes: {
        sent: number;
        received: number;
      };
    };
    connections: {
      active: number;
      total: number;
      failed: number;
    };
  };
}

export interface Session {
  sessionId: string;
  nodeId: string;
  clientId: string;
  routeId: string;
  status: 'active' | 'closed' | 'error';
  createdAt: Date;
  expiresAt: Date;
  relayEndpoint?: string;
}

