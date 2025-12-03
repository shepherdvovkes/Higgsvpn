import dotenv from 'dotenv';

dotenv.config();

export interface ClientConfig {
  serverUrl: string;
  clientId: string;
  wireguard: {
    interfaceName: string;
    address: string;
    port: number;
  };
  reconnectInterval: number;
  heartbeatInterval: number;
}

export const config: ClientConfig = {
  serverUrl: process.env.BOSONSERVER_URL || 'http://mail.s0me.uk:3003',
  clientId: process.env.CLIENT_ID || '',
  wireguard: {
    interfaceName: process.env.WG_INTERFACE || 'higgsvpn0',
    address: process.env.WG_ADDRESS || '10.0.0.2/24',
    port: parseInt(process.env.WG_PORT || '51821', 10),
  },
  reconnectInterval: parseInt(process.env.RECONNECT_INTERVAL || '5000', 10),
  heartbeatInterval: parseInt(process.env.HEARTBEAT_INTERVAL || '30000', 10),
};

