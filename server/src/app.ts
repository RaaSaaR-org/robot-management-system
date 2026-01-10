/**
 * @file app.ts
 * @description Express application configuration
 */

import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';

// Import routes
import { authRoutes } from './routes/auth.routes.js';
import { conversationRoutes } from './routes/conversation.routes.js';
import { messageRoutes } from './routes/message.routes.js';
import { taskRoutes } from './routes/task.routes.js';
import { agentRoutes } from './routes/agent.routes.js';
import { robotRoutes } from './routes/robot.routes.js';
import { wellKnownRoutes } from './routes/wellknown.routes.js';
import { alertRoutes } from './routes/alert.routes.js';
import { zoneRoutes } from './routes/zone.routes.js';
import { commandRoutes } from './routes/command.routes.js';
import { processRoutes } from './routes/process.routes.js';
import { safetyRoutes } from './routes/safety.routes.js';
import { explainabilityRoutes } from './routes/explainability.routes.js';

// Import middleware
import { authMiddleware } from './middleware/auth.middleware.js';

// Import services
import { robotManager } from './services/RobotManager.js';
import { taskDistributor } from './services/TaskDistributor.js';

// Default CORS origins for development
const DEFAULT_CORS_ORIGINS = ['http://localhost:1420', 'http://localhost:5173', 'http://localhost:3000'];

// Parse CORS origins from environment variable (comma-separated)
function getCorsOrigins(): string[] {
  const envOrigins = process.env.CORS_ORIGINS;
  if (envOrigins) {
    return envOrigins.split(',').map((origin) => origin.trim()).filter(Boolean);
  }
  return DEFAULT_CORS_ORIGINS;
}

// Rate limiting configuration
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
  skip: (req) => req.path === '/health', // Skip health checks
});

// Stricter rate limit for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // limit each IP to 20 auth requests per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts, please try again later.' },
});

/**
 * Create and configure Express application
 */
export function createApp(): Express {
  const app = express();

  // Trust proxy for rate limiting behind reverse proxy
  app.set('trust proxy', 1);

  // CORS - use environment variable or defaults
  app.use(cors({
    origin: getCorsOrigins(),
    credentials: true,
  }));

  // Rate limiting - apply to all API routes
  app.use('/api/', apiLimiter);

  // Body parsing
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

  // Auth Routes (public) - with stricter rate limiting
  app.use('/api/auth', authLimiter, authRoutes);

  // Protected API Routes
  app.use('/api/a2a/conversation', authMiddleware, conversationRoutes);
  app.use('/api/a2a/message', authMiddleware, messageRoutes);
  app.use('/api/a2a/task', authMiddleware, taskRoutes);
  app.use('/api/a2a/agent', authMiddleware, agentRoutes);

  // Robot routes (protected)
  app.use('/api/robots', authMiddleware, robotRoutes);

  // Alert routes (protected)
  app.use('/api/alerts', authMiddleware, alertRoutes);

  // Zone routes (protected)
  app.use('/api/zones', authMiddleware, zoneRoutes);

  // Command routes (protected)
  app.use('/api/command', authMiddleware, commandRoutes);

  // Process routes (protected) - workflow management
  app.use('/api/processes', authMiddleware, processRoutes);

  // Safety routes (protected) - E-stop and fleet safety
  app.use('/api/safety', authMiddleware, safetyRoutes);

  // Explainability routes (protected) - AI transparency (EU AI Act)
  app.use('/api/explainability', authMiddleware, explainabilityRoutes);

  // Well-known routes (for A2A agent discovery)
  app.use('/.well-known/a2a', wellKnownRoutes);

  // Start robot health checks
  robotManager.startHealthChecks(30000);

  // Start task distributor (push model for task assignment)
  taskDistributor.start();

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
