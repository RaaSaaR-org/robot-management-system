/**
 * @file index.ts
 * @description Main entry point for the Simulated Robot A2A Agent
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import http from 'http';
import type { TaskStore } from '@a2a-js/sdk/server';
import { InMemoryTaskStore, DefaultRequestHandler } from '@a2a-js/sdk/server';
import { A2AExpressApp } from '@a2a-js/sdk/server/express';

import { config, validateConfig } from './config/config.js';
import { RobotStateManager } from './robot/state.js';
import { createRobotAgentCard } from './agent/agent-card.js';
import { RobotAgentExecutor } from './agent/agent-executor.js';
import { createRestRoutes } from './api/rest-routes.js';
import { createTelemetryWebSocket } from './api/websocket.js';
import { setRobotStateManager as setNavigationStateManager } from './tools/navigation.js';
import { setRobotStateManager as setManipulationStateManager } from './tools/manipulation.js';
import { setRobotStateManager as setStatusStateManager } from './tools/status.js';
import { complianceLogClient } from './compliance/ComplianceLogClient.js';
import { createBilateralTeleopWebSocket } from './api/bilateral-teleop.js';
import { FrameRecorder } from './teleop/FrameRecorder.js';
import { DeviceIdentityManager } from './security/device-identity.js';
import { SecureBootVerifier } from './security/secure-boot.js';
import { secureUpdateClient } from './updates/SecureUpdateClient.js';
import { RoundLifecycle } from './federated/RoundLifecycle.js';
import type { FederatedStatus, TrainingEpisode } from './federated/types.js';

async function main() {
  console.log('='.repeat(60));
  console.log(' Simulated Robot A2A Agent');
  console.log('='.repeat(60));

  // Validate configuration
  validateConfig();

  const PORT = config.port;
  const ROBOT_ID = config.robotId;
  const ROBOT_NAME = config.robotName;

  // Initialize device identity (CRA Annex I — unique device identity)
  const deviceIdentity = new DeviceIdentityManager(ROBOT_ID);
  await deviceIdentity.initialize();
  console.log(`[DeviceIdentity] Device fingerprint: ${deviceIdentity.getDeviceFingerprint().slice(0, 20)}...`);

  // Secure boot verification (CRA Annex I — software integrity)
  const packageDir = new URL('..', import.meta.url).pathname;
  const secureBoot = new SecureBootVerifier(packageDir);
  const attestation = secureBoot.verify(ROBOT_ID, deviceIdentity.getDeviceFingerprint());
  if (!attestation.versionCompliant) {
    console.warn('[SecureBoot] WARNING: Anti-rollback violation detected');
  }

  // Initialize robot state manager
  const robotStateManager = new RobotStateManager({
    id: ROBOT_ID,
    name: ROBOT_NAME,
    model: config.robotModel,
    robotClass: config.robotClass,
    robotType: config.robotType,
    maxPayloadKg: config.maxPayloadKg,
    description: config.robotDescription,
    initialLocation: config.initialLocation,
    capabilities: ['navigation', 'manipulation', 'lifting'],
  });

  // Set robot state manager for tools
  setNavigationStateManager(robotStateManager);
  setManipulationStateManager(robotStateManager);
  setStatusStateManager(robotStateManager);

  // Start robot simulation
  robotStateManager.startSimulation();
  console.log('[SimulatedRobot] Robot simulation started');

  // Start safety monitoring
  robotStateManager.startSafetyMonitoring();
  console.log('[SimulatedRobot] Safety monitoring started');

  // Start compliance logging session
  try {
    const sessionId = await complianceLogClient.startSession();
    console.log(`[SimulatedRobot] Compliance logging session started: ${sessionId}`);

    // Log system startup event
    await complianceLogClient.logSystemEvent({
      payload: {
        description: 'Robot agent started',
        eventName: 'system_startup',
        component: 'robot-agent',
        version: '1.0.0',
        configuration: {
          robotId: ROBOT_ID,
          robotName: ROBOT_NAME,
          robotClass: config.robotClass,
          maxPayloadKg: config.maxPayloadKg,
        },
      },
      severity: 'info',
    });
  } catch (error) {
    console.warn('[SimulatedRobot] Failed to start compliance session:', error);
  }

  // Start federated learning lifecycle (if enabled)
  let federatedLifecycle: RoundLifecycle | null = null;

  if (process.env.FEDERATED_ENABLED === 'true') {
    federatedLifecycle = new RoundLifecycle({
      serverUrl: config.serverUrl,
      robotId: ROBOT_ID,
      pollIntervalMs: parseInt(process.env.FEDERATED_POLL_INTERVAL_MS || '30000', 10),
      trainingBridgePort: parseInt(process.env.FEDERATED_BRIDGE_PORT || '8766', 10),
      getLocalEpisodes: async (): Promise<TrainingEpisode[]> => {
        // Return empty array by default — real implementation would
        // pull from the robot's local data collection store
        return [];
      },
    });
    federatedLifecycle.start();
    console.log('[FederatedLearning] Federated learning lifecycle started');
  }

  // Create A2A components
  const agentCard = createRobotAgentCard({
    robotId: ROBOT_ID,
    robotName: ROBOT_NAME,
    port: PORT,
    robotClass: config.robotClass,
    maxPayloadKg: config.maxPayloadKg,
    robotDescription: config.robotDescription,
  });
  const taskStore: TaskStore = new InMemoryTaskStore();
  const agentExecutor = new RobotAgentExecutor(robotStateManager);
  const requestHandler = new DefaultRequestHandler(agentCard, taskStore, agentExecutor);

  // Create Express app
  const app = express();
  app.use(cors());
  app.use(express.json());

  // Top-level health check (used by Docker healthcheck and load balancers)
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', robotId: ROBOT_ID, uptime: process.uptime() });
  });

  // Mount REST API routes (NeoDEM compatible)
  app.use('/api/v1', createRestRoutes(robotStateManager, deviceIdentity, secureBoot));

  // Federated learning status endpoint
  app.get('/api/v1/federated/status', (_req, res) => {
    if (!federatedLifecycle) {
      const status: FederatedStatus = {
        enabled: false,
        running: false,
        currentRoundId: null,
        phase: 'idle',
        lastError: null,
        roundsParticipated: 0,
        lastParticipation: null,
      };
      res.json(status);
      return;
    }
    res.json(federatedLifecycle.getStatus());
  });

  // Mount A2A routes
  const a2aApp = new A2AExpressApp(requestHandler);
  a2aApp.setupRoutes(app, '');

  // Create HTTP server
  const server = http.createServer(app);

  // Setup WebSocket for telemetry streaming
  createTelemetryWebSocket(server, robotStateManager);

  // Setup bilateral teleop WebSocket with frame recorder
  const frameRecorder = new FrameRecorder();
  createBilateralTeleopWebSocket(server, frameRecorder);

  // Start server
  server.listen(PORT, () => {
    console.log('');
    console.log('='.repeat(60));
    console.log(' Server Started Successfully!');
    console.log('='.repeat(60));
    console.log('');
    console.log(`  Robot ID:     ${ROBOT_ID}`);
    console.log(`  Robot Name:   ${ROBOT_NAME}`);
    console.log(`  Robot Class:  ${config.robotClass}`);
    console.log(`  Max Payload:  ${config.maxPayloadKg}kg`);
    console.log(`  Port:         ${PORT}`);
    console.log('');
    console.log('  Endpoints:');
    console.log(`    Base URL:       http://localhost:${PORT}`);
    console.log(`    A2A Agent Card: http://localhost:${PORT}/.well-known/agent-card.json`);
    console.log(`    REST API:       http://localhost:${PORT}/api/v1/robots/${ROBOT_ID}`);
    console.log(`    Registration:   http://localhost:${PORT}/api/v1/register`);
    console.log(`    Telemetry WS:   ws://localhost:${PORT}/ws/telemetry/${ROBOT_ID}`);
    console.log(`    Health Check:   http://localhost:${PORT}/api/v1/health`);
    console.log('');
    console.log('  Press Ctrl+C to stop the server');
    console.log('='.repeat(60));

    // Start secure OTA update checks (CRA Art. 13)
    secureUpdateClient.startPeriodicChecks();
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\n[SimulatedRobot] Shutting down...');

    // Persist state synchronously before anything else (Task 39)
    robotStateManager.saveStateSync();
    console.log('[SimulatedRobot] State persisted to disk');

    // Log shutdown and end compliance session
    try {
      await complianceLogClient.logSystemEvent({
        payload: {
          description: 'Robot agent shutting down',
          eventName: 'system_shutdown',
          component: 'robot-agent',
          version: '1.0.0',
        },
        severity: 'info',
      });
      await complianceLogClient.endSession();
      console.log('[SimulatedRobot] Compliance session ended');
    } catch (error) {
      console.error('[SimulatedRobot] Failed to end compliance session:', error);
    }

    if (federatedLifecycle) {
      federatedLifecycle.stop();
      console.log('[FederatedLearning] Federated learning lifecycle stopped');
    }
    secureUpdateClient.stopPeriodicChecks();
    robotStateManager.stopSafetyMonitoring();
    robotStateManager.stopSimulation();
    server.close(() => {
      console.log('[SimulatedRobot] Server closed');
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('[SimulatedRobot] Fatal error:', error);
  process.exit(1);
});
