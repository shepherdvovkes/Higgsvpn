import winston from 'winston';
import { config } from '../config/config';

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let msg = `${timestamp} [${level}]: ${message}`;
    if (Object.keys(meta).length > 0) {
      msg += ` ${JSON.stringify(meta)}`;
    }
    return msg;
  })
);

// Use local logs directory, fallback to /var/log/supervisor if running in Docker
const logDir = process.env.LOG_DIR || (process.env.NODE_ENV === 'production' && process.env.DOCKER ? '/var/log/supervisor' : './logs');
const errorLogPath = `${logDir}/bosonserver-error.log`;
const infoLogPath = `${logDir}/bosonserver.log`;

export const logger = winston.createLogger({
  level: config.logging.level,
  format: logFormat,
  defaultMeta: { service: 'bosonserver' },
  transports: [
    new winston.transports.File({ filename: errorLogPath, level: 'error' }),
    new winston.transports.File({ filename: infoLogPath }),
  ],
});

if (config.server.nodeEnv !== 'production') {
  logger.add(
    new winston.transports.Console({
      format: consoleFormat,
    })
  );
}

export default logger;

