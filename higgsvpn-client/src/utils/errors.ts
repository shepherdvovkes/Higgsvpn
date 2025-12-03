export class ClientError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
    this.name = 'ClientError';
  }
}

export class ConnectionError extends ClientError {
  constructor(message: string) {
    super(message, 'CONNECTION_ERROR');
    this.name = 'ConnectionError';
  }
}

export class RouteError extends ClientError {
  constructor(message: string) {
    super(message, 'ROUTE_ERROR');
    this.name = 'RouteError';
  }
}

export class WireGuardError extends ClientError {
  constructor(message: string) {
    super(message, 'WIREGUARD_ERROR');
    this.name = 'WireGuardError';
  }
}

