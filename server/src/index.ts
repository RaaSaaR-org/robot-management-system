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
