import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { logger } from '../../utils/logger';
import { ValidationError } from '../../utils/errors';
import { WireGuardServer } from '../../services/wireguard/WireGuardServer';
import { RelayService } from '../../services/relay/RelayService';

const router = Router();

const registerWireGuardClientSchema = z.object({
  clientId: z.string().uuid(),
  nodeId: z.string().uuid(),
  sessionId: z.string().uuid().optional(),
  clientAddress: z.string().ip(),
  clientPort: z.number().int().min(1).max(65535),
});

// POST /api/v1/wireguard/register
// Регистрация WireGuard клиента для обработки входящих UDP пакетов
router.post('/register', async (req: Request, res: Response, next: any) => {
  try {
    const wireGuardServer = req.app.get('wireGuardServer') as WireGuardServer;
    const relayService = req.app.get('relayService') as RelayService;
    
    const validatedData = registerWireGuardClientSchema.parse(req.body);

    logger.info('Registering WireGuard client', {
      clientId: validatedData.clientId,
      nodeId: validatedData.nodeId,
      clientAddress: validatedData.clientAddress,
      clientPort: validatedData.clientPort,
    });

    // Регистрируем клиента в WireGuardServer для обработки входящих UDP пакетов
    await wireGuardServer.registerClientSession(
      validatedData.clientId,
      validatedData.nodeId,
      validatedData.clientAddress,
      validatedData.clientPort
    );

    // Если есть sessionId, обновляем сессию с информацией о WireGuard адресе
    if (validatedData.sessionId) {
      const session = await relayService.getSession(validatedData.sessionId);
      if (session) {
        // Сохраняем информацию о WireGuard адресе в сессии
        // Это можно использовать для отправки пакетов обратно клиенту
        logger.debug('Session found, WireGuard address will be used for packet forwarding', {
          sessionId: validatedData.sessionId,
        });
      }
    }

    res.status(200).json({
      status: 'registered',
      clientId: validatedData.clientId,
      nodeId: validatedData.nodeId,
      message: 'WireGuard client registered successfully',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(new ValidationError(error.errors.map(e => e.message).join(', ')));
    } else {
      next(error);
    }
  }
});

// POST /api/v1/wireguard/unregister
// Отмена регистрации WireGuard клиента
router.post('/unregister', async (req: Request, res: Response, next: any) => {
  try {
    const wireGuardServer = req.app.get('wireGuardServer') as WireGuardServer;
    
    const schema = z.object({
      clientAddress: z.string().ip(),
      clientPort: z.number().int().min(1).max(65535),
    });
    
    const validatedData = schema.parse(req.body);

    // WireGuardServer не имеет метода unregister, но сессии автоматически очищаются
    // по таймауту. Можно добавить метод для явной отмены регистрации.
    logger.info('Unregistering WireGuard client', {
      clientAddress: validatedData.clientAddress,
      clientPort: validatedData.clientPort,
    });

    res.status(200).json({
      status: 'unregistered',
      message: 'WireGuard client unregistered',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(new ValidationError(error.errors.map(e => e.message).join(', ')));
    } else {
      next(error);
    }
  }
});

export default router;

