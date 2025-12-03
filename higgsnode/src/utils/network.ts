import { networkInterfaces } from 'os';

export interface NetworkInterface {
  name: string;
  address: string;
  family: 'IPv4' | 'IPv6';
}

export function getLocalIPv4(): string | null {
  const interfaces = networkInterfaces();
  
  for (const name of Object.keys(interfaces)) {
    const iface = interfaces[name];
    if (!iface) continue;

    for (const addr of iface) {
      // Skip internal (loopback) and non-IPv4 addresses
      if (addr.family === 'IPv4' && !addr.internal) {
        return addr.address;
      }
    }
  }

  return null;
}

export function getLocalIPv6(): string | null {
  const interfaces = networkInterfaces();
  
  for (const name of Object.keys(interfaces)) {
    const iface = interfaces[name];
    if (!iface) continue;

    for (const addr of iface) {
      // Skip internal (loopback) and non-IPv6 addresses
      if (addr.family === 'IPv6' && !addr.internal) {
        return addr.address;
      }
    }
  }

  return null;
}

export function getAllNetworkInterfaces(): NetworkInterface[] {
  const interfaces = networkInterfaces();
  const result: NetworkInterface[] = [];

  for (const name of Object.keys(interfaces)) {
    const iface = interfaces[name];
    if (!iface) continue;

    for (const addr of iface) {
      result.push({
        name,
        address: addr.address,
        family: addr.family === 'IPv4' ? 'IPv4' : 'IPv6',
      });
    }
  }

  return result;
}

export function isValidIP(ip: string): boolean {
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  const ipv6Regex = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;
  
  return ipv4Regex.test(ip) || ipv6Regex.test(ip);
}

export function isValidPort(port: number): boolean {
  return port > 0 && port <= 65535;
}

