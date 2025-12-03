export class AppError extends Error {
  constructor(
    public message: string,
    public code?: string,
    public isOperational = true
  ) {
    super(message);
    Object.setPrototypeOf(this, AppError.prototype);
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR');
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

export class NetworkError extends AppError {
  constructor(message: string, public statusCode?: number) {
    super(message, 'NETWORK_ERROR');
    Object.setPrototypeOf(this, NetworkError.prototype);
  }
}

export class WireGuardError extends AppError {
  constructor(message: string) {
    super(message, 'WIREGUARD_ERROR');
    Object.setPrototypeOf(this, WireGuardError.prototype);
  }
}

export class ConfigurationError extends AppError {
  constructor(message: string) {
    super(message, 'CONFIGURATION_ERROR');
    Object.setPrototypeOf(this, ConfigurationError.prototype);
  }
}

export class ResourceError extends AppError {
  constructor(message: string) {
    super(message, 'RESOURCE_ERROR');
    Object.setPrototypeOf(this, ResourceError.prototype);
  }
}

