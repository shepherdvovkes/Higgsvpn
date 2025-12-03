import { config } from './config';
import crypto from 'crypto';

export interface TurnServerConfig {
  host: string;
  port: number;
  realm: string;
  username: string;
  password: string;
  ttl: number; // Time to live in seconds
}

export class TurnConfig {
  private static generateTemporaryCredentials(realm: string, secret: string, ttl: number = 3600): {
    username: string;
    password: string;
  } {
    const timestamp = Math.floor(Date.now() / 1000) + ttl;
    const username = `${timestamp}:${crypto.randomBytes(8).toString('hex')}`;
    
    // Generate password using HMAC-SHA1 (coturn default)
    const hmac = crypto.createHmac('sha1', secret);
    hmac.update(username);
    const password = hmac.digest('base64');

    return { username, password };
  }

  static getTurnServers(clientIp?: string): TurnServerConfig[] {
    const host = process.env.TURN_HOST || config.server.host;
    const port = config.turn.listeningPort;
    const realm = config.turn.realm;
    const secret = config.turn.staticSecret;
    const ttl = 3600; // 1 hour

    const credentials = this.generateTemporaryCredentials(realm, secret, ttl);

    return [
      {
        host,
        port,
        realm,
        username: credentials.username,
        password: credentials.password,
        ttl,
      },
    ];
  }

  static getStunServers(): Array<{ host: string; port: number }> {
    const host = process.env.STUN_HOST || config.server.host;
    const port = config.turn.listeningPort;

    return [
      {
        host,
        port,
      },
    ];
  }

  static getIceServers(): Array<{
    urls: string | string[];
    username?: string;
    credential?: string;
  }> {
    const turnServers = this.getTurnServers();
    const stunServers = this.getStunServers();

    const iceServers: Array<{
      urls: string | string[];
      username?: string;
      credential?: string;
    }> = [];

    // Add STUN servers
    for (const stun of stunServers) {
      iceServers.push({
        urls: `stun:${stun.host}:${stun.port}`,
      });
    }

    // Add TURN servers
    for (const turn of turnServers) {
      iceServers.push({
        urls: [`turn:${turn.host}:${turn.port}`, `turns:${turn.host}:${turn.port}`],
        username: turn.username,
        credential: turn.password,
      });
    }

    return iceServers;
  }
}

