/**
 * @file index.ts
 * @description A2A Server entry point
 */

import { createServer } from 'http';
import { createApp } from './app.js';
import { setupWebSocket } from './websocket/index.js';
import { connectDatabase, disconnectDatabase } from './database/index.js';
import { seedZones } from './database/seedZones.js';
import { conversationManager } from './services/ConversationManager.js';
import { robotManager } from './services/RobotManager.js';
import { retentionCleanupJob } from './jobs/RetentionCleanupJob.js';
import { retentionPolicyService } from './services/RetentionPolicyService.js';
import { ropaService } from './services/RopaService.js';
import { providerDocumentationService } from './services/ProviderDocumentationService.js';
import { complianceTrackerService } from './services/ComplianceTrackerService.js';
import { natsClient, createStreams, createKVStores, initializeJobQueue } from './messaging/index.js';
import { trainingJobService } from './services/TrainingJobService.js';
import { datasetService } from './services/DatasetService.js';
import { datasetValidationWorker } from './workers/dataset-validation.worker.js';
import { trainingWorker } from './workers/training.worker.js';
import { initializeRustFSClient } from './storage/index.js';
import { storageCleanupJob } from './jobs/storage-cleanup.js';
import { mlflowService } from './services/MLflowService.js';
import { trainingOrchestrator } from './services/TrainingOrchestrator.js';

const PORT = process.env.PORT || 3001;

async function main() {
  console.log('Starting A2A Server...');

  // Connect to database
  await connectDatabase();

  // Seed default zones if database is empty
  await seedZones();

  // Initialize managers (load cached data from database)
  await conversationManager.initialize();
  await robotManager.initialize();

  // Initialize retention policies, RoPA, provider docs, and compliance tracker defaults
  await retentionPolicyService.initializeDefaults();
  await ropaService.initializeDefaults();
  await providerDocumentationService.initializeDefaults();
  await complianceTrackerService.initializeDefaults();

  // Start retention cleanup job (daily at 2 AM)
  retentionCleanupJob.startSchedule(24);

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
      await trainingWorker.start();
      console.log('[NATS] JetStream initialized with streams and KV stores');
    }
  } catch (error) {
    console.warn('[NATS] Failed to initialize (training features disabled):', error instanceof Error ? error.message : error);
  }

  // Initialize RustFS Object Storage (optional - graceful degradation if not available)
  try {
    await initializeRustFSClient();
    storageCleanupJob.startSchedule(24); // Daily at 3 AM
    console.log('[RustFS] Object storage initialized');
  } catch (error) {
    console.warn('[RustFS] Failed to initialize (storage features disabled):', error instanceof Error ? error.message : error);
  }

  // Initialize MLflow Model Registry (optional - graceful degradation if not available)
  try {
    await mlflowService.initialize();
    console.log('[MLflow] Model registry initialized');
  } catch (error) {
    console.warn('[MLflow] Failed to initialize (model registry features disabled):', error instanceof Error ? error.message : error);
  }

  // Create Express app
  const app = createApp();

  // Create HTTP server
  const server = createServer(app);

  // Setup WebSocket
  setupWebSocket(server);

  // Start server
  server.listen(PORT, () => {
    console.log(`A2A Server running on http://localhost:${PORT}`);
    console.log(`WebSocket available at ws://localhost:${PORT}/api/a2a/ws`);
    console.log(`Agent card at http://localhost:${PORT}/.well-known/a2a/agent_card.json`);
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log('Shutting down...');
    retentionCleanupJob.stopSchedule();
    storageCleanupJob.stopSchedule();
    trainingJobService.stopAllWatchers();
    await trainingWorker.stop();
    await datasetValidationWorker.stop();
    await natsClient.close();
    await disconnectDatabase();
    server.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch(async (err) => {
  console.error('Failed to start server:', err);
  await disconnectDatabase();
  process.exit(1);
});
