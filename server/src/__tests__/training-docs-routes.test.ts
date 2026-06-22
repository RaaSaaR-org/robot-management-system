/**
 * @file training-docs-routes.test.ts
 * @description Integration tests for EU AI Act training data documentation routes
 * @feature compliance
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Use vi.hoisted so mock objects are available before vi.mock hoisting
const { mockTrainingDataDocService } = vi.hoisted(() => ({
  mockTrainingDataDocService: {
    recordProvenance: vi.fn(),
    getProvenance: vi.fn(),
    listProvenance: vi.fn(),
    generateSummary: vi.fn(),
    getSummary: vi.fn(),
    updateSummary: vi.fn(),
    generatePdfBuffer: vi.fn(),
    exportDocumentation: vi.fn(),
    getSummariesDue: vi.fn(),
    createBiasAssessment: vi.fn(),
    getBiasAssessment: vi.fn(),
    getBiasAssessmentHistory: vi.fn(),
    updateBiasAssessment: vi.fn(),
  },
}));

vi.mock('../services/TrainingDataDocService.js', () => ({
  trainingDataDocService: mockTrainingDataDocService,
}));

vi.mock('../middleware/auth.middleware.js', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-123', email: 'test@example.com', name: 'Test', role: 'admin' };
    next();
  },
  AuthenticatedRequest: {},
}));

import { trainingDocsRoutes } from '../routes/training-docs.routes.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/training-docs', authMiddleware as any, trainingDocsRoutes);
  return app;
}

describe('Training Docs Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // --------------------------------------------------------------------------
  // POST /api/training-docs/datasets/:id/provenance
  // --------------------------------------------------------------------------

  describe('POST /api/training-docs/datasets/:id/provenance', () => {
    it('records provenance successfully', async () => {
      const provenance = { id: 'prov-1', datasetId: 'ds-1', sourceType: 'collected' };
      mockTrainingDataDocService.recordProvenance.mockResolvedValue(provenance);

      const response = await request(app)
        .post('/api/training-docs/datasets/ds-1/provenance')
        .send({ sourceType: 'collected', notes: 'in-house' });

      expect(response.status).toBe(200);
      expect(response.body.provenance.id).toBe('prov-1');
      expect(response.body.message).toBe('Provenance recorded successfully');
      expect(mockTrainingDataDocService.recordProvenance).toHaveBeenCalledWith(
        'ds-1',
        { sourceType: 'collected', notes: 'in-house' },
        'user-123'
      );
    });

    it('returns 400 when sourceType is missing', async () => {
      const response = await request(app)
        .post('/api/training-docs/datasets/ds-1/provenance')
        .send({ notes: 'no source' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('sourceType is required');
      expect(mockTrainingDataDocService.recordProvenance).not.toHaveBeenCalled();
    });

    it('returns 400 for invalid sourceType', async () => {
      const response = await request(app)
        .post('/api/training-docs/datasets/ds-1/provenance')
        .send({ sourceType: 'bogus' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid sourceType');
      expect(mockTrainingDataDocService.recordProvenance).not.toHaveBeenCalled();
    });

    it('returns 400 on service error', async () => {
      mockTrainingDataDocService.recordProvenance.mockRejectedValue(new Error('db boom'));

      const response = await request(app)
        .post('/api/training-docs/datasets/ds-1/provenance')
        .send({ sourceType: 'synthetic' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('db boom');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/training-docs/datasets/:id/provenance
  // --------------------------------------------------------------------------

  describe('GET /api/training-docs/datasets/:id/provenance', () => {
    it('returns provenance', async () => {
      mockTrainingDataDocService.getProvenance.mockResolvedValue({ id: 'prov-1' });

      const response = await request(app).get('/api/training-docs/datasets/ds-1/provenance');

      expect(response.status).toBe(200);
      expect(response.body.provenance.id).toBe('prov-1');
      expect(mockTrainingDataDocService.getProvenance).toHaveBeenCalledWith('ds-1');
    });

    it('returns 404 when not found', async () => {
      mockTrainingDataDocService.getProvenance.mockResolvedValue(null);

      const response = await request(app).get('/api/training-docs/datasets/ds-1/provenance');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Provenance not found');
    });

    it('returns 500 on service error', async () => {
      mockTrainingDataDocService.getProvenance.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/training-docs/datasets/ds-1/provenance');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get provenance');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/training-docs/provenance
  // --------------------------------------------------------------------------

  describe('GET /api/training-docs/provenance', () => {
    it('lists provenance records', async () => {
      mockTrainingDataDocService.listProvenance.mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]);

      const response = await request(app).get('/api/training-docs/provenance');

      expect(response.status).toBe(200);
      expect(response.body.total).toBe(2);
      expect(response.body.provenance).toHaveLength(2);
      expect(mockTrainingDataDocService.listProvenance).toHaveBeenCalledWith(undefined);
    });

    it('passes sourceType filter from query', async () => {
      mockTrainingDataDocService.listProvenance.mockResolvedValue([{ id: 'p1' }]);

      const response = await request(app).get(
        '/api/training-docs/provenance?sourceType=synthetic'
      );

      expect(response.status).toBe(200);
      expect(mockTrainingDataDocService.listProvenance).toHaveBeenCalledWith('synthetic');
    });

    it('returns 500 on service error', async () => {
      mockTrainingDataDocService.listProvenance.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/training-docs/provenance');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to list provenance');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/training-docs/models/:id/summary
  // --------------------------------------------------------------------------

  describe('POST /api/training-docs/models/:id/summary', () => {
    const validBody = {
      datasetIds: ['ds-1'],
      copyrightMeasures: 'opt-out honored',
      processingPurposes: ['training'],
    };

    it('generates summary successfully', async () => {
      mockTrainingDataDocService.generateSummary.mockResolvedValue({ id: 'sum-1' });

      const response = await request(app)
        .post('/api/training-docs/models/mv-1/summary')
        .send(validBody);

      expect(response.status).toBe(201);
      expect(response.body.summary.id).toBe('sum-1');
      expect(response.body.message).toBe('Training data summary generated successfully');
      expect(mockTrainingDataDocService.generateSummary).toHaveBeenCalledWith(
        'mv-1',
        validBody,
        'user-123'
      );
    });

    it('returns 400 when datasetIds missing', async () => {
      const response = await request(app)
        .post('/api/training-docs/models/mv-1/summary')
        .send({ copyrightMeasures: 'x', processingPurposes: ['training'] });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('datasetIds array is required');
    });

    it('returns 400 when datasetIds empty', async () => {
      const response = await request(app)
        .post('/api/training-docs/models/mv-1/summary')
        .send({ ...validBody, datasetIds: [] });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('datasetIds array is required');
    });

    it('returns 400 when copyrightMeasures missing', async () => {
      const response = await request(app)
        .post('/api/training-docs/models/mv-1/summary')
        .send({ datasetIds: ['ds-1'], processingPurposes: ['training'] });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('copyrightMeasures is required');
    });

    it('returns 400 when processingPurposes missing', async () => {
      const response = await request(app)
        .post('/api/training-docs/models/mv-1/summary')
        .send({ datasetIds: ['ds-1'], copyrightMeasures: 'x' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('processingPurposes array is required');
    });

    it('returns 400 on service error', async () => {
      mockTrainingDataDocService.generateSummary.mockRejectedValue(new Error('gen failed'));

      const response = await request(app)
        .post('/api/training-docs/models/mv-1/summary')
        .send(validBody);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('gen failed');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/training-docs/models/:id/summary
  // --------------------------------------------------------------------------

  describe('GET /api/training-docs/models/:id/summary', () => {
    it('returns summary', async () => {
      mockTrainingDataDocService.getSummary.mockResolvedValue({ id: 'sum-1' });

      const response = await request(app).get('/api/training-docs/models/mv-1/summary');

      expect(response.status).toBe(200);
      expect(response.body.summary.id).toBe('sum-1');
      expect(mockTrainingDataDocService.getSummary).toHaveBeenCalledWith('mv-1');
    });

    it('returns 404 when not found', async () => {
      mockTrainingDataDocService.getSummary.mockResolvedValue(null);

      const response = await request(app).get('/api/training-docs/models/mv-1/summary');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Summary not found');
    });

    it('returns 500 on service error', async () => {
      mockTrainingDataDocService.getSummary.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/training-docs/models/mv-1/summary');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get summary');
    });
  });

  // --------------------------------------------------------------------------
  // PUT /api/training-docs/models/:id/summary
  // --------------------------------------------------------------------------

  describe('PUT /api/training-docs/models/:id/summary', () => {
    it('updates summary successfully', async () => {
      mockTrainingDataDocService.updateSummary.mockResolvedValue({ id: 'sum-1', updated: true });

      const response = await request(app)
        .put('/api/training-docs/models/mv-1/summary')
        .send({ copyrightMeasures: 'updated' });

      expect(response.status).toBe(200);
      expect(response.body.summary.updated).toBe(true);
      expect(response.body.message).toBe('Summary updated successfully');
      expect(mockTrainingDataDocService.updateSummary).toHaveBeenCalledWith('mv-1', {
        copyrightMeasures: 'updated',
      });
    });

    it('returns 400 on service error', async () => {
      mockTrainingDataDocService.updateSummary.mockRejectedValue(new Error('update failed'));

      const response = await request(app)
        .put('/api/training-docs/models/mv-1/summary')
        .send({ copyrightMeasures: 'x' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('update failed');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/training-docs/models/:id/summary/export
  // --------------------------------------------------------------------------

  describe('GET /api/training-docs/models/:id/summary/export', () => {
    it('exports markdown by default', async () => {
      mockTrainingDataDocService.exportDocumentation.mockResolvedValue({
        filename: 'doc.md',
        content: '# Doc',
      });

      const response = await request(app).get(
        '/api/training-docs/models/mv-1/summary/export'
      );

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('text/markdown');
      expect(response.headers['content-disposition']).toContain('doc.md');
      expect(response.text).toBe('# Doc');
      expect(mockTrainingDataDocService.exportDocumentation).toHaveBeenCalledWith(
        'mv-1',
        'markdown',
        true,
        true
      );
    });

    it('exports json with includeProvenance/includeBiasAssessment=false', async () => {
      mockTrainingDataDocService.exportDocumentation.mockResolvedValue({
        filename: 'doc.json',
        content: '{"a":1}',
      });

      const response = await request(app).get(
        '/api/training-docs/models/mv-1/summary/export?format=json&includeProvenance=false&includeBiasAssessment=false'
      );

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('application/json');
      expect(mockTrainingDataDocService.exportDocumentation).toHaveBeenCalledWith(
        'mv-1',
        'json',
        false,
        false
      );
    });

    it('exports pdf via dedicated buffer path', async () => {
      mockTrainingDataDocService.generatePdfBuffer.mockResolvedValue(
        Buffer.from('%PDF-1.4 test')
      );

      const response = await request(app).get(
        '/api/training-docs/models/mv-1/summary/export?format=pdf'
      );

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('application/pdf');
      expect(response.headers['content-disposition']).toContain(
        'training-docs-mv-1.pdf'
      );
      expect(mockTrainingDataDocService.generatePdfBuffer).toHaveBeenCalledWith(
        'mv-1',
        true,
        true
      );
      expect(mockTrainingDataDocService.exportDocumentation).not.toHaveBeenCalled();
    });

    it('returns 400 on service error', async () => {
      mockTrainingDataDocService.exportDocumentation.mockRejectedValue(
        new Error('export failed')
      );

      const response = await request(app).get(
        '/api/training-docs/models/mv-1/summary/export'
      );

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('export failed');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/training-docs/updates-due
  // --------------------------------------------------------------------------

  describe('GET /api/training-docs/updates-due', () => {
    it('returns summaries due with parsed query params', async () => {
      mockTrainingDataDocService.getSummariesDue.mockResolvedValue({
        summaries: [{ id: 's1' }],
        total: 1,
      });

      const response = await request(app).get(
        '/api/training-docs/updates-due?daysAhead=30&page=2&limit=10'
      );

      expect(response.status).toBe(200);
      expect(response.body.total).toBe(1);
      expect(mockTrainingDataDocService.getSummariesDue).toHaveBeenCalledWith({
        daysAhead: 30,
        page: 2,
        limit: 10,
      });
    });

    it('returns summaries due with undefined params when query empty', async () => {
      mockTrainingDataDocService.getSummariesDue.mockResolvedValue({ summaries: [], total: 0 });

      const response = await request(app).get('/api/training-docs/updates-due');

      expect(response.status).toBe(200);
      expect(mockTrainingDataDocService.getSummariesDue).toHaveBeenCalledWith({
        daysAhead: undefined,
        page: undefined,
        limit: undefined,
      });
    });

    it('returns 500 on service error', async () => {
      mockTrainingDataDocService.getSummariesDue.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/training-docs/updates-due');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get updates due');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/training-docs/models/:id/bias-assessment
  // --------------------------------------------------------------------------

  describe('POST /api/training-docs/models/:id/bias-assessment', () => {
    const validBody = {
      demographicCoverage: { region: 'EU' },
      knownLimitations: ['limited night data'],
      potentialBiasSources: ['lighting'],
      mitigationMeasures: ['augmentation'],
    };

    it('creates bias assessment successfully', async () => {
      mockTrainingDataDocService.createBiasAssessment.mockResolvedValue({ id: 'ba-1' });

      const response = await request(app)
        .post('/api/training-docs/models/mv-1/bias-assessment')
        .send(validBody);

      expect(response.status).toBe(201);
      expect(response.body.assessment.id).toBe('ba-1');
      expect(response.body.message).toBe('Bias assessment created successfully');
      expect(mockTrainingDataDocService.createBiasAssessment).toHaveBeenCalledWith(
        'mv-1',
        validBody,
        'user-123'
      );
    });

    it('returns 400 when demographicCoverage missing', async () => {
      const response = await request(app)
        .post('/api/training-docs/models/mv-1/bias-assessment')
        .send({ ...validBody, demographicCoverage: undefined });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('demographicCoverage object is required');
    });

    it('returns 400 when knownLimitations not an array', async () => {
      const response = await request(app)
        .post('/api/training-docs/models/mv-1/bias-assessment')
        .send({ ...validBody, knownLimitations: 'nope' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('knownLimitations array is required');
    });

    it('returns 400 when potentialBiasSources not an array', async () => {
      const response = await request(app)
        .post('/api/training-docs/models/mv-1/bias-assessment')
        .send({ ...validBody, potentialBiasSources: 'nope' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('potentialBiasSources array is required');
    });

    it('returns 400 when mitigationMeasures not an array', async () => {
      const response = await request(app)
        .post('/api/training-docs/models/mv-1/bias-assessment')
        .send({ ...validBody, mitigationMeasures: 'nope' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('mitigationMeasures array is required');
    });

    it('returns 400 on service error', async () => {
      mockTrainingDataDocService.createBiasAssessment.mockRejectedValue(
        new Error('create failed')
      );

      const response = await request(app)
        .post('/api/training-docs/models/mv-1/bias-assessment')
        .send(validBody);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('create failed');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/training-docs/models/:id/bias-assessment
  // --------------------------------------------------------------------------

  describe('GET /api/training-docs/models/:id/bias-assessment', () => {
    it('returns latest bias assessment', async () => {
      mockTrainingDataDocService.getBiasAssessment.mockResolvedValue({ id: 'ba-1' });

      const response = await request(app).get(
        '/api/training-docs/models/mv-1/bias-assessment'
      );

      expect(response.status).toBe(200);
      expect(response.body.assessment.id).toBe('ba-1');
      expect(mockTrainingDataDocService.getBiasAssessment).toHaveBeenCalledWith('mv-1');
    });

    it('returns 404 when not found', async () => {
      mockTrainingDataDocService.getBiasAssessment.mockResolvedValue(null);

      const response = await request(app).get(
        '/api/training-docs/models/mv-1/bias-assessment'
      );

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Bias assessment not found');
    });

    it('returns 500 on service error', async () => {
      mockTrainingDataDocService.getBiasAssessment.mockRejectedValue(new Error('boom'));

      const response = await request(app).get(
        '/api/training-docs/models/mv-1/bias-assessment'
      );

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get bias assessment');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/training-docs/models/:id/bias-assessment/history
  // --------------------------------------------------------------------------

  describe('GET /api/training-docs/models/:id/bias-assessment/history', () => {
    it('returns bias assessment history', async () => {
      mockTrainingDataDocService.getBiasAssessmentHistory.mockResolvedValue([
        { id: 'ba-1' },
        { id: 'ba-2' },
      ]);

      const response = await request(app).get(
        '/api/training-docs/models/mv-1/bias-assessment/history'
      );

      expect(response.status).toBe(200);
      expect(response.body.total).toBe(2);
      expect(response.body.assessments).toHaveLength(2);
      expect(mockTrainingDataDocService.getBiasAssessmentHistory).toHaveBeenCalledWith('mv-1');
    });

    it('returns 500 on service error', async () => {
      mockTrainingDataDocService.getBiasAssessmentHistory.mockRejectedValue(new Error('boom'));

      const response = await request(app).get(
        '/api/training-docs/models/mv-1/bias-assessment/history'
      );

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get bias assessment history');
    });
  });

  // --------------------------------------------------------------------------
  // PUT /api/training-docs/bias-assessments/:id
  // --------------------------------------------------------------------------

  describe('PUT /api/training-docs/bias-assessments/:id', () => {
    it('updates bias assessment successfully', async () => {
      mockTrainingDataDocService.updateBiasAssessment.mockResolvedValue({
        id: 'ba-1',
        updated: true,
      });

      const response = await request(app)
        .put('/api/training-docs/bias-assessments/ba-1')
        .send({ knownLimitations: ['new'] });

      expect(response.status).toBe(200);
      expect(response.body.assessment.updated).toBe(true);
      expect(response.body.message).toBe('Bias assessment updated successfully');
      expect(mockTrainingDataDocService.updateBiasAssessment).toHaveBeenCalledWith(
        'ba-1',
        { knownLimitations: ['new'] },
        'user-123'
      );
    });

    it('returns 400 on service error', async () => {
      mockTrainingDataDocService.updateBiasAssessment.mockRejectedValue(
        new Error('update failed')
      );

      const response = await request(app)
        .put('/api/training-docs/bias-assessments/ba-1')
        .send({ knownLimitations: ['new'] });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('update failed');
    });
  });
});
