/**
 * @file skills-routes.test.ts
 * @description Integration tests for skill library + skill execution routes
 * @feature vla
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Use vi.hoisted so mock objects are available before vi.mock hoisting
const { mockSkillLibraryService, mockSkillExecutionService } = vi.hoisted(() => ({
  mockSkillLibraryService: {
    // skill definitions
    createSkill: vi.fn(),
    listSkills: vi.fn(),
    listPublishedSkills: vi.fn(),
    getSkillsForRobot: vi.fn(),
    getSkillWithRelations: vi.fn(),
    updateSkill: vi.fn(),
    deleteSkill: vi.fn(),
    publishSkill: vi.fn(),
    deprecateSkill: vi.fn(),
    archiveSkill: vi.fn(),
    validateSkillParameters: vi.fn(),
    getCompatibleRobots: vi.fn(),
    checkRobotCompatibility: vi.fn(),
    // chains
    createChain: vi.fn(),
    listChains: vi.fn(),
    listActiveChains: vi.fn(),
    getChain: vi.fn(),
    updateChain: vi.fn(),
    deleteChain: vi.fn(),
    activateChain: vi.fn(),
    archiveChain: vi.fn(),
  },
  mockSkillExecutionService: {
    executeChain: vi.fn(),
    executeSkill: vi.fn(),
    abortSkillOnRobot: vi.fn(),
  },
}));

vi.mock('../services/SkillLibraryService.js', () => ({
  skillLibraryService: mockSkillLibraryService,
}));

vi.mock('../services/SkillExecutionService.js', () => ({
  skillExecutionService: mockSkillExecutionService,
}));

vi.mock('../middleware/auth.middleware.js', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-123', email: 'test@example.com', name: 'Test', role: 'admin' };
    next();
  },
  AuthenticatedRequest: {},
}));

import { skillsRoutes } from '../routes/skills.routes.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/skills', authMiddleware as any, skillsRoutes);
  return app;
}

const MOCK_SKILL = {
  id: 'skill-001',
  name: 'pick-and-place',
  version: '1.0.0',
  status: 'draft',
};

const MOCK_CHAIN = {
  id: 'chain-001',
  name: 'morning-routine',
  status: 'draft',
  steps: [{ skillId: 'skill-001' }],
};

describe('Skills Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // ==========================================================================
  // SKILL CHAIN ROUTES
  // ==========================================================================

  describe('POST /api/skills/chains', () => {
    it('creates a skill chain (201)', async () => {
      mockSkillLibraryService.createChain.mockResolvedValue(MOCK_CHAIN);

      const body = { name: 'morning-routine', steps: [{ skillId: 'skill-001' }] };
      const response = await request(app).post('/api/skills/chains').send(body);

      expect(response.status).toBe(201);
      expect(response.body.chain.id).toBe('chain-001');
      expect(response.body.message).toBe('Skill chain created successfully');
      expect(mockSkillLibraryService.createChain).toHaveBeenCalledWith(body);
    });

    it('returns 400 when name is missing', async () => {
      const response = await request(app)
        .post('/api/skills/chains')
        .send({ steps: [{ skillId: 'skill-001' }] });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('name is required');
      expect(mockSkillLibraryService.createChain).not.toHaveBeenCalled();
    });

    it('returns 400 when steps is empty', async () => {
      const response = await request(app)
        .post('/api/skills/chains')
        .send({ name: 'x', steps: [] });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('steps is required and must not be empty');
    });

    it('returns 400 on service error', async () => {
      mockSkillLibraryService.createChain.mockRejectedValue(new Error('bad chain'));

      const response = await request(app)
        .post('/api/skills/chains')
        .send({ name: 'x', steps: [{ skillId: 'skill-001' }] });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('bad chain');
    });
  });

  describe('GET /api/skills/chains', () => {
    it('lists chains with pagination', async () => {
      mockSkillLibraryService.listChains.mockResolvedValue({
        data: [MOCK_CHAIN],
        pagination: { page: 1, pageSize: 20, total: 1 },
      });

      const response = await request(app)
        .get('/api/skills/chains')
        .query({ name: 'morning', status: 'draft,active', page: '1', pageSize: '20' });

      expect(response.status).toBe(200);
      expect(response.body.chains).toHaveLength(1);
      expect(response.body.pagination.total).toBe(1);
      expect(mockSkillLibraryService.listChains).toHaveBeenCalledWith({
        name: 'morning',
        page: 1,
        pageSize: 20,
        status: ['draft', 'active'],
      });
    });

    it('returns 500 on service error', async () => {
      mockSkillLibraryService.listChains.mockRejectedValue(new Error('db down'));

      const response = await request(app).get('/api/skills/chains');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('db down');
    });
  });

  describe('GET /api/skills/chains/active', () => {
    it('lists active chains with count', async () => {
      mockSkillLibraryService.listActiveChains.mockResolvedValue([MOCK_CHAIN]);

      const response = await request(app).get('/api/skills/chains/active');

      expect(response.status).toBe(200);
      expect(response.body.count).toBe(1);
      expect(response.body.chains).toHaveLength(1);
      expect(mockSkillLibraryService.listActiveChains).toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockSkillLibraryService.listActiveChains.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/skills/chains/active');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('boom');
    });
  });

  describe('GET /api/skills/chains/:id', () => {
    it('returns a chain', async () => {
      mockSkillLibraryService.getChain.mockResolvedValue(MOCK_CHAIN);

      const response = await request(app).get('/api/skills/chains/chain-001');

      expect(response.status).toBe(200);
      expect(response.body.chain.id).toBe('chain-001');
      expect(mockSkillLibraryService.getChain).toHaveBeenCalledWith('chain-001');
    });

    it('returns 404 when chain not found', async () => {
      mockSkillLibraryService.getChain.mockResolvedValue(null);

      const response = await request(app).get('/api/skills/chains/missing');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Skill chain not found');
    });

    it('returns 500 on service error', async () => {
      mockSkillLibraryService.getChain.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/skills/chains/chain-001');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('boom');
    });
  });

  describe('PUT /api/skills/chains/:id', () => {
    it('updates a chain', async () => {
      const updated = { ...MOCK_CHAIN, name: 'evening-routine' };
      mockSkillLibraryService.updateChain.mockResolvedValue(updated);

      const response = await request(app)
        .put('/api/skills/chains/chain-001')
        .send({ name: 'evening-routine' });

      expect(response.status).toBe(200);
      expect(response.body.chain.name).toBe('evening-routine');
      expect(response.body.message).toBe('Skill chain updated successfully');
      expect(mockSkillLibraryService.updateChain).toHaveBeenCalledWith('chain-001', {
        name: 'evening-routine',
      });
    });

    it('returns 404 when chain not found', async () => {
      mockSkillLibraryService.updateChain.mockResolvedValue(null);

      const response = await request(app)
        .put('/api/skills/chains/missing')
        .send({ name: 'x' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Skill chain not found');
    });

    it('returns 400 on service error', async () => {
      mockSkillLibraryService.updateChain.mockRejectedValue(new Error('invalid update'));

      const response = await request(app)
        .put('/api/skills/chains/chain-001')
        .send({ name: 'x' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('invalid update');
    });
  });

  describe('DELETE /api/skills/chains/:id', () => {
    it('deletes a chain', async () => {
      mockSkillLibraryService.deleteChain.mockResolvedValue(true);

      const response = await request(app).delete('/api/skills/chains/chain-001');

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Skill chain deleted successfully');
      expect(mockSkillLibraryService.deleteChain).toHaveBeenCalledWith('chain-001');
    });

    it('returns 404 when chain not found', async () => {
      mockSkillLibraryService.deleteChain.mockResolvedValue(false);

      const response = await request(app).delete('/api/skills/chains/missing');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Skill chain not found');
    });

    it('returns 400 on service error', async () => {
      mockSkillLibraryService.deleteChain.mockRejectedValue(new Error('cannot delete'));

      const response = await request(app).delete('/api/skills/chains/chain-001');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('cannot delete');
    });
  });

  describe('POST /api/skills/chains/:id/activate', () => {
    it('activates a chain', async () => {
      mockSkillLibraryService.activateChain.mockResolvedValue({ ...MOCK_CHAIN, status: 'active' });

      const response = await request(app).post('/api/skills/chains/chain-001/activate');

      expect(response.status).toBe(200);
      expect(response.body.chain.status).toBe('active');
      expect(response.body.message).toBe('Skill chain activated successfully');
      expect(mockSkillLibraryService.activateChain).toHaveBeenCalledWith('chain-001');
    });

    it('returns 400 on service error', async () => {
      mockSkillLibraryService.activateChain.mockRejectedValue(new Error('cannot activate'));

      const response = await request(app).post('/api/skills/chains/chain-001/activate');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('cannot activate');
    });
  });

  describe('POST /api/skills/chains/:id/archive', () => {
    it('archives a chain', async () => {
      mockSkillLibraryService.archiveChain.mockResolvedValue({ ...MOCK_CHAIN, status: 'archived' });

      const response = await request(app).post('/api/skills/chains/chain-001/archive');

      expect(response.status).toBe(200);
      expect(response.body.chain.status).toBe('archived');
      expect(response.body.message).toBe('Skill chain archived successfully');
      expect(mockSkillLibraryService.archiveChain).toHaveBeenCalledWith('chain-001');
    });

    it('returns 400 on service error', async () => {
      mockSkillLibraryService.archiveChain.mockRejectedValue(new Error('cannot archive'));

      const response = await request(app).post('/api/skills/chains/chain-001/archive');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('cannot archive');
    });
  });

  describe('POST /api/skills/chains/:id/execute', () => {
    it('executes a chain successfully (200)', async () => {
      mockSkillExecutionService.executeChain.mockResolvedValue({ status: 'completed' });

      const response = await request(app)
        .post('/api/skills/chains/chain-001/execute')
        .send({ robotId: 'robot-1', initialParameters: { speed: 1 } });

      expect(response.status).toBe(200);
      expect(response.body.result.status).toBe('completed');
      expect(response.body.message).toBe('Chain executed successfully');
      expect(mockSkillExecutionService.executeChain).toHaveBeenCalledWith({
        chainId: 'chain-001',
        robotId: 'robot-1',
        initialParameters: { speed: 1 },
        startFromStep: undefined,
      });
    });

    it('returns 400 when execution status is not completed', async () => {
      mockSkillExecutionService.executeChain.mockResolvedValue({ status: 'failed' });

      const response = await request(app)
        .post('/api/skills/chains/chain-001/execute')
        .send({ robotId: 'robot-1' });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('Chain execution failed');
    });

    it('returns 400 when robotId is missing', async () => {
      const response = await request(app)
        .post('/api/skills/chains/chain-001/execute')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('robotId is required');
      expect(mockSkillExecutionService.executeChain).not.toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockSkillExecutionService.executeChain.mockRejectedValue(new Error('exec boom'));

      const response = await request(app)
        .post('/api/skills/chains/chain-001/execute')
        .send({ robotId: 'robot-1' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('exec boom');
    });
  });

  // ==========================================================================
  // SKILL DEFINITION ROUTES
  // ==========================================================================

  describe('POST /api/skills', () => {
    it('creates a skill (201)', async () => {
      mockSkillLibraryService.createSkill.mockResolvedValue(MOCK_SKILL);

      const body = { name: 'pick-and-place', version: '1.0.0' };
      const response = await request(app).post('/api/skills').send(body);

      expect(response.status).toBe(201);
      expect(response.body.skill.id).toBe('skill-001');
      expect(response.body.message).toBe('Skill created successfully');
      expect(mockSkillLibraryService.createSkill).toHaveBeenCalledWith(body);
    });

    it('returns 400 when name is missing', async () => {
      const response = await request(app).post('/api/skills').send({ version: '1.0.0' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('name is required');
      expect(mockSkillLibraryService.createSkill).not.toHaveBeenCalled();
    });

    it('returns 400 when version is missing', async () => {
      const response = await request(app).post('/api/skills').send({ name: 'x' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('version is required');
    });

    it('returns 400 on service error', async () => {
      mockSkillLibraryService.createSkill.mockRejectedValue(new Error('bad skill'));

      const response = await request(app)
        .post('/api/skills')
        .send({ name: 'x', version: '1.0.0' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('bad skill');
    });
  });

  describe('GET /api/skills', () => {
    it('lists skills with filters and pagination', async () => {
      mockSkillLibraryService.listSkills.mockResolvedValue({
        data: [MOCK_SKILL],
        pagination: { page: 2, pageSize: 5, total: 1 },
      });

      const response = await request(app).get('/api/skills').query({
        name: 'pick',
        status: 'draft,published',
        page: '2',
        pageSize: '5',
        robotTypeId: 'rt-1',
        capability: 'grasp',
        linkedModelVersionId: 'mv-1',
      });

      expect(response.status).toBe(200);
      expect(response.body.skills).toHaveLength(1);
      expect(response.body.pagination.page).toBe(2);
      expect(mockSkillLibraryService.listSkills).toHaveBeenCalledWith({
        name: 'pick',
        page: 2,
        pageSize: 5,
        robotTypeId: 'rt-1',
        capability: 'grasp',
        linkedModelVersionId: 'mv-1',
        status: ['draft', 'published'],
      });
    });

    it('parses a single status value', async () => {
      mockSkillLibraryService.listSkills.mockResolvedValue({
        data: [],
        pagination: { page: 1, pageSize: 20, total: 0 },
      });

      await request(app).get('/api/skills').query({ status: 'draft' });

      expect(mockSkillLibraryService.listSkills).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'draft' })
      );
    });

    it('returns 500 on service error', async () => {
      mockSkillLibraryService.listSkills.mockRejectedValue(new Error('db down'));

      const response = await request(app).get('/api/skills');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('db down');
    });
  });

  describe('GET /api/skills/published', () => {
    it('lists published skills with count', async () => {
      mockSkillLibraryService.listPublishedSkills.mockResolvedValue([MOCK_SKILL]);

      const response = await request(app).get('/api/skills/published');

      expect(response.status).toBe(200);
      expect(response.body.count).toBe(1);
      expect(response.body.skills).toHaveLength(1);
      expect(mockSkillLibraryService.listPublishedSkills).toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockSkillLibraryService.listPublishedSkills.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/skills/published');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('boom');
    });
  });

  describe('GET /api/skills/for-robot/:robotId', () => {
    it('lists skills for a robot', async () => {
      mockSkillLibraryService.getSkillsForRobot.mockResolvedValue([MOCK_SKILL]);

      const response = await request(app).get('/api/skills/for-robot/robot-1');

      expect(response.status).toBe(200);
      expect(response.body.robotId).toBe('robot-1');
      expect(response.body.count).toBe(1);
      expect(mockSkillLibraryService.getSkillsForRobot).toHaveBeenCalledWith('robot-1');
    });

    it('returns 400 on service error', async () => {
      mockSkillLibraryService.getSkillsForRobot.mockRejectedValue(new Error('no robot'));

      const response = await request(app).get('/api/skills/for-robot/robot-1');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('no robot');
    });
  });

  describe('GET /api/skills/:id', () => {
    it('returns a skill', async () => {
      mockSkillLibraryService.getSkillWithRelations.mockResolvedValue(MOCK_SKILL);

      const response = await request(app).get('/api/skills/skill-001');

      expect(response.status).toBe(200);
      expect(response.body.skill.id).toBe('skill-001');
      expect(mockSkillLibraryService.getSkillWithRelations).toHaveBeenCalledWith('skill-001');
    });

    it('returns 404 when skill not found', async () => {
      mockSkillLibraryService.getSkillWithRelations.mockResolvedValue(null);

      const response = await request(app).get('/api/skills/missing');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Skill not found');
    });

    it('returns 500 on service error', async () => {
      mockSkillLibraryService.getSkillWithRelations.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/skills/skill-001');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('boom');
    });
  });

  describe('PUT /api/skills/:id', () => {
    it('updates a skill', async () => {
      const updated = { ...MOCK_SKILL, name: 'place-only' };
      mockSkillLibraryService.updateSkill.mockResolvedValue(updated);

      const response = await request(app)
        .put('/api/skills/skill-001')
        .send({ name: 'place-only' });

      expect(response.status).toBe(200);
      expect(response.body.skill.name).toBe('place-only');
      expect(response.body.message).toBe('Skill updated successfully');
      expect(mockSkillLibraryService.updateSkill).toHaveBeenCalledWith('skill-001', {
        name: 'place-only',
      });
    });

    it('returns 404 when skill not found', async () => {
      mockSkillLibraryService.updateSkill.mockResolvedValue(null);

      const response = await request(app).put('/api/skills/missing').send({ name: 'x' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Skill not found');
    });

    it('returns 400 on service error', async () => {
      mockSkillLibraryService.updateSkill.mockRejectedValue(new Error('invalid'));

      const response = await request(app).put('/api/skills/skill-001').send({ name: 'x' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('invalid');
    });
  });

  describe('DELETE /api/skills/:id', () => {
    it('deletes a skill', async () => {
      mockSkillLibraryService.deleteSkill.mockResolvedValue(true);

      const response = await request(app).delete('/api/skills/skill-001');

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Skill deleted successfully');
      expect(mockSkillLibraryService.deleteSkill).toHaveBeenCalledWith('skill-001');
    });

    it('returns 404 when skill not found', async () => {
      mockSkillLibraryService.deleteSkill.mockResolvedValue(false);

      const response = await request(app).delete('/api/skills/missing');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Skill not found');
    });

    it('returns 400 on service error', async () => {
      mockSkillLibraryService.deleteSkill.mockRejectedValue(new Error('cannot delete'));

      const response = await request(app).delete('/api/skills/skill-001');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('cannot delete');
    });
  });

  // ==========================================================================
  // SKILL STATUS ROUTES
  // ==========================================================================

  describe('POST /api/skills/:id/publish', () => {
    it('publishes a skill', async () => {
      mockSkillLibraryService.publishSkill.mockResolvedValue({ ...MOCK_SKILL, status: 'published' });

      const response = await request(app).post('/api/skills/skill-001/publish');

      expect(response.status).toBe(200);
      expect(response.body.skill.status).toBe('published');
      expect(response.body.message).toBe('Skill published successfully');
      expect(mockSkillLibraryService.publishSkill).toHaveBeenCalledWith('skill-001');
    });

    it('returns 400 on service error', async () => {
      mockSkillLibraryService.publishSkill.mockRejectedValue(new Error('cannot publish'));

      const response = await request(app).post('/api/skills/skill-001/publish');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('cannot publish');
    });
  });

  describe('POST /api/skills/:id/deprecate', () => {
    it('deprecates a skill', async () => {
      mockSkillLibraryService.deprecateSkill.mockResolvedValue({
        ...MOCK_SKILL,
        status: 'deprecated',
      });

      const response = await request(app).post('/api/skills/skill-001/deprecate');

      expect(response.status).toBe(200);
      expect(response.body.skill.status).toBe('deprecated');
      expect(response.body.message).toBe('Skill deprecated successfully');
      expect(mockSkillLibraryService.deprecateSkill).toHaveBeenCalledWith('skill-001');
    });

    it('returns 400 on service error', async () => {
      mockSkillLibraryService.deprecateSkill.mockRejectedValue(new Error('cannot deprecate'));

      const response = await request(app).post('/api/skills/skill-001/deprecate');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('cannot deprecate');
    });
  });

  describe('POST /api/skills/:id/archive', () => {
    it('archives a skill', async () => {
      mockSkillLibraryService.archiveSkill.mockResolvedValue({ ...MOCK_SKILL, status: 'archived' });

      const response = await request(app).post('/api/skills/skill-001/archive');

      expect(response.status).toBe(200);
      expect(response.body.skill.status).toBe('archived');
      expect(response.body.message).toBe('Skill archived successfully');
      expect(mockSkillLibraryService.archiveSkill).toHaveBeenCalledWith('skill-001');
    });

    it('returns 400 on service error', async () => {
      mockSkillLibraryService.archiveSkill.mockRejectedValue(new Error('cannot archive'));

      const response = await request(app).post('/api/skills/skill-001/archive');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('cannot archive');
    });
  });

  // ==========================================================================
  // PARAMETER VALIDATION ROUTES
  // ==========================================================================

  describe('POST /api/skills/:id/validate', () => {
    it('validates parameters', async () => {
      mockSkillLibraryService.validateSkillParameters.mockResolvedValue({ valid: true, errors: [] });

      const response = await request(app)
        .post('/api/skills/skill-001/validate')
        .send({ parameters: { speed: 1 } });

      expect(response.status).toBe(200);
      expect(response.body.skillId).toBe('skill-001');
      expect(response.body.valid).toBe(true);
      expect(mockSkillLibraryService.validateSkillParameters).toHaveBeenCalledWith('skill-001', {
        speed: 1,
      });
    });

    it('returns 400 when parameters is missing', async () => {
      const response = await request(app).post('/api/skills/skill-001/validate').send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('parameters is required');
      expect(mockSkillLibraryService.validateSkillParameters).not.toHaveBeenCalled();
    });

    it('returns 400 on service error', async () => {
      mockSkillLibraryService.validateSkillParameters.mockRejectedValue(new Error('bad params'));

      const response = await request(app)
        .post('/api/skills/skill-001/validate')
        .send({ parameters: { speed: 1 } });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('bad params');
    });
  });

  // ==========================================================================
  // COMPATIBILITY ROUTES
  // ==========================================================================

  describe('GET /api/skills/:id/compatible-robots', () => {
    it('returns compatible robots', async () => {
      mockSkillLibraryService.getCompatibleRobots.mockResolvedValue({
        robots: [{ id: 'robot-1' }],
        count: 1,
      });

      const response = await request(app).get('/api/skills/skill-001/compatible-robots');

      expect(response.status).toBe(200);
      expect(response.body.count).toBe(1);
      expect(mockSkillLibraryService.getCompatibleRobots).toHaveBeenCalledWith('skill-001');
    });

    it('returns 400 on service error', async () => {
      mockSkillLibraryService.getCompatibleRobots.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/skills/skill-001/compatible-robots');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('boom');
    });
  });

  describe('GET /api/skills/:id/check-robot/:robotId', () => {
    it('checks robot compatibility', async () => {
      mockSkillLibraryService.checkRobotCompatibility.mockResolvedValue({ compatible: true });

      const response = await request(app).get('/api/skills/skill-001/check-robot/robot-1');

      expect(response.status).toBe(200);
      expect(response.body.compatible).toBe(true);
      expect(mockSkillLibraryService.checkRobotCompatibility).toHaveBeenCalledWith(
        'skill-001',
        'robot-1'
      );
    });

    it('returns 400 on service error', async () => {
      mockSkillLibraryService.checkRobotCompatibility.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/skills/skill-001/check-robot/robot-1');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('boom');
    });
  });

  // ==========================================================================
  // SKILL EXECUTION ROUTES
  // ==========================================================================

  describe('POST /api/skills/:id/abort', () => {
    it('aborts a running skill (204)', async () => {
      mockSkillExecutionService.abortSkillOnRobot.mockResolvedValue(true);

      const response = await request(app)
        .post('/api/skills/skill-001/abort')
        .send({ robotId: 'robot-1' });

      expect(response.status).toBe(204);
      expect(mockSkillExecutionService.abortSkillOnRobot).toHaveBeenCalledWith(
        'skill-001',
        'robot-1'
      );
    });

    it('returns 400 when robotId is missing', async () => {
      const response = await request(app).post('/api/skills/skill-001/abort').send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('robotId is required');
      expect(mockSkillExecutionService.abortSkillOnRobot).not.toHaveBeenCalled();
    });

    it('returns 404 when there is no active execution', async () => {
      mockSkillExecutionService.abortSkillOnRobot.mockResolvedValue(false);

      const response = await request(app)
        .post('/api/skills/skill-001/abort')
        .send({ robotId: 'robot-1' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('No active execution to abort');
    });

    it('returns 500 on service error', async () => {
      mockSkillExecutionService.abortSkillOnRobot.mockRejectedValue(new Error('abort boom'));

      const response = await request(app)
        .post('/api/skills/skill-001/abort')
        .send({ robotId: 'robot-1' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('abort boom');
    });
  });

  describe('POST /api/skills/:id/execute', () => {
    it('executes a skill successfully (200)', async () => {
      mockSkillExecutionService.executeSkill.mockResolvedValue({ status: 'completed' });

      const response = await request(app)
        .post('/api/skills/skill-001/execute')
        .send({ robotId: 'robot-1', parameters: { speed: 1 } });

      expect(response.status).toBe(200);
      expect(response.body.result.status).toBe('completed');
      expect(response.body.message).toBe('Skill executed successfully');
      expect(mockSkillExecutionService.executeSkill).toHaveBeenCalledWith({
        skillId: 'skill-001',
        robotId: 'robot-1',
        parameters: { speed: 1 },
        skipPreconditions: undefined,
        skipPostconditions: undefined,
      });
    });

    it('forwards rolloutStrategy unchanged to the execution service (TASK-179 §5)', async () => {
      mockSkillExecutionService.executeSkill.mockResolvedValue({ status: 'completed' });

      const response = await request(app)
        .post('/api/skills/skill-001/execute')
        .send({ robotId: 'robot-1', rolloutStrategy: 'highlight' });

      expect(response.status).toBe(200);
      expect(mockSkillExecutionService.executeSkill).toHaveBeenCalledWith(
        expect.objectContaining({
          skillId: 'skill-001',
          robotId: 'robot-1',
          rolloutStrategy: 'highlight',
        })
      );
    });

    it('returns 400 when execution status is not completed', async () => {
      mockSkillExecutionService.executeSkill.mockResolvedValue({ status: 'failed' });

      const response = await request(app)
        .post('/api/skills/skill-001/execute')
        .send({ robotId: 'robot-1' });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('Skill execution failed');
    });

    it('returns 400 when robotId is missing', async () => {
      const response = await request(app).post('/api/skills/skill-001/execute').send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('robotId is required');
      expect(mockSkillExecutionService.executeSkill).not.toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockSkillExecutionService.executeSkill.mockRejectedValue(new Error('exec boom'));

      const response = await request(app)
        .post('/api/skills/skill-001/execute')
        .send({ robotId: 'robot-1' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('exec boom');
    });
  });
});
