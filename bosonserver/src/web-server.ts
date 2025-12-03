import express, { Express, Request, Response } from 'express';
import http from 'http';
import path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { logger } from './utils/logger';

const WEB_PORT = parseInt(process.env.WEB_PORT || '3030', 10);
const API_URL = process.env.BOSON_SERVER_URL || 'http://localhost:3003';

export class WebServer {
  private app: Express;
  private server: http.Server;
  private dashboardWsServer!: WebSocketServer;
  private dashboardClients: Set<WebSocket> = new Set();

  constructor() {
    this.app = express();
    this.server = http.createServer(this.app);
    this.setupRoutes();
    this.setupDashboardWebSocket();
  }

  private setupRoutes(): void {
    // Body parser for JSON
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    // Serve static files from public directory
    const publicPath = path.join(__dirname, '../public');
    this.app.use(express.static(publicPath));

    // Proxy API requests to main server
    this.app.use('/api', async (req: Request, res: Response) => {
      try {
        const axios = (await import('axios')).default;
        const targetUrl = `${API_URL}${req.originalUrl}`;
        
        const response = await axios({
          method: req.method,
          url: targetUrl,
          headers: {
            'Content-Type': 'application/json',
          },
          data: req.method !== 'GET' && req.method !== 'HEAD' ? req.body : undefined,
          validateStatus: () => true, // Don't throw on any status
        });

        res.status(response.status).json(response.data);
      } catch (error: any) {
        logger.error('API proxy error', { error: error.message });
        res.status(500).json({ error: 'Failed to proxy request' });
      }
    });

    // Fallback to index.html for SPA routing
    this.app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.join(publicPath, 'index.html'));
    });
  }

  private setupDashboardWebSocket(): void {
    this.dashboardWsServer = new WebSocketServer({
      server: this.server,
      path: '/dashboard',
    });

    this.dashboardWsServer.on('connection', (ws: WebSocket) => {
      this.dashboardClients.add(ws);
      logger.info('Dashboard WebSocket client connected', { count: this.dashboardClients.size });

      // Send initial connection confirmation
      ws.send(JSON.stringify({
        type: 'control',
        action: 'connected',
      }));

      // Setup heartbeat
      const heartbeatInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'heartbeat',
            timestamp: Date.now(),
          }));
        } else {
          clearInterval(heartbeatInterval);
        }
      }, 30000);

      ws.on('close', () => {
        this.dashboardClients.delete(ws);
        clearInterval(heartbeatInterval);
        logger.info('Dashboard WebSocket client disconnected', { count: this.dashboardClients.size });
      });

      ws.on('error', (error) => {
        logger.error('Dashboard WebSocket error', { error });
        this.dashboardClients.delete(ws);
        clearInterval(heartbeatInterval);
      });
    });

    // Poll API for client updates and broadcast to dashboard clients
    setInterval(async () => {
      if (this.dashboardClients.size === 0) return;

      try {
        const axios = (await import('axios')).default;
        const response = await axios.get(`${API_URL}/api/v1/clients`, {
          validateStatus: () => true,
        });

        if (response.status === 200) {
          const message = JSON.stringify({
            type: 'clients-update',
            data: response.data,
          });

          // Broadcast to all connected clients
          this.dashboardClients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(message);
            }
          });
        }
      } catch (error: any) {
        logger.error('Failed to fetch clients for dashboard broadcast', { error: error.message });
      }
    }, 5000); // Update every 5 seconds
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.listen(WEB_PORT, '0.0.0.0', () => {
        logger.info(`Web server started on http://0.0.0.0:${WEB_PORT}`);
        resolve();
      });

      this.server.on('error', (error) => {
        logger.error('Web server error', { error });
        reject(error);
      });
    });
  }

  async stop(): Promise<void> {
    // Close all dashboard WebSocket connections
    this.dashboardClients.forEach((client) => {
      client.close();
    });
    this.dashboardClients.clear();

    // Close WebSocket server
    if (this.dashboardWsServer) {
      this.dashboardWsServer.close();
    }

    return new Promise((resolve) => {
      this.server.close(() => {
        logger.info('Web server stopped');
        resolve();
      });
    });
  }
}

