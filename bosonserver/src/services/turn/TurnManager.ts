import { TurnConfig } from '../../config/turn';
import { logger } from '../../utils/logger';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export class TurnManager {
  private configPath = '/etc/turnserver.conf';

  async getTurnServers(clientIp?: string) {
    return TurnConfig.getTurnServers(clientIp);
  }

  async getStunServers() {
    return TurnConfig.getStunServers();
  }

  async getIceServers() {
    return TurnConfig.getIceServers();
  }

  async updateTurnConfig(updates: {
    realm?: string;
    staticSecret?: string;
    listeningPort?: number;
  }): Promise<void> {
    try {
      let config = readFileSync(this.configPath, 'utf-8');

      if (updates.realm) {
        config = config.replace(/^realm=.*$/m, `realm=${updates.realm}`);
      }

      if (updates.staticSecret) {
        config = config.replace(/^static-auth-secret=.*$/m, `static-auth-secret=${updates.staticSecret}`);
      }

      if (updates.listeningPort) {
        config = config.replace(/^listening-port=.*$/m, `listening-port=${updates.listeningPort}`);
      }

      writeFileSync(this.configPath, config, 'utf-8');
      logger.info('TURN configuration updated', { updates });

      // Note: In production, you might want to restart coturn service
      // This would require supervisorctl or systemctl integration
    } catch (error) {
      logger.error('Failed to update TURN configuration', { error });
      throw error;
    }
  }

  async validateTurnConnection(): Promise<boolean> {
    try {
      // Simple validation - check if coturn process is running
      // In production, you might want to do an actual STUN/TURN test
      const { exec } = await import('child_process');
      return new Promise((resolve) => {
        exec('pgrep -f turnserver', (error: any) => {
          resolve(!error);
        });
      });
    } catch (error) {
      logger.error('Failed to validate TURN connection', { error });
      return false;
    }
  }
}

