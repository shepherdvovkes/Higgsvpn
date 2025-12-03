import dotenv from 'dotenv';

dotenv.config();

export interface Config {
  server: {
    port: number;
    host: string;
    nodeEnv: string;
  };
  database: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
  };
  redis: {
    host: string;
    port: number;
    password?: string;
  };
  jwt: {
    secret: string;
    expiresIn: string;
  };
  turn: {
    realm: string;
    staticSecret: string;
    listeningPort: number;
  };
  logging: {
    level: string;
  };
  cors: {
    origin: string;
  };
  rateLimit: {
    windowMs: number;
    maxRequests: number;
  };
}

function getConfig(): Config {
  return {
    server: {
      port: parseInt(process.env.PORT || '3000', 10),
      host: process.env.HOST || '0.0.0.0',
      nodeEnv: process.env.NODE_ENV || 'production',
    },
  database: {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    database: process.env.POSTGRES_DB || 'bosonserver',
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || '',
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
  },
    jwt: {
      secret: process.env.JWT_SECRET || 'change-this-secret',
      expiresIn: process.env.JWT_EXPIRES_IN || '24h',
    },
    turn: {
      realm: process.env.TURN_REALM || 'bosonserver',
      staticSecret: process.env.TURN_STATIC_SECRET || 'change-this-secret',
      listeningPort: parseInt(process.env.TURN_LISTENING_PORT || '3478', 10),
    },
    logging: {
      level: process.env.LOG_LEVEL || 'info',
    },
    cors: {
      origin: process.env.CORS_ORIGIN || '*',
    },
    rateLimit: {
      windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
      maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
    },
  };
}

export const config = getConfig();

