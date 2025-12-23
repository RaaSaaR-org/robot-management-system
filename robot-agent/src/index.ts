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

async function main() {
  console.log('='.repeat(60));
  console.log(' Simulated Robot A2A Agent');
  console.log('='.repeat(60));

  // Validate configuration
  validateConfig();

  const PORT = config.port;
  const ROBOT_ID = config.robotId;
  const ROBOT_NAME = config.robotName;

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

  // Mount REST API routes (RoboMindOS compatible)
  app.use('/api/v1', createRestRoutes(robotStateManager));

  // Mount A2A routes
  const a2aApp = new A2AExpressApp(requestHandler);
  a2aApp.setupRoutes(app, '');

  // Create HTTP server
  const server = http.createServer(app);

  // Setup WebSocket for telemetry streaming
  createTelemetryWebSocket(server, robotStateManager);

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
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n[SimulatedRobot] Shutting down...');
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
