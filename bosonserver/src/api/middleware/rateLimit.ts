import rateLimit from 'express-rate-limit';
import { config } from '../../config/config';

export const apiRateLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxRequests,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for routes that have their own specific limiters
    const path = req.originalUrl || req.path;
    
    // Skip for node-specific endpoints (they use nodeRateLimiter)
    // Path will be like /api/v1/nodes/register or /api/v1/nodes/:nodeId/heartbeat
    if (path.includes('/api/v1/nodes/register') || 
        (path.includes('/api/v1/nodes/') && path.includes('/heartbeat')) ||
        path.includes('/api/v1/turn/stun') ||
        path.includes('/api/v1/metrics')) {
      return true;
    }
    
    // Skip for routing endpoint (clients need to request routes)
    if (path.includes('/api/v1/routing/request')) {
      return true;
    }
    
    // Skip for dashboard endpoints (they use dashboardRateLimiter)
    // GET requests to /api/v1/nodes or /api/v1/clients
    if ((path === '/api/v1/nodes' || path === '/api/v1/clients') && req.method === 'GET') {
      return true;
    }
    
    // Skip for WebSocket upgrade requests
    return req.headers.upgrade === 'websocket';
  },
});

// More lenient rate limiter for read-only dashboard endpoints
export const dashboardRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // 60 requests per minute (1 per second) - enough for dashboard polling
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for WebSocket upgrade requests
    return req.headers.upgrade === 'websocket';
  },
});

export const strictRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  message: 'Too many requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Либеральный rate limiter для heartbeat и metrics
// Ноды отправляют heartbeat каждые 30 секунд и metrics каждые 10 секунд
export const nodeRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120, // Достаточно для heartbeat (2 в минуту) и metrics (6 в минуту) с запасом
  message: 'Too many requests from this node, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for WebSocket upgrade requests
    return req.headers.upgrade === 'websocket';
  },
});

