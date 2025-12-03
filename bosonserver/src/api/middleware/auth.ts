import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../../config/config';
import { UnauthorizedError } from '../../utils/errors';

export interface AuthRequest extends Request {
  user?: {
    nodeId?: string;
    clientId?: string;
    type: 'node' | 'client';
  };
}

export function authenticateToken(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedError('Missing or invalid authorization header');
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, config.jwt.secret) as any;

    req.user = {
      nodeId: decoded.nodeId,
      clientId: decoded.clientId,
      type: decoded.type,
    };

    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      next(new UnauthorizedError('Invalid token'));
    } else {
      next(error);
    }
  }
}

export function authenticateNode(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void {
  authenticateToken(req, res, () => {
    if (req.user?.type !== 'node') {
      next(new UnauthorizedError('Node authentication required'));
      return;
    }
    next();
  });
}

export function authenticateClient(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void {
  authenticateToken(req, res, () => {
    if (req.user?.type !== 'client') {
      next(new UnauthorizedError('Client authentication required'));
      return;
    }
    next();
  });
}

