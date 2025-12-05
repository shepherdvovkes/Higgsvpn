import * as dgram from 'dgram';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger';

export type NatType = 'FullCone' | 'RestrictedCone' | 'PortRestricted' | 'Symmetric';

export interface StunServer {
  host: string;
  port: number;
}

export interface StunResult {
  mappedAddress: string;
  mappedPort: number;
  natType: NatType;
}

// STUN message types
const STUN_METHOD_BINDING = 0x0001;
const STUN_CLASS_REQUEST = 0x0000;
const STUN_CLASS_RESPONSE = 0x0100;
const STUN_CLASS_ERROR = 0x0110;

// STUN attributes
const ATTR_MAPPED_ADDRESS = 0x0001;
const ATTR_XOR_MAPPED_ADDRESS = 0x0020;
const ATTR_RESPONSE_ORIGIN = 0x802b;
const ATTR_OTHER_ADDRESS = 0x802c;

interface StunMessage {
  type: number;
  length: number;
  transactionId: Buffer;
  attributes: Map<number, Buffer>;
}

export class StunClient extends EventEmitter {
  private socket: dgram.Socket | null = null;
  private pendingRequests: Map<string, (result: StunResult) => void> = new Map();
  private timeout = 5000;

  constructor() {
    super();
  }

  async discover(server: StunServer): Promise<StunResult> {
    return new Promise((resolve, reject) => {
      const socket = dgram.createSocket('udp4');
      this.socket = socket;

      const transactionId = this.generateTransactionId();
      const requestId = transactionId.toString('hex');

      const timeout = setTimeout(() => {
        socket.close();
        this.pendingRequests.delete(requestId);
        const timeoutError = new Error(`STUN request timeout after ${this.timeout}ms`);
        (timeoutError as any).code = 'ETIMEDOUT';
        reject(timeoutError);
      }, this.timeout);

      socket.on('message', (msg, rinfo) => {
        try {
          const response = this.parseStunMessage(msg);
          if (response && this.pendingRequests.has(requestId)) {
            clearTimeout(timeout);
            const result = this.extractMappedAddress(response);
            this.pendingRequests.get(requestId)?.(result);
            this.pendingRequests.delete(requestId);
            socket.close();
            resolve(result);
          }
        } catch (error) {
          clearTimeout(timeout);
          socket.close();
          this.pendingRequests.delete(requestId);
          reject(error);
        }
      });

      socket.on('error', (error: any) => {
        clearTimeout(timeout);
        socket.close();
        this.pendingRequests.delete(requestId);
        // Enhance error with more context
        const enhancedError = new Error(error?.message || 'STUN socket error');
        (enhancedError as any).code = error?.code || 'ESOCKET';
        (enhancedError as any).originalError = error;
        reject(enhancedError);
      });

      const request = this.createBindingRequest(transactionId);
      socket.send(request, server.port, server.host, (error) => {
        if (error) {
          clearTimeout(timeout);
          socket.close();
          this.pendingRequests.delete(requestId);
          reject(error);
        } else {
          this.pendingRequests.set(requestId, resolve);
        }
      });
    });
  }

  async detectNatType(server: StunServer): Promise<NatType> {
    try {
      // Simple NAT type detection
      // Full implementation would require multiple STUN servers and tests
      const result = await this.discover(server);
      
      // For now, return a default type
      // Full NAT type detection requires more complex logic with multiple tests
      return result.natType;
    } catch (error: any) {
      const errorMessage = error?.message || error?.code || String(error);
      logger.warn('NAT type detection failed (non-critical, using default)', { 
        error: errorMessage,
        server: `${server.host}:${server.port}`,
        code: error?.code,
        hint: 'This is expected if STUN servers are unreachable or blocked by firewall'
      });
      return 'Symmetric'; // Default to most restrictive
    }
  }

  private createBindingRequest(transactionId: Buffer): Buffer {
    const messageType = STUN_METHOD_BINDING | STUN_CLASS_REQUEST;
    const length = 0;

    const buffer = Buffer.alloc(20);
    buffer.writeUInt16BE(messageType, 0);
    buffer.writeUInt16BE(length, 2);
    transactionId.copy(buffer, 4);

    return buffer;
  }

  private parseStunMessage(buffer: Buffer): StunMessage | null {
    if (buffer.length < 20) {
      return null;
    }

    const type = buffer.readUInt16BE(0);
    const length = buffer.readUInt16BE(2);
    const transactionId = buffer.slice(4, 20);

    if (buffer.length < 20 + length) {
      return null;
    }

    const attributes = new Map<number, Buffer>();
    let offset = 20;

    while (offset < 20 + length) {
      if (offset + 4 > buffer.length) break;

      const attrType = buffer.readUInt16BE(offset);
      const attrLength = buffer.readUInt16BE(offset + 2);
      offset += 4;

      if (offset + attrLength > buffer.length) break;

      // Align to 4-byte boundary
      const padding = (4 - (attrLength % 4)) % 4;
      const attrValue = buffer.slice(offset, offset + attrLength);
      offset += attrLength + padding;

      attributes.set(attrType, attrValue);
    }

    return {
      type,
      length,
      transactionId,
      attributes,
    };
  }

  private extractMappedAddress(message: StunMessage): StunResult {
    // Try XOR-MAPPED-ADDRESS first (preferred)
    let addressAttr = message.attributes.get(ATTR_XOR_MAPPED_ADDRESS);
    if (!addressAttr) {
      addressAttr = message.attributes.get(ATTR_MAPPED_ADDRESS);
    }

    if (!addressAttr || addressAttr.length < 8) {
      throw new Error('Invalid STUN response: missing mapped address');
    }

    const family = addressAttr.readUInt8(1);
    const port = addressAttr.readUInt16BE(2);

    let address: string;
    if (family === 0x01) {
      // IPv4
      address = `${addressAttr.readUInt8(4)}.${addressAttr.readUInt8(5)}.${addressAttr.readUInt8(6)}.${addressAttr.readUInt8(7)}`;
    } else if (family === 0x02) {
      // IPv6
      address = addressAttr.slice(4, 20).toString('hex').match(/.{1,4}/g)?.join(':') || '';
    } else {
      throw new Error('Unsupported address family');
    }

    return {
      mappedAddress: address,
      mappedPort: port,
      natType: 'FullCone', // Simplified - full detection requires more tests
    };
  }

  private generateTransactionId(): Buffer {
    const id = Buffer.alloc(12);
    for (let i = 0; i < 12; i++) {
      id[i] = Math.floor(Math.random() * 256);
    }
    return id;
  }

  close(): void {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.pendingRequests.clear();
  }
}

