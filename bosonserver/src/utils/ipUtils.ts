import dns from 'dns';
import { promisify } from 'util';
import { logger } from './logger';
import { config } from '../config/config';

const lookup = promisify(dns.lookup);

// Cache for server public IP
let serverPublicIpCache: string | null = null;
let serverPublicIpCacheTime: number = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Check if an IP address is localhost or private
 */
export function isLocalhostOrPrivate(ip: string): boolean {
  if (!ip || ip === 'unknown') {
    return true;
  }

  // Check for localhost
  if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') {
    return true;
  }

  // Check for IPv4 private ranges
  if (ip.includes('.')) {
    const parts = ip.split('.');
    if (parts.length === 4) {
      const [a, b] = parts.map(Number);
      // 10.0.0.0/8
      if (a === 10) return true;
      // 172.16.0.0/12
      if (a === 172 && b >= 16 && b <= 31) return true;
      // 192.168.0.0/16
      if (a === 192 && b === 168) return true;
      // 169.254.0.0/16 (link-local)
      if (a === 169 && b === 254) return true;
    }
  }

  // Check for IPv6 private ranges
  if (ip.includes(':')) {
    // fc00::/7 (unique local)
    if (ip.startsWith('fc') || ip.startsWith('fd')) return true;
    // fe80::/10 (link-local)
    if (ip.startsWith('fe80')) return true;
  }

  return false;
}

/**
 * Get server's public IP by resolving hostname or using configured value
 */
export async function getServerPublicIp(): Promise<string | null> {
  // Check cache
  const now = Date.now();
  if (serverPublicIpCache && (now - serverPublicIpCacheTime) < CACHE_TTL) {
    return serverPublicIpCache;
  }

  try {
    // Try to get from environment variable first
    const envPublicIp = process.env.SERVER_PUBLIC_IP;
    if (envPublicIp && !isLocalhostOrPrivate(envPublicIp)) {
      serverPublicIpCache = envPublicIp;
      serverPublicIpCacheTime = now;
      return envPublicIp;
    }

    // Try to resolve hostname from request host or config
    const hostname = process.env.SERVER_HOSTNAME || 
                     process.env.HOSTNAME || 
                     (typeof config.server.host === 'string' && config.server.host !== '0.0.0.0' ? config.server.host : null);
    
    if (hostname && hostname !== 'localhost' && hostname !== '0.0.0.0') {
      try {
        const result = await lookup(hostname, { family: 4 });
        if (result && result.address && !isLocalhostOrPrivate(result.address)) {
          serverPublicIpCache = result.address;
          serverPublicIpCacheTime = now;
          logger.debug('Resolved server public IP from hostname', { hostname, ip: result.address });
          return result.address;
        }
      } catch (error) {
        logger.debug('Failed to resolve hostname', { hostname, error });
      }
    }

    // Try to get from Host header if available (but this requires a request context)
    // For now, return null and let the caller handle it
    return null;
  } catch (error) {
    logger.error('Failed to get server public IP', { error });
    return null;
  }
}

/**
 * Extract real IP from request, using server's public IP if connection is from localhost/private IP
 */
export async function getRealIp(req: any): Promise<string> {
  let ip: string | undefined;

  // Check for X-Forwarded-For header (when behind proxy/load balancer)
  const forwardedFor = req.headers?.['x-forwarded-for'];
  if (forwardedFor) {
    // X-Forwarded-For can contain multiple IPs, take the first one (original client)
    const ips = typeof forwardedFor === 'string' ? forwardedFor.split(',') : forwardedFor;
    ip = ips[0]?.trim();
  }
  
  // Check for X-Real-IP header
  if (!ip) {
    const realIp = req.headers?.['x-real-ip'];
    if (realIp && typeof realIp === 'string') {
      ip = realIp;
    }
  }
  
  // Fallback to req.ip (set by Express trust proxy) or socket remote address
  if (!ip) {
    ip = req.ip || req.socket?.remoteAddress;
  }

  // Try to get server public IP, using Host header from request if available
  let serverIp: string | null = null;
  try {
    // Try to resolve from Host header first (most accurate for same-host connections)
    const hostHeader = req.headers?.['host'];
    if (hostHeader) {
      const hostname = hostHeader.split(':')[0]; // Remove port if present
      if (hostname && hostname !== 'localhost' && hostname !== '0.0.0.0') {
        try {
          const result = await lookup(hostname, { family: 4 });
          if (result && result.address && !isLocalhostOrPrivate(result.address)) {
            serverIp = result.address;
            // Update cache
            serverPublicIpCache = serverIp;
            serverPublicIpCacheTime = Date.now();
            logger.debug('Resolved server public IP from Host header', { hostname, ip: serverIp });
          }
        } catch (error) {
          logger.debug('Failed to resolve Host header', { hostname, error });
        }
      }
    }
    
    // If Host header didn't work, try the cached or configured value
    if (!serverIp) {
      serverIp = await getServerPublicIp();
    }
  } catch (error) {
    logger.debug('Failed to get server public IP', { error });
  }

  if (!ip || ip === 'unknown') {
    // If we can't determine IP, try to use server's public IP
    return serverIp || 'unknown';
  }

  // If IP is localhost or private, use server's public IP instead
  if (isLocalhostOrPrivate(ip)) {
    if (serverIp) {
      logger.debug('Using server public IP instead of localhost/private IP', { 
        originalIp: ip, 
        serverIp 
      });
      return serverIp;
    }
    // If we can't get server IP, return the original (even if it's localhost)
    return ip;
  }

  return ip;
}

/**
 * Synchronous version for cases where async is not possible
 * Uses cached server IP or returns the IP as-is
 */
export function getRealIpSync(req: any): string {
  let ip: string | undefined;

  // Check for X-Forwarded-For header
  const forwardedFor = req.headers?.['x-forwarded-for'];
  if (forwardedFor) {
    const ips = typeof forwardedFor === 'string' ? forwardedFor.split(',') : forwardedFor;
    ip = ips[0]?.trim();
  }
  
  // Check for X-Real-IP header
  if (!ip) {
    const realIp = req.headers?.['x-real-ip'];
    if (realIp && typeof realIp === 'string') {
      ip = realIp;
    }
  }
  
  // Fallback to req.ip or socket remote address
  if (!ip) {
    ip = req.ip || req.socket?.remoteAddress;
  }

  if (!ip || ip === 'unknown') {
    // Use cached server IP if available
    return serverPublicIpCache || 'unknown';
  }

  // If IP is localhost or private, use cached server IP if available
  if (isLocalhostOrPrivate(ip)) {
    if (serverPublicIpCache) {
      return serverPublicIpCache;
    }
    // If no cache, return original IP
    return ip;
  }

  return ip;
}

