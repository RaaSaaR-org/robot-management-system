/**
 * @file wellknown-routes.test.ts
 * @description Integration tests for A2A well-known agent discovery routes
 * @feature a2a
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// The well-known routes are purely static (no service/repo/DB/network I/O).
// We still mock the auth middleware to a pass-through that injects req.user,
// mirroring the canonical route-test pattern. In the real app this router is
// mounted at '/.well-known/a2a' WITHOUT auth (public discovery endpoint), so
// we mount it the same way to faithfully mirror production behavior.
vi.mock('../middleware/auth.middleware.js', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-123', email: 'test@example.com', name: 'Test', role: 'admin' };
    next();
  },
  AuthenticatedRequest: {},
}));

import { wellKnownRoutes } from '../routes/wellknown.routes.js';

function createApp() {
  const app = express();
  app.use(express.json());
  // Mounted without auth, exactly as in src/app.ts line 320.
  app.use('/.well-known/a2a', wellKnownRoutes);
  return app;
}

describe('Well-Known A2A Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // --------------------------------------------------------------------------
  // GET /.well-known/a2a/agent_card.json
  // --------------------------------------------------------------------------

  describe('GET /.well-known/a2a/agent_card.json', () => {
    it('returns the fleet-level agent card', async () => {
      const response = await request(app).get('/.well-known/a2a/agent_card.json');

      expect(response.status).toBe(200);
      expect(response.body.name).toBe('NeoDEM Fleet');
      expect(response.body.version).toBe('0.1.0');
      expect(response.body.provider).toEqual({
        organization: 'NeoDEM',
        url: 'https://neodem.io',
      });
      expect(response.body.capabilities).toEqual({
        streaming: true,
        pushNotifications: false,
        stateTransitionHistory: true,
      });
      expect(response.body.defaultInputModes).toEqual(['text']);
      expect(response.body.defaultOutputModes).toEqual(['text']);
    });

    it('includes the fleet skills (robot-command, fleet-status, task-management)', async () => {
      const response = await request(app).get('/.well-known/a2a/agent_card.json');

      expect(response.status).toBe(200);
      const skillIds = response.body.skills.map((s: { id: string }) => s.id);
      expect(skillIds).toEqual(['robot-command', 'fleet-status', 'task-management']);
    });

    it('uses default PUBLIC_URL when env var is unset', async () => {
      // PUBLIC_URL is read at module-load time; default is http://localhost:3001.
      const response = await request(app).get('/.well-known/a2a/agent_card.json');

      expect(response.status).toBe(200);
      expect(response.body.url).toBe('http://localhost:3001');
    });
  });

  // --------------------------------------------------------------------------
  // GET /.well-known/a2a/robots/:robotId/agent_card.json
  // --------------------------------------------------------------------------

  describe('GET /.well-known/a2a/robots/:robotId/agent_card.json', () => {
    it('returns a robot-specific agent card built from the robotId param', async () => {
      const response = await request(app).get(
        '/.well-known/a2a/robots/robot-alpha/agent_card.json'
      );

      expect(response.status).toBe(200);
      expect(response.body.name).toBe('Robot robot-alpha');
      expect(response.body.description).toContain('robot robot-alpha');
      expect(response.body.url).toBe('http://localhost:3001/robots/robot-alpha');
      expect(response.body.version).toBe('0.1.0');
      expect(response.body.provider).toEqual({
        organization: 'NeoDEM',
        url: 'https://neodem.io',
      });
    });

    it('includes the per-robot skills (move, pickup, drop, status)', async () => {
      const response = await request(app).get(
        '/.well-known/a2a/robots/r1/agent_card.json'
      );

      expect(response.status).toBe(200);
      const skillIds = response.body.skills.map((s: { id: string }) => s.id);
      expect(skillIds).toEqual(['move', 'pickup', 'drop', 'status']);
    });

    it('reflects a different robotId in the card', async () => {
      const response = await request(app).get(
        '/.well-known/a2a/robots/beta-42/agent_card.json'
      );

      expect(response.status).toBe(200);
      expect(response.body.name).toBe('Robot beta-42');
      expect(response.body.url).toBe('http://localhost:3001/robots/beta-42');
    });
  });

  // --------------------------------------------------------------------------
  // GET /.well-known/a2a/  (discovery endpoint)
  // --------------------------------------------------------------------------

  describe('GET /.well-known/a2a/', () => {
    it('returns the available discovery endpoints', async () => {
      const response = await request(app).get('/.well-known/a2a/');

      expect(response.status).toBe(200);
      expect(response.body.endpoints).toEqual({
        fleet_agent_card: '/.well-known/a2a/agent_card.json',
        robot_agent_card: '/.well-known/a2a/robots/:robotId/agent_card.json',
      });
    });
  });
});
