/**
 * @file index.ts
 * @description A2A Server entry point
 */

import { createServer } from 'http';
import { createApp } from './app.js';
import { setupWebSocket } from './websocket/index.js';

const PORT = process.env.PORT || 3001;

async function main() {
  console.log('Starting A2A Server...');

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
  process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down...');
    server.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
