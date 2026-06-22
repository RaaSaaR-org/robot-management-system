/**
 * @file ropa-routes.test.ts
 * @description Integration tests for Records of Processing Activities (RoPA) routes
 * @feature compliance
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Use vi.hoisted so mock objects are available before vi.mock hoisting
const { mockRopaService } = vi.hoisted(() => ({
  mockRopaService: {
    getAllEntries: vi.fn(),
    generateReport: vi.fn(),
    getEntry: vi.fn(),
    createEntry: vi.fn(),
    updateEntry: vi.fn(),
    deleteEntry: vi.fn(),
  },
}));

vi.mock('../services/RopaService.js', () => ({
  ropaService: mockRopaService,
}));

vi.mock('../middleware/auth.middleware.js', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-123', email: 'test@example.com', name: 'Test', role: 'admin' };
    next();
  },
  AuthenticatedRequest: {},
}));

import { ropaRoutes } from '../routes/ropa.routes.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/compliance/ropa', authMiddleware as any, ropaRoutes);
  return app;
}

const BASE = '/api/compliance/ropa';

const SAMPLE_ENTRY = {
  id: 'ropa-001',
  processingActivity: 'Robot telemetry collection',
  purpose: 'Fleet monitoring',
  dataCategories: ['telemetry', 'location'],
  dataSubjects: ['operators'],
  recipients: ['internal-ops'],
  thirdCountryTransfers: 'none',
  retentionPeriod: '90 days',
  securityMeasures: ['encryption', 'rbac'],
  legalBasis: 'legitimate-interest',
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
};

const VALID_CREATE_BODY = {
  processingActivity: 'Robot telemetry collection',
  purpose: 'Fleet monitoring',
  dataCategories: ['telemetry', 'location'],
  dataSubjects: ['operators'],
  recipients: ['internal-ops'],
  thirdCountryTransfers: 'none',
  retentionPeriod: '90 days',
  securityMeasures: ['encryption', 'rbac'],
  legalBasis: 'legitimate-interest',
};

describe('RoPA Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // --------------------------------------------------------------------------
  // GET /api/compliance/ropa
  // --------------------------------------------------------------------------

  describe('GET /', () => {
    it('returns all RoPA entries', async () => {
      mockRopaService.getAllEntries.mockResolvedValue([SAMPLE_ENTRY]);

      const response = await request(app).get(BASE);

      expect(response.status).toBe(200);
      expect(response.body.entries).toHaveLength(1);
      expect(response.body.entries[0].id).toBe('ropa-001');
      expect(mockRopaService.getAllEntries).toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockRopaService.getAllEntries.mockRejectedValue(new Error('DB error'));

      const response = await request(app).get(BASE);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch RoPA entries');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/compliance/ropa/report
  // --------------------------------------------------------------------------

  describe('GET /report', () => {
    it('generates a report with default organization name', async () => {
      const report = { organizationName: 'NeoDEM', entries: [SAMPLE_ENTRY] };
      mockRopaService.generateReport.mockResolvedValue(report);

      const response = await request(app).get(`${BASE}/report`);

      expect(response.status).toBe(200);
      expect(response.body.organizationName).toBe('NeoDEM');
      expect(mockRopaService.generateReport).toHaveBeenCalledWith('NeoDEM');
      expect(response.headers['content-disposition']).toContain('attachment');
      expect(response.headers['content-disposition']).toContain('ropa-report-');
    });

    it('uses provided organizationName query param', async () => {
      const report = { organizationName: 'ACME', entries: [] };
      mockRopaService.generateReport.mockResolvedValue(report);

      const response = await request(app).get(`${BASE}/report`).query({ organizationName: 'ACME' });

      expect(response.status).toBe(200);
      expect(mockRopaService.generateReport).toHaveBeenCalledWith('ACME');
    });

    it('returns 500 on service error', async () => {
      mockRopaService.generateReport.mockRejectedValue(new Error('boom'));

      const response = await request(app).get(`${BASE}/report`);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to generate RoPA report');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/compliance/ropa/:id
  // --------------------------------------------------------------------------

  describe('GET /:id', () => {
    it('returns a specific entry', async () => {
      mockRopaService.getEntry.mockResolvedValue(SAMPLE_ENTRY);

      const response = await request(app).get(`${BASE}/ropa-001`);

      expect(response.status).toBe(200);
      expect(response.body.id).toBe('ropa-001');
      expect(mockRopaService.getEntry).toHaveBeenCalledWith('ropa-001');
    });

    it('returns 404 when entry not found', async () => {
      mockRopaService.getEntry.mockResolvedValue(null);

      const response = await request(app).get(`${BASE}/missing`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('RoPA entry not found');
    });

    it('returns 500 on service error', async () => {
      mockRopaService.getEntry.mockRejectedValue(new Error('DB error'));

      const response = await request(app).get(`${BASE}/ropa-001`);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch RoPA entry');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/compliance/ropa
  // --------------------------------------------------------------------------

  describe('POST /', () => {
    it('creates a new entry', async () => {
      mockRopaService.createEntry.mockResolvedValue(SAMPLE_ENTRY);

      const response = await request(app).post(BASE).send(VALID_CREATE_BODY);

      expect(response.status).toBe(201);
      expect(response.body.id).toBe('ropa-001');
      expect(mockRopaService.createEntry).toHaveBeenCalledWith({
        processingActivity: VALID_CREATE_BODY.processingActivity,
        purpose: VALID_CREATE_BODY.purpose,
        dataCategories: VALID_CREATE_BODY.dataCategories,
        dataSubjects: VALID_CREATE_BODY.dataSubjects,
        recipients: VALID_CREATE_BODY.recipients,
        thirdCountryTransfers: VALID_CREATE_BODY.thirdCountryTransfers,
        retentionPeriod: VALID_CREATE_BODY.retentionPeriod,
        securityMeasures: VALID_CREATE_BODY.securityMeasures,
        legalBasis: VALID_CREATE_BODY.legalBasis,
      });
    });

    it('returns 400 when required fields are missing', async () => {
      const { purpose, ...partial } = VALID_CREATE_BODY;

      const response = await request(app).post(BASE).send(partial);

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Missing required fields');
      expect(mockRopaService.createEntry).not.toHaveBeenCalled();
    });

    it('returns 400 when array fields are not arrays', async () => {
      const response = await request(app)
        .post(BASE)
        .send({ ...VALID_CREATE_BODY, dataCategories: 'not-an-array' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('must be arrays');
      expect(mockRopaService.createEntry).not.toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockRopaService.createEntry.mockRejectedValue(new Error('DB error'));

      const response = await request(app).post(BASE).send(VALID_CREATE_BODY);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to create RoPA entry');
    });
  });

  // --------------------------------------------------------------------------
  // PUT /api/compliance/ropa/:id
  // --------------------------------------------------------------------------

  describe('PUT /:id', () => {
    it('updates an entry', async () => {
      const updated = { ...SAMPLE_ENTRY, purpose: 'Updated purpose' };
      mockRopaService.updateEntry.mockResolvedValue(updated);

      const response = await request(app)
        .put(`${BASE}/ropa-001`)
        .send({ purpose: 'Updated purpose' });

      expect(response.status).toBe(200);
      expect(response.body.purpose).toBe('Updated purpose');
      expect(mockRopaService.updateEntry).toHaveBeenCalledWith(
        'ropa-001',
        expect.objectContaining({ purpose: 'Updated purpose' }),
      );
    });

    it('returns 400 when dataCategories is not an array', async () => {
      const response = await request(app)
        .put(`${BASE}/ropa-001`)
        .send({ dataCategories: 'nope' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('dataCategories must be an array');
      expect(mockRopaService.updateEntry).not.toHaveBeenCalled();
    });

    it('returns 400 when dataSubjects is not an array', async () => {
      const response = await request(app)
        .put(`${BASE}/ropa-001`)
        .send({ dataSubjects: 'nope' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('dataSubjects must be an array');
    });

    it('returns 400 when recipients is not an array', async () => {
      const response = await request(app)
        .put(`${BASE}/ropa-001`)
        .send({ recipients: 'nope' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('recipients must be an array');
    });

    it('returns 400 when securityMeasures is not an array', async () => {
      const response = await request(app)
        .put(`${BASE}/ropa-001`)
        .send({ securityMeasures: 'nope' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('securityMeasures must be an array');
    });

    it('returns 404 when entry not found', async () => {
      mockRopaService.updateEntry.mockResolvedValue(null);

      const response = await request(app)
        .put(`${BASE}/missing`)
        .send({ purpose: 'x' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('RoPA entry not found');
    });

    it('returns 500 on service error', async () => {
      mockRopaService.updateEntry.mockRejectedValue(new Error('DB error'));

      const response = await request(app)
        .put(`${BASE}/ropa-001`)
        .send({ purpose: 'x' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to update RoPA entry');
    });
  });

  // --------------------------------------------------------------------------
  // DELETE /api/compliance/ropa/:id
  // --------------------------------------------------------------------------

  describe('DELETE /:id', () => {
    it('deletes an entry', async () => {
      mockRopaService.deleteEntry.mockResolvedValue(true);

      const response = await request(app).delete(`${BASE}/ropa-001`);

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('RoPA entry deleted successfully');
      expect(mockRopaService.deleteEntry).toHaveBeenCalledWith('ropa-001');
    });

    it('returns 404 when entry not found', async () => {
      mockRopaService.deleteEntry.mockResolvedValue(false);

      const response = await request(app).delete(`${BASE}/missing`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('RoPA entry not found');
    });

    it('returns 500 on service error', async () => {
      mockRopaService.deleteEntry.mockRejectedValue(new Error('DB error'));

      const response = await request(app).delete(`${BASE}/ropa-001`);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to delete RoPA entry');
    });
  });
});
