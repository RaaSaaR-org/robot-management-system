/**
 * @file app.ts
 * @description Express application configuration
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

// Structured logging & metrics
import { logger, requestIdMiddleware, httpLogger } from './utils/logger.js';
import { metricsMiddleware } from './middleware/metricsMiddleware.js';
import { metricsRoutes } from './routes/metrics.routes.js';
import { workerAuthMiddleware } from './middleware/workerAuth.middleware.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));
const startedAtMs = Date.now();
const startedAt = new Date(startedAtMs).toISOString();

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
import { datasetRoutes } from './routes/datasets.routes.js';
import { deploymentsRoutes } from './routes/deployments.routes.js';
import { skillsRoutes } from './routes/skills.routes.js';
import { embodimentsRoutes } from './routes/embodiments.routes.js';
import { teleoperationRoutes } from './routes/teleoperation.routes.js';
import { trainingDocsRoutes } from './routes/training-docs.routes.js';
import { curationRoutes } from './routes/curation.routes.js';
import { activeLearningRoutes } from './routes/active-learning.routes.js';
import { syntheticRoutes } from './routes/synthetic.routes.js';
import { syntheticJobsRoutes } from './routes/synthetic-jobs.routes.js';
import { federatedRoutes } from './routes/federated.routes.js';
import { aggregationRoutes } from './routes/aggregation.routes.js';
import { contributionsRoutes } from './routes/contributions.routes.js';
import { evaluationRoutes } from './routes/evaluation.routes.js';
import { securityRoutes } from './routes/security.routes.js';
import { updateRoutes } from './routes/update.routes.js';
import { settingsRoutes } from './routes/settings.routes.js';
import { uncertaintyRoutes } from './routes/uncertainty.routes.js';
import { isaacLabRoutes } from './routes/isaac-lab.routes.js';
import { simulationRoutes } from './routes/simulation.routes.js';
import { vlaSessionRoutes } from './routes/vla-session.routes.js';

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

// Rate limiting can be fully disabled for dev/testing via RATE_LIMIT_DISABLED=true
const rateLimitDisabled = process.env.RATE_LIMIT_DISABLED === 'true';

// General API rate limit: 100 req/min (prod), 5000 (dev)
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 100 : 5000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
  skip: (req) =>
    rateLimitDisabled || req.path === '/health' || req.path.startsWith('/api/compliance'),
});

// Strict rate limit for auth endpoints: 5 req/min per IP
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts, please try again later.' },
  skip: () => rateLimitDisabled,
});

/**
 * Create and configure Express application
 */
export function createApp(): Express {
  const app = express();

  // Trust proxy for rate limiting behind reverse proxy
  app.set('trust proxy', 1);

  // Security headers (CSP, X-Frame-Options, HSTS, etc.)
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'", ...getCorsOrigins()],
      },
    },
    // Allow cross-origin requests from the Tauri/React frontend
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }));

  // CORS - use environment variable or defaults
  app.use(cors({
    origin: getCorsOrigins(),
    credentials: true,
  }));

  // Request ID + structured logging
  app.use(requestIdMiddleware);
  app.use(httpLogger);

  // Prometheus metrics collection
  app.use(metricsMiddleware);

  // Rate limiting - apply to all API routes
  app.use('/api/', apiLimiter);

  // Body parsing
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Health check
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString(), version: pkg.version, startedAt, uptimeSeconds: Math.floor((Date.now() - startedAtMs) / 1000), nodeVersion: process.version, environment: process.env.NODE_ENV || 'development' });
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
  // Worker callback sub-routes get additional token-based auth
  app.use('/api/training/workers', authMiddleware, workerAuthMiddleware, trainingRoutes);
  app.use('/api/training', authMiddleware, trainingRoutes);

  // Storage routes (protected) - RustFS object storage
  app.use('/api/storage', authMiddleware, storageRoutes);

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

  // Synthetic data NATS job queue routes (protected) - TASK-068
  app.use('/api/synthetic-jobs', authMiddleware, syntheticJobsRoutes);

  // Secure aggregation routes (protected) - Masked gradient aggregation (TASK-071)
  // Registered before general federated routes so secure-aggregation endpoints take precedence
  app.use('/api/federated', authMiddleware, aggregationRoutes);

  // Federated learning routes (protected) - Fleet learning infrastructure
  app.use('/api/federated', authMiddleware, federatedRoutes);

  // Customer data contribution routes (protected) - Data contribution portal
  app.use('/api/contributions', authMiddleware, contributionsRoutes);

  // Evaluation routes (protected) - VLA model evaluation dashboard
  app.use('/api/evaluation', authMiddleware, evaluationRoutes);

  // Security routes (protected) - Device identity & certificate management (CRA Annex I)
  app.use('/api/security', authMiddleware, securityRoutes);

  // Secure OTA update routes (protected) - CRA Art. 13, MR Art. 10
  app.use('/api/updates', authMiddleware, updateRoutes);

  // User settings routes (protected) - TASK-014
  app.use('/api/settings', authMiddleware, settingsRoutes);

  // Uncertainty routes (protected) - TASK-073 Ensemble uncertainty for active learning
  app.use('/api/uncertainty', authMiddleware, uncertaintyRoutes);

  // Isaac Lab REST client routes (protected) - TASK-069 Synthetic data generation
  app.use('/api/isaac-lab', authMiddleware, isaacLabRoutes);

  // Simulation routes (protected) - TASK-081 MuJoCo/Isaac Lab policy testing
  app.use('/api/simulation', authMiddleware, simulationRoutes);

  // VLA session routes (protected) - TASK-077 VLA session compliance logging
  app.use('/api/robots', authMiddleware, vlaSessionRoutes);

  // Prometheus metrics (no auth — scraped by monitoring infra)
  app.use('/metrics', metricsRoutes);

  // Well-known routes (for A2A agent discovery)
  app.use('/.well-known/a2a', wellKnownRoutes);

  // Start robot health checks
  robotManager.startHealthChecks(30000);

  // Start task distributor (push model for task assignment)
  taskDistributor.start();

  // Initialize incident reporting services
  incidentService.initialize();
  notificationWorkflowService.initialize().catch((err) => {
    logger.error({ err }, '[App] Failed to initialize notification workflow service');
  });

  // Initialize approval workflow service (SLA monitoring, escalations)
  approvalWorkflowService.initialize();

  // 404 handler
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Error handler
  app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    logger.error({ err, reqId: (req as Record<string, unknown>).id }, 'Unhandled server error');
    res.status(500).json({
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  });

  return app;
}
