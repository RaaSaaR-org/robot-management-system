/**
 * @file embodiments-routes.test.ts
 * @description Integration tests for embodiment configuration routes
 * @feature vla
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Use vi.hoisted so mock objects are available before vi.mock hoisting
const { mockEmbodimentService } = vi.hoisted(() => ({
  mockEmbodimentService: {
    upsertEmbodiment: vi.fn(),
    listEmbodiments: vi.fn(),
    getEmbodiment: vi.fn(),
    updateEmbodiment: vi.fn(),
    deleteEmbodiment: vi.fn(),
    validateYamlConfig: vi.fn(),
    linkToRobotType: vi.fn(),
    unlinkFromRobotType: vi.fn(),
    parseYamlConfig: vi.fn(),
  },
}));

vi.mock('../services/EmbodimentService.js', () => ({
  embodimentService: mockEmbodimentService,
}));

vi.mock('../middleware/auth.middleware.js', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-123', email: 'test@example.com', name: 'Test', role: 'admin' };
    next();
  },
  AuthenticatedRequest: {},
}));

import { embodimentsRoutes } from '../routes/embodiments.routes.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/embodiments', authMiddleware as any, embodimentsRoutes);
  return app;
}

const MOCK_EMBODIMENT = {
  id: 'emb-001',
  tag: 'so101',
  manufacturer: 'TheRobotStudio',
  model: 'SO-ARM100',
  configYaml: 'name: so101\naction_dim: 6\n',
  actionDim: 6,
  proprioceptionDim: 6,
  robotTypeId: null,
  createdAt: '2026-02-26T00:00:00.000Z',
  updatedAt: '2026-02-26T00:00:00.000Z',
};

const VALID_CREATE_INPUT = {
  tag: 'so101',
  manufacturer: 'TheRobotStudio',
  model: 'SO-ARM100',
  configYaml: 'name: so101\n',
  actionDim: 6,
  proprioceptionDim: 6,
};

describe('Embodiments Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // --------------------------------------------------------------------------
  // POST /api/embodiments
  // --------------------------------------------------------------------------

  describe('POST /api/embodiments', () => {
    it('creates/upserts an embodiment successfully (201)', async () => {
      mockEmbodimentService.upsertEmbodiment.mockResolvedValue(MOCK_EMBODIMENT);

      const response = await request(app).post('/api/embodiments').send(VALID_CREATE_INPUT);

      expect(response.status).toBe(201);
      expect(response.body.embodiment.tag).toBe('so101');
      expect(response.body.message).toBe('Embodiment created/updated successfully');
      expect(mockEmbodimentService.upsertEmbodiment).toHaveBeenCalledWith(VALID_CREATE_INPUT);
    });

    it('returns 400 when tag is missing', async () => {
      const { tag, ...rest } = VALID_CREATE_INPUT;
      const response = await request(app).post('/api/embodiments').send(rest);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('tag is required');
      expect(mockEmbodimentService.upsertEmbodiment).not.toHaveBeenCalled();
    });

    it('returns 400 when manufacturer is missing', async () => {
      const { manufacturer, ...rest } = VALID_CREATE_INPUT;
      const response = await request(app).post('/api/embodiments').send(rest);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('manufacturer is required');
    });

    it('returns 400 when model is missing', async () => {
      const { model, ...rest } = VALID_CREATE_INPUT;
      const response = await request(app).post('/api/embodiments').send(rest);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('model is required');
    });

    it('returns 400 when configYaml is missing', async () => {
      const { configYaml, ...rest } = VALID_CREATE_INPUT;
      const response = await request(app).post('/api/embodiments').send(rest);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('configYaml is required');
    });

    it('returns 400 when actionDim is not a positive number', async () => {
      const response = await request(app)
        .post('/api/embodiments')
        .send({ ...VALID_CREATE_INPUT, actionDim: 0 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('actionDim must be a positive integer');
    });

    it('returns 400 when proprioceptionDim is not a positive number', async () => {
      const response = await request(app)
        .post('/api/embodiments')
        .send({ ...VALID_CREATE_INPUT, proprioceptionDim: -1 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('proprioceptionDim must be a positive integer');
    });

    it('returns 400 when the service throws', async () => {
      mockEmbodimentService.upsertEmbodiment.mockRejectedValue(new Error('Invalid YAML config'));

      const response = await request(app).post('/api/embodiments').send(VALID_CREATE_INPUT);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid YAML config');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/embodiments
  // --------------------------------------------------------------------------

  describe('GET /api/embodiments', () => {
    it('lists embodiments with pagination', async () => {
      mockEmbodimentService.listEmbodiments.mockResolvedValue({
        data: [MOCK_EMBODIMENT],
        pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
      });

      const response = await request(app).get('/api/embodiments');

      expect(response.status).toBe(200);
      expect(response.body.embodiments).toHaveLength(1);
      expect(response.body.pagination.total).toBe(1);
      expect(mockEmbodimentService.listEmbodiments).toHaveBeenCalled();
    });

    it('passes filter and pagination query params to the service', async () => {
      mockEmbodimentService.listEmbodiments.mockResolvedValue({
        data: [],
        pagination: { page: 2, pageSize: 5, total: 0, totalPages: 0 },
      });

      await request(app).get(
        '/api/embodiments?manufacturer=Acme&model=X1&robotTypeId=rt-1&page=2&pageSize=5'
      );

      expect(mockEmbodimentService.listEmbodiments).toHaveBeenCalledWith({
        manufacturer: 'Acme',
        model: 'X1',
        robotTypeId: 'rt-1',
        page: 2,
        pageSize: 5,
      });
    });

    it('returns 500 on service error', async () => {
      mockEmbodimentService.listEmbodiments.mockRejectedValue(new Error('DB error'));

      const response = await request(app).get('/api/embodiments');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('DB error');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/embodiments/:tag/config
  // --------------------------------------------------------------------------

  describe('GET /api/embodiments/:tag/config', () => {
    it('returns parsed config for an embodiment', async () => {
      mockEmbodimentService.getEmbodiment.mockResolvedValue(MOCK_EMBODIMENT);
      mockEmbodimentService.parseYamlConfig.mockReturnValue({ name: 'so101', action_dim: 6 });

      const response = await request(app).get('/api/embodiments/so101/config');

      expect(response.status).toBe(200);
      expect(response.body.tag).toBe('so101');
      expect(response.body.config).toEqual({ name: 'so101', action_dim: 6 });
      expect(mockEmbodimentService.getEmbodiment).toHaveBeenCalledWith('so101');
      expect(mockEmbodimentService.parseYamlConfig).toHaveBeenCalledWith(MOCK_EMBODIMENT.configYaml);
    });

    it('returns 404 when embodiment not found', async () => {
      mockEmbodimentService.getEmbodiment.mockResolvedValue(null);

      const response = await request(app).get('/api/embodiments/missing/config');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Embodiment not found');
    });

    it('returns 500 when stored config cannot be parsed', async () => {
      mockEmbodimentService.getEmbodiment.mockResolvedValue(MOCK_EMBODIMENT);
      mockEmbodimentService.parseYamlConfig.mockReturnValue(null);

      const response = await request(app).get('/api/embodiments/so101/config');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to parse stored configuration');
    });

    it('returns 500 on service error', async () => {
      mockEmbodimentService.getEmbodiment.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/embodiments/so101/config');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('boom');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/embodiments/:tag
  // --------------------------------------------------------------------------

  describe('GET /api/embodiments/:tag', () => {
    it('returns an embodiment by tag', async () => {
      mockEmbodimentService.getEmbodiment.mockResolvedValue(MOCK_EMBODIMENT);

      const response = await request(app).get('/api/embodiments/so101');

      expect(response.status).toBe(200);
      expect(response.body.embodiment.tag).toBe('so101');
      expect(mockEmbodimentService.getEmbodiment).toHaveBeenCalledWith('so101');
    });

    it('returns 404 when embodiment not found', async () => {
      mockEmbodimentService.getEmbodiment.mockResolvedValue(null);

      const response = await request(app).get('/api/embodiments/missing');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Embodiment not found');
    });

    it('returns 500 on service error', async () => {
      mockEmbodimentService.getEmbodiment.mockRejectedValue(new Error('DB error'));

      const response = await request(app).get('/api/embodiments/so101');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('DB error');
    });
  });

  // --------------------------------------------------------------------------
  // PUT /api/embodiments/:tag
  // --------------------------------------------------------------------------

  describe('PUT /api/embodiments/:tag', () => {
    it('updates an embodiment successfully', async () => {
      const updated = { ...MOCK_EMBODIMENT, model: 'SO-ARM101' };
      mockEmbodimentService.updateEmbodiment.mockResolvedValue(updated);

      const response = await request(app)
        .put('/api/embodiments/so101')
        .send({ model: 'SO-ARM101' });

      expect(response.status).toBe(200);
      expect(response.body.embodiment.model).toBe('SO-ARM101');
      expect(response.body.message).toBe('Embodiment updated successfully');
      expect(mockEmbodimentService.updateEmbodiment).toHaveBeenCalledWith('so101', {
        model: 'SO-ARM101',
      });
    });

    it('returns 404 when embodiment not found', async () => {
      mockEmbodimentService.updateEmbodiment.mockResolvedValue(null);

      const response = await request(app)
        .put('/api/embodiments/missing')
        .send({ model: 'X' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Embodiment not found');
    });

    it('returns 400 when the service throws', async () => {
      mockEmbodimentService.updateEmbodiment.mockRejectedValue(new Error('Invalid YAML config'));

      const response = await request(app)
        .put('/api/embodiments/so101')
        .send({ configYaml: 'bad' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid YAML config');
    });
  });

  // --------------------------------------------------------------------------
  // DELETE /api/embodiments/:tag
  // --------------------------------------------------------------------------

  describe('DELETE /api/embodiments/:tag', () => {
    it('deletes an embodiment successfully', async () => {
      mockEmbodimentService.deleteEmbodiment.mockResolvedValue(true);

      const response = await request(app).delete('/api/embodiments/so101');

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Embodiment deleted successfully');
      expect(mockEmbodimentService.deleteEmbodiment).toHaveBeenCalledWith('so101');
    });

    it('returns 404 when embodiment not found', async () => {
      mockEmbodimentService.deleteEmbodiment.mockResolvedValue(false);

      const response = await request(app).delete('/api/embodiments/missing');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Embodiment not found');
    });

    it('returns 400 when the service throws', async () => {
      mockEmbodimentService.deleteEmbodiment.mockRejectedValue(new Error('FK constraint'));

      const response = await request(app).delete('/api/embodiments/so101');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('FK constraint');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/embodiments/validate
  // --------------------------------------------------------------------------

  describe('POST /api/embodiments/validate', () => {
    it('validates a YAML configuration', async () => {
      mockEmbodimentService.validateYamlConfig.mockReturnValue({
        valid: true,
        errors: [],
        parsedConfig: { name: 'so101' },
      });

      const response = await request(app)
        .post('/api/embodiments/validate')
        .send({ configYaml: 'name: so101\n' });

      expect(response.status).toBe(200);
      expect(response.body.valid).toBe(true);
      expect(response.body.errors).toEqual([]);
      expect(response.body.parsedConfig).toEqual({ name: 'so101' });
      expect(mockEmbodimentService.validateYamlConfig).toHaveBeenCalledWith('name: so101\n');
    });

    it('returns 400 when configYaml is missing', async () => {
      const response = await request(app).post('/api/embodiments/validate').send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('configYaml is required');
      expect(mockEmbodimentService.validateYamlConfig).not.toHaveBeenCalled();
    });

    it('returns 400 when the service throws', async () => {
      mockEmbodimentService.validateYamlConfig.mockImplementation(() => {
        throw new Error('parse failure');
      });

      const response = await request(app)
        .post('/api/embodiments/validate')
        .send({ configYaml: 'bad: : :' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('parse failure');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/embodiments/:tag/link
  // --------------------------------------------------------------------------

  describe('POST /api/embodiments/:tag/link', () => {
    it('links an embodiment to a robot type', async () => {
      const linked = { ...MOCK_EMBODIMENT, robotTypeId: 'rt-1' };
      mockEmbodimentService.linkToRobotType.mockResolvedValue(linked);

      const response = await request(app)
        .post('/api/embodiments/so101/link')
        .send({ robotTypeId: 'rt-1' });

      expect(response.status).toBe(200);
      expect(response.body.embodiment.robotTypeId).toBe('rt-1');
      expect(response.body.message).toBe('Embodiment linked to robot type successfully');
      expect(mockEmbodimentService.linkToRobotType).toHaveBeenCalledWith('so101', 'rt-1');
    });

    it('returns 400 when robotTypeId is missing', async () => {
      const response = await request(app).post('/api/embodiments/so101/link').send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('robotTypeId is required');
      expect(mockEmbodimentService.linkToRobotType).not.toHaveBeenCalled();
    });

    it('returns 400 when the service throws', async () => {
      mockEmbodimentService.linkToRobotType.mockRejectedValue(new Error('not found'));

      const response = await request(app)
        .post('/api/embodiments/so101/link')
        .send({ robotTypeId: 'rt-1' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('not found');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/embodiments/:tag/unlink
  // --------------------------------------------------------------------------

  describe('POST /api/embodiments/:tag/unlink', () => {
    it('unlinks an embodiment from a robot type', async () => {
      const unlinked = { ...MOCK_EMBODIMENT, robotTypeId: null };
      mockEmbodimentService.unlinkFromRobotType.mockResolvedValue(unlinked);

      const response = await request(app).post('/api/embodiments/so101/unlink');

      expect(response.status).toBe(200);
      expect(response.body.embodiment.robotTypeId).toBeNull();
      expect(response.body.message).toBe('Embodiment unlinked from robot type successfully');
      expect(mockEmbodimentService.unlinkFromRobotType).toHaveBeenCalledWith('so101');
    });

    it('returns 400 when the service throws', async () => {
      mockEmbodimentService.unlinkFromRobotType.mockRejectedValue(new Error('not found'));

      const response = await request(app).post('/api/embodiments/so101/unlink');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('not found');
    });
  });
});
