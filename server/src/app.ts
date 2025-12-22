/**
 * @file app.ts
 * @description Express application configuration
 */

import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';

// Import routes
import { conversationRoutes } from './routes/conversation.routes.js';
import { messageRoutes } from './routes/message.routes.js';
import { taskRoutes } from './routes/task.routes.js';
import { agentRoutes } from './routes/agent.routes.js';
import { robotRoutes } from './routes/robot.routes.js';
import { wellKnownRoutes } from './routes/wellknown.routes.js';

// Import services
import { robotManager } from './services/RobotManager.js';

/**
 * Create and configure Express application
 */
export function createApp(): Express {
  const app = express();

  // Middleware
  app.use(cors({
    origin: ['http://localhost:1420', 'http://localhost:5173', 'http://localhost:3000'],
    credentials: true,
  }));
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Request logging (development)
  app.use((req: Request, _res: Response, next: NextFunction) => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
    next();
  });

  // Health check
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // API Routes
  app.use('/api/a2a/conversation', conversationRoutes);
  app.use('/api/a2a/message', messageRoutes);
  app.use('/api/a2a/task', taskRoutes);
  app.use('/api/a2a/agent', agentRoutes);

  // Robot routes
  app.use('/api/robots', robotRoutes);

  // Well-known routes (for A2A agent discovery)
  app.use('/.well-known/a2a', wellKnownRoutes);

  // Start robot health checks
  robotManager.startHealthChecks(30000);

  // 404 handler
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Server error:', err);
    res.status(500).json({
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  });

  return app;
}
