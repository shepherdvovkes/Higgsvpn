import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { logger } from '../../utils/logger';
import { ValidationError } from '../../utils/errors';
import { RelayService } from '../../services/relay/RelayService';
import { WireGuardServer } from '../../services/wireguard/WireGuardServer';

const router = Router();

const packetSchema = z.object({
  clientId: z.string().uuid(),
  nodeId: z.string().uuid().optional(),
  sessionId: z.string().uuid().optional(),
  packet: z.string(), // base64 encoded
  timestamp: z.number().optional(),
});

// POST /api/v1/packets - Receive packet from node (node-to-client)
router.post('/', async (req: Request, res: Response, next: any) => {
  try {
    const wireGuardServer = req.app.get('wireGuardServer') as WireGuardServer;
    const relayService = req.app.get('relayService') as RelayService;
    
    const validatedData = packetSchema.parse(req.body);
    const packet = Buffer.from(validatedData.packet, 'base64');

    logger.debug('Packet received from node', {
      clientId: validatedData.clientId,
      nodeId: validatedData.nodeId,
      size: packet.length,
    });

    // Get client session to find client address
    if (validatedData.sessionId) {
      const session = await relayService.getSession(validatedData.sessionId);
      if (session) {
        // Try to send via WebSocket relay first (for higgsvpn-client)
        const sent = await relayService.sendToSession(validatedData.sessionId, packet);
        if (!sent) {
          // If WebSocket relay failed, try WireGuard UDP if client is registered
          const wgSent = await wireGuardServer.sendPacketToClientById(validatedData.clientId, packet);
          if (!wgSent) {
            logger.warn('Failed to send packet to client via both WebSocket and WireGuard', { 
              sessionId: validatedData.sessionId,
              clientId: validatedData.clientId,
            });
          } else {
            logger.debug('Packet sent to client via WireGuard UDP', {
              clientId: validatedData.clientId,
            });
          }
        }
      } else {
        // No session found, try direct WireGuard UDP by clientId
        const wgSent = await wireGuardServer.sendPacketToClientById(validatedData.clientId, packet);
        if (!wgSent) {
          logger.warn('Failed to send packet to client: no session and no WireGuard registration', {
            clientId: validatedData.clientId,
            sessionId: validatedData.sessionId,
          });
        }
      }
    } else if (validatedData.clientId) {
      // No sessionId, try direct WireGuard UDP by clientId
      const wgSent = await wireGuardServer.sendPacketToClientById(validatedData.clientId, packet);
      if (!wgSent) {
        logger.warn('Failed to send packet to client: no WireGuard registration', {
          clientId: validatedData.clientId,
        });
      }
    }

    res.status(200).json({ status: 'ok' });
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(new ValidationError(error.errors.map(e => e.message).join(', ')));
    } else {
      next(error);
    }
  }
});

// POST /api/v1/packets/from-client - Receive packet from client (client-to-node)
// This is called internally by WireGuardServer
router.post('/from-client', async (req: Request, res: Response, next: any) => {
  try {
    const relayService = req.app.get('relayService') as RelayService;
    
    const validatedData = packetSchema.parse(req.body);
    const packet = Buffer.from(validatedData.packet, 'base64');

    logger.debug('Packet received from client', {
      clientId: validatedData.clientId,
      nodeId: validatedData.nodeId,
      size: packet.length,
    });

    // Forward packet to node via WebSocket relay or direct API
    if (validatedData.sessionId && validatedData.nodeId) {
      // Use WebSocket relay
      const sent = await relayService.sendToSession(validatedData.sessionId, packet);
      if (!sent) {
        logger.warn('Failed to send packet to node via relay', { 
          sessionId: validatedData.sessionId,
          nodeId: validatedData.nodeId,
        });
      }
    }

    res.status(200).json({ status: 'ok' });
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(new ValidationError(error.errors.map(e => e.message).join(', ')));
    } else {
      next(error);
    }
  }
});

export default router;



