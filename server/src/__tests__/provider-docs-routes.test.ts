/**
 * @file provider-docs-routes.test.ts
 * @description Integration tests for AI provider documentation routes (EU AI Act compliance)
 * @feature compliance
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Use vi.hoisted so mock objects are available before vi.mock hoisting
const { mockProviderDocService } = vi.hoisted(() => ({
  mockProviderDocService: {
    getAllProviders: vi.fn(),
    getAllDocumentation: vi.fn(),
    getValidDocumentation: vi.fn(),
    getDocumentation: vi.fn(),
    getDocumentationByProvider: vi.fn(),
    getDocumentationByModel: vi.fn(),
    addDocumentation: vi.fn(),
    updateDocumentation: vi.fn(),
    deleteDocumentation: vi.fn(),
  },
}));

vi.mock('../services/ProviderDocumentationService.js', () => ({
  providerDocumentationService: mockProviderDocService,
}));

vi.mock('../middleware/auth.middleware.js', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-123', email: 'test@example.com', name: 'Test', role: 'admin' };
    next();
  },
  AuthenticatedRequest: {},
}));

import { providerDocsRoutes } from '../routes/provider-docs.routes.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

const BASE = '/api/compliance/providers';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(BASE, authMiddleware as any, providerDocsRoutes);
  return app;
}

const SAMPLE_DOC = {
  id: 'doc-001',
  providerName: 'Anthropic',
  modelVersion: 'opus-4-8',
  documentType: 'technical_doc',
  documentUrl: 'https://example.com/doc',
  content: 'Some content',
  validFrom: '2026-01-01T00:00:00.000Z',
  validTo: null,
};

describe('Provider Docs Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // --------------------------------------------------------------------------
  // GET / (list providers)
  // --------------------------------------------------------------------------

  describe('GET /', () => {
    it('returns all providers', async () => {
      const providers = [{ providerName: 'Anthropic', docCount: 2 }];
      mockProviderDocService.getAllProviders.mockResolvedValue(providers);

      const response = await request(app).get(BASE);

      expect(response.status).toBe(200);
      expect(response.body.providers).toEqual(providers);
      expect(mockProviderDocService.getAllProviders).toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockProviderDocService.getAllProviders.mockRejectedValue(new Error('DB error'));

      const response = await request(app).get(BASE);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch providers');
    });
  });

  // --------------------------------------------------------------------------
  // GET /docs (all documentation)
  // --------------------------------------------------------------------------

  describe('GET /docs', () => {
    it('returns all documentation', async () => {
      mockProviderDocService.getAllDocumentation.mockResolvedValue([SAMPLE_DOC]);

      const response = await request(app).get(`${BASE}/docs`);

      expect(response.status).toBe(200);
      expect(response.body.documentation).toHaveLength(1);
      expect(response.body.documentation[0].id).toBe('doc-001');
      expect(mockProviderDocService.getAllDocumentation).toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockProviderDocService.getAllDocumentation.mockRejectedValue(new Error('DB error'));

      const response = await request(app).get(`${BASE}/docs`);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch documentation');
    });
  });

  // --------------------------------------------------------------------------
  // GET /docs/valid (valid documentation)
  // --------------------------------------------------------------------------

  describe('GET /docs/valid', () => {
    it('returns valid documentation without filter', async () => {
      mockProviderDocService.getValidDocumentation.mockResolvedValue([SAMPLE_DOC]);

      const response = await request(app).get(`${BASE}/docs/valid`);

      expect(response.status).toBe(200);
      expect(response.body.documentation).toHaveLength(1);
      expect(mockProviderDocService.getValidDocumentation).toHaveBeenCalledWith(undefined);
    });

    it('passes providerName query param to the service', async () => {
      mockProviderDocService.getValidDocumentation.mockResolvedValue([]);

      const response = await request(app).get(`${BASE}/docs/valid?providerName=Anthropic`);

      expect(response.status).toBe(200);
      expect(mockProviderDocService.getValidDocumentation).toHaveBeenCalledWith('Anthropic');
    });

    it('returns 500 on service error', async () => {
      mockProviderDocService.getValidDocumentation.mockRejectedValue(new Error('DB error'));

      const response = await request(app).get(`${BASE}/docs/valid`);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch valid documentation');
    });
  });

  // --------------------------------------------------------------------------
  // GET /public/conformity (public conformity docs)
  // --------------------------------------------------------------------------

  describe('GET /public/conformity', () => {
    it('returns only conformity-type documents', async () => {
      const docs = [
        { ...SAMPLE_DOC, id: 'd1', documentType: 'eu_declaration_of_conformity' },
        { ...SAMPLE_DOC, id: 'd2', documentType: 'conformity_declaration' },
        { ...SAMPLE_DOC, id: 'd3', documentType: 'technical_doc' },
      ];
      mockProviderDocService.getValidDocumentation.mockResolvedValue(docs);

      const response = await request(app).get(`${BASE}/public/conformity`);

      expect(response.status).toBe(200);
      expect(response.body.count).toBe(2);
      expect(response.body.documents).toHaveLength(2);
      expect(response.body.documents.map((d: any) => d.id)).toEqual(['d1', 'd2']);
      expect(typeof response.body.generatedAt).toBe('string');
      expect(mockProviderDocService.getValidDocumentation).toHaveBeenCalledWith();
    });

    it('returns 500 on service error', async () => {
      mockProviderDocService.getValidDocumentation.mockRejectedValue(new Error('DB error'));

      const response = await request(app).get(`${BASE}/public/conformity`);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch conformity documents');
    });
  });

  // --------------------------------------------------------------------------
  // GET /docs/:id (by id)
  // --------------------------------------------------------------------------

  describe('GET /docs/:id', () => {
    it('returns a documentation by id', async () => {
      mockProviderDocService.getDocumentation.mockResolvedValue(SAMPLE_DOC);

      const response = await request(app).get(`${BASE}/docs/doc-001`);

      expect(response.status).toBe(200);
      expect(response.body.id).toBe('doc-001');
      expect(mockProviderDocService.getDocumentation).toHaveBeenCalledWith('doc-001');
    });

    it('returns 404 when documentation not found', async () => {
      mockProviderDocService.getDocumentation.mockResolvedValue(null);

      const response = await request(app).get(`${BASE}/docs/missing`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Documentation not found');
    });

    it('returns 500 on service error', async () => {
      mockProviderDocService.getDocumentation.mockRejectedValue(new Error('DB error'));

      const response = await request(app).get(`${BASE}/docs/doc-001`);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch documentation');
    });
  });

  // --------------------------------------------------------------------------
  // GET /:providerName/docs (by provider)
  // --------------------------------------------------------------------------

  describe('GET /:providerName/docs', () => {
    it('returns documentation for a provider', async () => {
      mockProviderDocService.getDocumentationByProvider.mockResolvedValue([SAMPLE_DOC]);

      const response = await request(app).get(`${BASE}/Anthropic/docs`);

      expect(response.status).toBe(200);
      expect(response.body.documentation).toHaveLength(1);
      expect(mockProviderDocService.getDocumentationByProvider).toHaveBeenCalledWith('Anthropic');
    });

    it('returns 500 on service error', async () => {
      mockProviderDocService.getDocumentationByProvider.mockRejectedValue(new Error('DB error'));

      const response = await request(app).get(`${BASE}/Anthropic/docs`);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch provider documentation');
    });
  });

  // --------------------------------------------------------------------------
  // GET /:providerName/:modelVersion/docs (by model)
  // --------------------------------------------------------------------------

  describe('GET /:providerName/:modelVersion/docs', () => {
    it('returns documentation for a specific model', async () => {
      mockProviderDocService.getDocumentationByModel.mockResolvedValue([SAMPLE_DOC]);

      const response = await request(app).get(`${BASE}/Anthropic/opus-4-8/docs`);

      expect(response.status).toBe(200);
      expect(response.body.documentation).toHaveLength(1);
      expect(mockProviderDocService.getDocumentationByModel).toHaveBeenCalledWith(
        'Anthropic',
        'opus-4-8',
      );
    });

    it('returns 500 on service error', async () => {
      mockProviderDocService.getDocumentationByModel.mockRejectedValue(new Error('DB error'));

      const response = await request(app).get(`${BASE}/Anthropic/opus-4-8/docs`);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch model documentation');
    });
  });

  // --------------------------------------------------------------------------
  // POST /docs (add documentation)
  // --------------------------------------------------------------------------

  describe('POST /docs', () => {
    const validBody = {
      providerName: 'Anthropic',
      modelVersion: 'opus-4-8',
      documentType: 'technical_doc',
      documentUrl: 'https://example.com/doc',
      content: 'Some content',
      validFrom: '2026-01-01T00:00:00.000Z',
      validTo: '2027-01-01T00:00:00.000Z',
    };

    it('creates documentation and returns 201', async () => {
      mockProviderDocService.addDocumentation.mockResolvedValue(SAMPLE_DOC);

      const response = await request(app).post(`${BASE}/docs`).send(validBody);

      expect(response.status).toBe(201);
      expect(response.body.id).toBe('doc-001');
      expect(mockProviderDocService.addDocumentation).toHaveBeenCalledTimes(1);
      const arg = mockProviderDocService.addDocumentation.mock.calls[0][0];
      expect(arg.providerName).toBe('Anthropic');
      expect(arg.modelVersion).toBe('opus-4-8');
      expect(arg.documentType).toBe('technical_doc');
      expect(arg.validFrom).toBeInstanceOf(Date);
      expect(arg.validTo).toBeInstanceOf(Date);
    });

    it('omits validTo when not provided', async () => {
      mockProviderDocService.addDocumentation.mockResolvedValue(SAMPLE_DOC);

      const { validTo, ...bodyNoValidTo } = validBody;
      const response = await request(app).post(`${BASE}/docs`).send(bodyNoValidTo);

      expect(response.status).toBe(201);
      const arg = mockProviderDocService.addDocumentation.mock.calls[0][0];
      expect(arg.validTo).toBeUndefined();
    });

    it('returns 400 when required fields are missing', async () => {
      const response = await request(app)
        .post(`${BASE}/docs`)
        .send({ providerName: 'Anthropic' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Missing required fields');
      expect(mockProviderDocService.addDocumentation).not.toHaveBeenCalled();
    });

    it('returns 400 for invalid documentType', async () => {
      const response = await request(app)
        .post(`${BASE}/docs`)
        .send({ ...validBody, documentType: 'not_a_real_type' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid documentType');
      expect(mockProviderDocService.addDocumentation).not.toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockProviderDocService.addDocumentation.mockRejectedValue(new Error('DB error'));

      const response = await request(app).post(`${BASE}/docs`).send(validBody);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to add documentation');
    });
  });

  // --------------------------------------------------------------------------
  // PUT /docs/:id (update documentation)
  // --------------------------------------------------------------------------

  describe('PUT /docs/:id', () => {
    it('updates documentation successfully', async () => {
      const updated = { ...SAMPLE_DOC, content: 'Updated content' };
      mockProviderDocService.updateDocumentation.mockResolvedValue(updated);

      const response = await request(app)
        .put(`${BASE}/docs/doc-001`)
        .send({ content: 'Updated content', validFrom: '2026-02-01T00:00:00.000Z' });

      expect(response.status).toBe(200);
      expect(response.body.content).toBe('Updated content');
      expect(mockProviderDocService.updateDocumentation).toHaveBeenCalledTimes(1);
      const [id, patch] = mockProviderDocService.updateDocumentation.mock.calls[0];
      expect(id).toBe('doc-001');
      expect(patch.content).toBe('Updated content');
      expect(patch.validFrom).toBeInstanceOf(Date);
      expect(patch.validTo).toBeUndefined();
    });

    it('returns 400 for invalid documentType', async () => {
      const response = await request(app)
        .put(`${BASE}/docs/doc-001`)
        .send({ documentType: 'bogus' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid documentType');
      expect(mockProviderDocService.updateDocumentation).not.toHaveBeenCalled();
    });

    it('returns 404 when documentation not found', async () => {
      mockProviderDocService.updateDocumentation.mockResolvedValue(null);

      const response = await request(app)
        .put(`${BASE}/docs/missing`)
        .send({ content: 'x' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Documentation not found');
    });

    it('returns 500 on service error', async () => {
      mockProviderDocService.updateDocumentation.mockRejectedValue(new Error('DB error'));

      const response = await request(app)
        .put(`${BASE}/docs/doc-001`)
        .send({ content: 'x' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to update documentation');
    });
  });

  // --------------------------------------------------------------------------
  // DELETE /docs/:id (delete documentation)
  // --------------------------------------------------------------------------

  describe('DELETE /docs/:id', () => {
    it('deletes documentation successfully', async () => {
      mockProviderDocService.deleteDocumentation.mockResolvedValue(true);

      const response = await request(app).delete(`${BASE}/docs/doc-001`);

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Documentation deleted successfully');
      expect(mockProviderDocService.deleteDocumentation).toHaveBeenCalledWith('doc-001');
    });

    it('returns 404 when documentation not found', async () => {
      mockProviderDocService.deleteDocumentation.mockResolvedValue(false);

      const response = await request(app).delete(`${BASE}/docs/missing`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Documentation not found');
    });

    it('returns 500 on service error', async () => {
      mockProviderDocService.deleteDocumentation.mockRejectedValue(new Error('DB error'));

      const response = await request(app).delete(`${BASE}/docs/doc-001`);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to delete documentation');
    });
  });
});
