/**
 * @file index.ts
 * @description A2A Server entry point
 */

import { createServer } from 'http';
import { createApp } from './app.js';
import { logger } from './utils/logger.js';
import { setupWebSocket } from './websocket/index.js';
import { connectDatabase, disconnectDatabase } from './database/index.js';
import { seedZones } from './database/seedZones.js';
import { seedDefaultTenant } from './database/seedTenant.js';
import { conversationManager } from './services/ConversationManager.js';
import { robotManager } from './services/RobotManager.js';
import { telemetryIngestionService } from './services/TelemetryIngestionService.js';
import { retentionCleanupJob } from './jobs/RetentionCleanupJob.js';
import { telemetryCleanupJob } from './jobs/telemetry-cleanup.js';
import { retentionPolicyService } from './services/RetentionPolicyService.js';
import { ropaService } from './services/RopaService.js';
import { providerDocumentationService } from './services/ProviderDocumentationService.js';
import { complianceTrackerService } from './services/ComplianceTrackerService.js';
import { natsClient, createStreams, createKVStores, initializeJobQueue } from './messaging/index.js';
import { trainingJobService } from './services/TrainingJobService.js';
import { datasetService } from './services/DatasetService.js';
import { datasetValidationWorker } from './workers/dataset-validation.worker.js';
import { trainingWorker } from './workers/training.worker.js';
import { syntheticDataWorker } from './workers/SyntheticDataWorker.js';
import { initializeRustFSClient } from './storage/index.js';
import { storageCleanupJob } from './jobs/storage-cleanup.js';
import { trainingOrchestrator } from './services/TrainingOrchestrator.js';
import { digitalTwinService } from './services/DigitalTwinService.js';
import { processSchedulerService } from './services/ProcessSchedulerService.js';
import { patrolSchedulerService } from './services/PatrolSchedulerService.js';
import { patrolPhotoCleanupJob } from './jobs/patrol-photo-cleanup.js';
import { MULTI_TENANCY_ENABLED } from './config/features.js';

const PORT = process.env.PORT || 3001;

async function main() {
  logger.info('Starting A2A Server...');

  // Multi-tenancy flag (TASK-155) — mirrors NATS/RustFS pattern so
  // single-tenant deployments see a clear "disabled" line at boot.
  if (MULTI_TENANCY_ENABLED) {
    logger.info('[MULTI_TENANCY] enabled (row-level isolation active)');
  } else {
    logger.info('[MULTI_TENANCY] disabled (single-tenant mode)');
  }

  // Connect to database
  await connectDatabase();

  // Seed DEFAULT tenant + backfill pilot models when multi-tenancy is on
  // (no-op when MULTI_TENANCY_ENABLED=false). Must run before any service
  // initialises its in-memory cache so cached reads see tenantId-stamped
  // rows from the start.
  await seedDefaultTenant();

  // Seed default zones if database is empty
  await seedZones();

  // Initialize managers (load cached data from database)
  await conversationManager.initialize();
  await robotManager.initialize();

  // Start telemetry ingestion (TASK-184): WS-client connections to each
  // registered robot agent's telemetry stream. Also hooks the registration/
  // unregistration events so new robots start streaming immediately.
  await telemetryIngestionService.initialize();

  // Initialize retention policies, RoPA, provider docs, and compliance tracker defaults
  await retentionPolicyService.initializeDefaults();
  await ropaService.initializeDefaults();
  await providerDocumentationService.initializeDefaults();
  await complianceTrackerService.initializeDefaults();

  // Start retention cleanup job (daily at 2 AM)
  retentionCleanupJob.startSchedule(24);

  // Start telemetry retention cleanup (daily at 4 AM, TELEMETRY_RETENTION_DAYS)
  telemetryCleanupJob.startSchedule(24);

  // Start process scheduler (TASK-143) — fires scheduled ProcessDefinitions
  processSchedulerService.start();

  // Start patrol scheduler (TASK-212) — fires cron-scheduled PatrolRoutes on
  // their robot (PATROL_SCHEDULER_ENABLED, default true) and the hourly photo
  // retention sweep (control 72 h, baseline/finding 30 d).
  patrolSchedulerService.start();
  patrolPhotoCleanupJob.startSchedule(1);

  // Initialize digital-twin build orchestrator (TASK-170) — reaps any scan
  // sessions left stuck in 'processing' from a prior run. No NATS dependency:
  // the sidecar claims sessions over the HTTP worker endpoints.
  await digitalTwinService.initialize();

  // Initialize NATS JetStream (optional - graceful degradation if not available)
  try {
    await natsClient.connect();
    if (natsClient.isConnected()) {
      const jsm = natsClient.getJetStreamManager();
      const js = natsClient.getJetStream();
      await createStreams(jsm);
      await createKVStores(js);
      await initializeJobQueue();
      await trainingJobService.initialize();
      await datasetService.initialize();
      await datasetValidationWorker.start();
      await trainingOrchestrator.initialize();
      // Legacy NATS training-worker stub — disabled in favour of the HTTP
      // polling worker (separate training-worker repo, see TASK-136). The stub was
      // prematurely transitioning pending jobs to 'running' which blocked
      // the external worker from claiming them. Set TRAINING_NATS_STUB=true
      // to re-enable (e.g. if no HTTP worker is available).
      if (process.env.TRAINING_NATS_STUB === 'true') {
        await trainingWorker.start();
      } else {
        logger.info('[TrainingWorker] NATS stub disabled (TRAINING_NATS_STUB!=true) — HTTP claim endpoint is primary');
      }
      await syntheticDataWorker.start();
      logger.info('[NATS] JetStream initialized with streams and KV stores');
    }
  } catch (error) {
    logger.warn({ err: error instanceof Error ? error.message : error }, '[NATS] Failed to initialize (training features disabled)');
  }

  // Initialize RustFS Object Storage (optional - graceful degradation if not available)
  try {
    await initializeRustFSClient();
    storageCleanupJob.startSchedule(24); // Daily at 3 AM
    logger.info('[RustFS] Object storage initialized');
  } catch (error) {
    logger.warn({ err: error instanceof Error ? error.message : error }, '[RustFS] Failed to initialize (storage features disabled)');
  }

  // Create Express app
  const app = createApp();

  // Create HTTP server
  const server = createServer(app);

  // Setup WebSocket
  setupWebSocket(server);

  // Start server
  server.listen(PORT, () => {
    logger.info(`A2A Server running on http://localhost:${PORT}`);
    logger.info(`WebSocket available at ws://localhost:${PORT}/api/a2a/ws`);
    logger.info(`Agent card at http://localhost:${PORT}/.well-known/a2a/agent_card.json`);
  });

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down...');
    processSchedulerService.stop();
    patrolSchedulerService.stop();
    patrolPhotoCleanupJob.stopSchedule();
    telemetryIngestionService.stopAll();
    retentionCleanupJob.stopSchedule();
    telemetryCleanupJob.stopSchedule();
    storageCleanupJob.stopSchedule();
    digitalTwinService.stopReaper();
    trainingJobService.stopAllWatchers();
    await syntheticDataWorker.stop();
    await trainingWorker.stop();
    await datasetValidationWorker.stop();
    await natsClient.close();
    await disconnectDatabase();
    server.close(() => {
      logger.info('Server closed');
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch(async (err) => {
  logger.error({ err }, 'Failed to start server');
  await disconnectDatabase();
  process.exit(1);
});
