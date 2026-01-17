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
import { complianceLogRoutes } from './routes/compliance-log.routes.js';
import { retentionRoutes } from './routes/retention.routes.js';
import { legalHoldRoutes } from './routes/legal-hold.routes.js';
import { ropaRoutes } from './routes/ropa.routes.js';
import { providerDocsRoutes } from './routes/provider-docs.routes.js';
import { gdprRoutes } from './routes/gdpr.routes.js';
import { incidentRoutes, templateRoutes } from './routes/incident.routes.js';
import { oversightRoutes } from './routes/oversight.routes.js';
import { approvalRoutes } from './routes/approval.routes.js';
import { complianceTrackerRoutes } from './routes/compliance-tracker.routes.js';
import { trainingRoutes } from './routes/training.routes.js';
import { storageRoutes } from './routes/storage.routes.js';
import { modelsRoutes } from './routes/models.routes.js';
import { datasetRoutes } from './routes/datasets.routes.js';
import { deploymentsRoutes } from './routes/deployments.routes.js';
import { skillsRoutes } from './routes/skills.routes.js';
import { embodimentsRoutes } from './routes/embodiments.routes.js';
import { teleoperationRoutes } from './routes/teleoperation.routes.js';
import { trainingDocsRoutes } from './routes/training-docs.routes.js';
import { curationRoutes } from './routes/curation.routes.js';
import { activeLearningRoutes } from './routes/active-learning.routes.js';
import { syntheticRoutes } from './routes/synthetic.routes.js';
import { federatedRoutes } from './routes/federated.routes.js';
import { contributionsRoutes } from './routes/contributions.routes.js';

// Import middleware
import { authMiddleware } from './middleware/auth.middleware.js';

// Import services
import { robotManager } from './services/RobotManager.js';
import { taskDistributor } from './services/TaskDistributor.js';
import { incidentService } from './services/IncidentService.js';
import { notificationWorkflowService } from './services/NotificationWorkflowService.js';
import { approvalWorkflowService } from './services/ApprovalWorkflowService.js';

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

  // Compliance logging routes (protected) - EU AI Act Art. 12, GDPR Art. 30
  app.use('/api/compliance', authMiddleware, complianceLogRoutes);

  // Retention policy routes (protected) - Log retention management
  app.use('/api/compliance/retention', authMiddleware, retentionRoutes);

  // Legal hold routes (protected) - Prevent deletion during investigations
  app.use('/api/compliance/legal-holds', authMiddleware, legalHoldRoutes);

  // RoPA routes (protected) - GDPR Article 30 Records of Processing Activities
  app.use('/api/compliance/ropa', authMiddleware, ropaRoutes);

  // Provider documentation routes (protected) - AI provider transparency docs
  app.use('/api/compliance/providers', authMiddleware, providerDocsRoutes);

  // Compliance tracker routes (protected) - Dashboard, deadlines, gaps, training, inspections
  app.use('/api/compliance/tracker', authMiddleware, complianceTrackerRoutes);

  // GDPR rights self-service routes (protected) - Articles 15-22
  app.use('/api/gdpr', authMiddleware, gdprRoutes);

  // Incident reporting routes (protected) - EU AI Act Art. 73, GDPR Art. 33-34, NIS2, CRA
  app.use('/api/incidents', authMiddleware, incidentRoutes);

  // Notification template routes (protected)
  app.use('/api/notification-templates', authMiddleware, templateRoutes);

  // Human oversight routes (protected) - EU AI Act Art. 14
  app.use('/api/oversight', authMiddleware, oversightRoutes);

  // Human approval workflow routes (protected) - GDPR Art. 22, AI Act Art. 14
  app.use('/api/approvals', authMiddleware, approvalRoutes);

  // Training job routes (protected) - VLA model training management
  app.use('/api/training', authMiddleware, trainingRoutes);

  // Storage routes (protected) - RustFS object storage
  app.use('/api/storage', authMiddleware, storageRoutes);

  // Models routes (protected) - MLflow model registry
  app.use('/api/models', authMiddleware, modelsRoutes);

  // Dataset routes (protected) - VLA training dataset management
  app.use('/api/datasets', authMiddleware, datasetRoutes);

  // Deployment routes (protected) - VLA model fleet deployment
  app.use('/api/deployments', authMiddleware, deploymentsRoutes);

  // Skills routes (protected) - VLA skill library management
  app.use('/api/skills', authMiddleware, skillsRoutes);

  // Embodiments routes (protected) - VLA embodiment configuration management
  app.use('/api/embodiments', authMiddleware, embodimentsRoutes);

  // Teleoperation routes (protected) - VLA data collection via teleoperation
  app.use('/api/teleoperation', authMiddleware, teleoperationRoutes);

  // Training data documentation routes (protected) - EU AI Act GPAI compliance
  app.use('/api/training-docs', authMiddleware, trainingDocsRoutes);

  // Data curation & augmentation routes (protected) - VLA training data optimization
  app.use('/api/curation', authMiddleware, curationRoutes);

  // Active learning routes (protected) - Data collection prioritization
  app.use('/api/active-learning', authMiddleware, activeLearningRoutes);

  // Synthetic data generation routes (protected) - Isaac Lab integration
  app.use('/api/synthetic', authMiddleware, syntheticRoutes);

  // Federated learning routes (protected) - Fleet learning infrastructure
  app.use('/api/federated', authMiddleware, federatedRoutes);

  // Customer data contribution routes (protected) - Data contribution portal
  app.use('/api/contributions', authMiddleware, contributionsRoutes);

  // Well-known routes (for A2A agent discovery)
  app.use('/.well-known/a2a', wellKnownRoutes);

  // Start robot health checks
  robotManager.startHealthChecks(30000);

  // Start task distributor (push model for task assignment)
  taskDistributor.start();

  // Initialize incident reporting services
  incidentService.initialize();
  notificationWorkflowService.initialize().catch((err) => {
    console.error('[App] Failed to initialize notification workflow service:', err);
  });

  // Initialize approval workflow service (SLA monitoring, escalations)
  approvalWorkflowService.initialize();

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
