/**
 * @file team-routes.test.ts
 * @description Integration tests for tenant-scoped team management routes
 * @feature team
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Use vi.hoisted so mock objects + error classes exist before vi.mock hoisting.
const {
  mockTeamService,
  LastOwnerError,
  EmailTakenError,
  InvalidRoleError,
  TeamMemberNotFoundError,
} = vi.hoisted(() => {
  class LastOwnerError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'LastOwnerError';
    }
  }
  class EmailTakenError extends Error {
    constructor(email: string) {
      super(`A user with email "${email}" already exists.`);
      this.name = 'EmailTakenError';
    }
  }
  class InvalidRoleError extends Error {
    constructor(role: string) {
      super(`Invalid role "${role}". Must be one of: owner, member, viewer.`);
      this.name = 'InvalidRoleError';
    }
  }
  class TeamMemberNotFoundError extends Error {
    constructor() {
      super('Team member not found');
      this.name = 'TeamMemberNotFoundError';
    }
  }
  return {
    mockTeamService: {
      list: vi.fn(),
      add: vi.fn(),
      changeRole: vi.fn(),
      deactivate: vi.fn(),
      reactivate: vi.fn(),
    },
    LastOwnerError,
    EmailTakenError,
    InvalidRoleError,
    TeamMemberNotFoundError,
  };
});

vi.mock('../services/TeamService.js', () => ({
  teamService: mockTeamService,
  LastOwnerError,
  EmailTakenError,
  InvalidRoleError,
  TeamMemberNotFoundError,
}));

vi.mock('../middleware/auth.middleware.js', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = {
      id: 'user-123',
      email: 'owner@example.com',
      name: 'Owner',
      role: 'owner',
      tenantId: 'tenant-001',
    };
    next();
  },
  // The router calls `teamRoutes.use(ownerOnly)` — pass through.
  ownerOnly: (_req: any, _res: any, next: any) => next(),
  AuthenticatedRequest: {},
}));

import { teamRoutes } from '../routes/team.routes.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/team', authMiddleware as any, teamRoutes);
  return app;
}

const MEMBER = {
  id: 'member-1',
  email: 'mate@example.com',
  name: 'Mate',
  role: 'member',
  isActive: true,
  lastLoginAt: null,
  createdAt: '2026-02-26T00:00:00.000Z',
};

describe('Team Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // --------------------------------------------------------------------------
  // GET /api/team
  // --------------------------------------------------------------------------

  describe('GET /api/team', () => {
    it('lists team members for the caller tenant', async () => {
      mockTeamService.list.mockResolvedValue([MEMBER]);

      const response = await request(app).get('/api/team');

      expect(response.status).toBe(200);
      expect(response.body.members).toHaveLength(1);
      expect(response.body.members[0].email).toBe('mate@example.com');
      expect(mockTeamService.list).toHaveBeenCalledWith('tenant-001');
    });

    it('returns 500 on service error', async () => {
      mockTeamService.list.mockRejectedValue(new Error('DB error'));

      const response = await request(app).get('/api/team');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('DB error');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/team
  // --------------------------------------------------------------------------

  describe('POST /api/team', () => {
    it('adds a new teammate (201)', async () => {
      mockTeamService.add.mockResolvedValue({ member: MEMBER, tempPassword: 'pw-abc' });

      const response = await request(app)
        .post('/api/team')
        .send({ name: 'Mate', email: 'mate@example.com', role: 'member' });

      expect(response.status).toBe(201);
      expect(response.body.member.email).toBe('mate@example.com');
      expect(response.body.tempPassword).toBe('pw-abc');
      expect(mockTeamService.add).toHaveBeenCalledWith({
        tenantId: 'tenant-001',
        name: 'Mate',
        email: 'mate@example.com',
        role: 'member',
        tempPassword: undefined,
        actorId: 'user-123',
      });
    });

    it('returns 400 when required fields are missing', async () => {
      const response = await request(app)
        .post('/api/team')
        .send({ name: 'Mate' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('name, email, and role are required');
      expect(mockTeamService.add).not.toHaveBeenCalled();
    });

    it('returns 409 when email is already taken', async () => {
      mockTeamService.add.mockRejectedValue(new EmailTakenError('mate@example.com'));

      const response = await request(app)
        .post('/api/team')
        .send({ name: 'Mate', email: 'mate@example.com', role: 'member' });

      expect(response.status).toBe(409);
      expect(response.body.error).toContain('already exists');
    });

    it('returns 400 for an invalid role', async () => {
      mockTeamService.add.mockRejectedValue(new InvalidRoleError('wizard'));

      const response = await request(app)
        .post('/api/team')
        .send({ name: 'Mate', email: 'mate@example.com', role: 'wizard' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid role');
    });

    it('returns 400 on unexpected service error', async () => {
      mockTeamService.add.mockRejectedValue(new Error('DB connection lost'));

      const response = await request(app)
        .post('/api/team')
        .send({ name: 'Mate', email: 'mate@example.com', role: 'member' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('DB connection lost');
    });
  });

  // --------------------------------------------------------------------------
  // PATCH /api/team/:id
  // --------------------------------------------------------------------------

  describe('PATCH /api/team/:id', () => {
    it('changes a member role', async () => {
      const updated = { ...MEMBER, role: 'viewer' };
      mockTeamService.changeRole.mockResolvedValue(updated);

      const response = await request(app)
        .patch('/api/team/member-1')
        .send({ role: 'viewer' });

      expect(response.status).toBe(200);
      expect(response.body.role).toBe('viewer');
      expect(mockTeamService.changeRole).toHaveBeenCalledWith({
        tenantId: 'tenant-001',
        userId: 'member-1',
        newRole: 'viewer',
        actorId: 'user-123',
      });
    });

    it('deactivates a member when isActive=false', async () => {
      const updated = { ...MEMBER, isActive: false };
      mockTeamService.deactivate.mockResolvedValue(updated);

      const response = await request(app)
        .patch('/api/team/member-1')
        .send({ isActive: false });

      expect(response.status).toBe(200);
      expect(response.body.isActive).toBe(false);
      expect(mockTeamService.deactivate).toHaveBeenCalledWith({
        tenantId: 'tenant-001',
        userId: 'member-1',
        actorId: 'user-123',
      });
    });

    it('reactivates a member when isActive=true', async () => {
      mockTeamService.reactivate.mockResolvedValue(MEMBER);

      const response = await request(app)
        .patch('/api/team/member-1')
        .send({ isActive: true });

      expect(response.status).toBe(200);
      expect(response.body.isActive).toBe(true);
      expect(mockTeamService.reactivate).toHaveBeenCalledWith({
        tenantId: 'tenant-001',
        userId: 'member-1',
        actorId: 'user-123',
      });
    });

    it('returns 400 when no supported fields are present', async () => {
      const response = await request(app)
        .patch('/api/team/member-1')
        .send({ foo: 'bar' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('No supported fields in body (role, isActive)');
    });

    it('returns 409 on last-owner guard', async () => {
      mockTeamService.changeRole.mockRejectedValue(
        new LastOwnerError('Cannot demote the last owner')
      );

      const response = await request(app)
        .patch('/api/team/member-1')
        .send({ role: 'member' });

      expect(response.status).toBe(409);
      expect(response.body.error).toContain('last owner');
    });

    it('returns 400 on invalid role', async () => {
      mockTeamService.changeRole.mockRejectedValue(new InvalidRoleError('wizard'));

      const response = await request(app)
        .patch('/api/team/member-1')
        .send({ role: 'wizard' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid role');
    });

    it('returns 404 when member not found', async () => {
      mockTeamService.changeRole.mockRejectedValue(new TeamMemberNotFoundError());

      const response = await request(app)
        .patch('/api/team/missing')
        .send({ role: 'viewer' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Team member not found');
    });

    it('returns 400 on unexpected service error', async () => {
      mockTeamService.changeRole.mockRejectedValue(new Error('boom'));

      const response = await request(app)
        .patch('/api/team/member-1')
        .send({ role: 'viewer' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('boom');
    });
  });

  // --------------------------------------------------------------------------
  // DELETE /api/team/:id
  // --------------------------------------------------------------------------

  describe('DELETE /api/team/:id', () => {
    it('soft-deactivates a member', async () => {
      const updated = { ...MEMBER, isActive: false };
      mockTeamService.deactivate.mockResolvedValue(updated);

      const response = await request(app).delete('/api/team/member-1');

      expect(response.status).toBe(200);
      expect(response.body.isActive).toBe(false);
      expect(mockTeamService.deactivate).toHaveBeenCalledWith({
        tenantId: 'tenant-001',
        userId: 'member-1',
        actorId: 'user-123',
      });
    });

    it('returns 409 on last-owner guard', async () => {
      mockTeamService.deactivate.mockRejectedValue(
        new LastOwnerError('Cannot deactivate the last owner')
      );

      const response = await request(app).delete('/api/team/member-1');

      expect(response.status).toBe(409);
      expect(response.body.error).toContain('last owner');
    });

    it('returns 404 when member not found', async () => {
      mockTeamService.deactivate.mockRejectedValue(new TeamMemberNotFoundError());

      const response = await request(app).delete('/api/team/missing');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Team member not found');
    });

    it('returns 400 on unexpected service error', async () => {
      mockTeamService.deactivate.mockRejectedValue(new Error('boom'));

      const response = await request(app).delete('/api/team/member-1');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('boom');
    });
  });
});
