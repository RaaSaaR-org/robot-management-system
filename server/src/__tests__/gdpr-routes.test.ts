/**
 * @file gdpr-routes.test.ts
 * @description Integration tests for GDPR data subject rights routes (Articles 15-22)
 * @feature gdpr
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Use vi.hoisted so mock objects are available before vi.mock hoisting
const { mockGdprRequestService, mockConsentService, mockDataRestrictionService } = vi.hoisted(() => ({
  mockGdprRequestService: {
    createAccessRequest: vi.fn(),
    createRectificationRequest: vi.fn(),
    createErasureRequest: vi.fn(),
    createRestrictionRequest: vi.fn(),
    createPortabilityRequest: vi.fn(),
    createObjectionRequest: vi.fn(),
    createADMReviewRequest: vi.fn(),
    getUserRequests: vi.fn(),
    getRequest: vi.fn(),
    getStatusHistory: vi.fn(),
    cancelRequest: vi.fn(),
    verifyRequest: vi.fn(),
    getAllRequests: vi.fn(),
    acknowledgeRequest: vi.fn(),
    startProcessing: vi.fn(),
    completeRequest: vi.fn(),
    rejectRequest: vi.fn(),
    executeErasure: vi.fn(),
    generateDataExport: vi.fn(),
    getMetrics: vi.fn(),
    getSLAReport: vi.fn(),
    getOverdueRequests: vi.fn(),
    getRequestsNearingSLA: vi.fn(),
  },
  mockConsentService: {
    getUserConsents: vi.fn(),
    updateConsent: vi.fn(),
    updateMultipleConsents: vi.fn(),
    revokeConsent: vi.fn(),
    getConsentMetrics: vi.fn(),
  },
  mockDataRestrictionService: {
    getRestrictionStats: vi.fn(),
    getActiveRestrictions: vi.fn(),
    liftRestriction: vi.fn(),
  },
}));

vi.mock('../services/GDPRRequestService.js', () => ({
  gdprRequestService: mockGdprRequestService,
}));

vi.mock('../services/ConsentService.js', () => ({
  consentService: mockConsentService,
}));

vi.mock('../services/DataRestrictionService.js', () => ({
  dataRestrictionService: mockDataRestrictionService,
}));

vi.mock('../middleware/auth.middleware.js', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-123', email: 'test@example.com', name: 'Test', role: 'admin' };
    next();
  },
  AuthenticatedRequest: {},
}));

import { gdprRoutes } from '../routes/gdpr.routes.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/gdpr', authMiddleware as any, gdprRoutes);
  return app;
}

const SAMPLE_REQUEST = {
  id: 'req-001',
  userId: 'user-123',
  requestType: 'access',
  status: 'pending',
};

describe('GDPR Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // --------------------------------------------------------------------------
  // POST /api/gdpr/requests/access
  // --------------------------------------------------------------------------

  describe('POST /api/gdpr/requests/access', () => {
    it('creates an access request with defaults', async () => {
      mockGdprRequestService.createAccessRequest.mockResolvedValue(SAMPLE_REQUEST);

      const response = await request(app)
        .post('/api/gdpr/requests/access')
        .send({ userId: 'user-9' });

      expect(response.status).toBe(201);
      expect(response.body.id).toBe('req-001');
      expect(mockGdprRequestService.createAccessRequest).toHaveBeenCalledWith('user-9', {
        format: 'json',
        includeMetadata: true,
      });
    });

    it('returns 500 on service error', async () => {
      mockGdprRequestService.createAccessRequest.mockRejectedValue(new Error('DB error'));

      const response = await request(app).post('/api/gdpr/requests/access').send({});

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to create access request');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/gdpr/requests/rectification
  // --------------------------------------------------------------------------

  describe('POST /api/gdpr/requests/rectification', () => {
    it('creates a rectification request', async () => {
      mockGdprRequestService.createRectificationRequest.mockResolvedValue(SAMPLE_REQUEST);
      const fields = [{ field: 'name', currentValue: 'a', newValue: 'b', reason: 'typo' }];

      const response = await request(app)
        .post('/api/gdpr/requests/rectification')
        .send({ userId: 'user-9', fields });

      expect(response.status).toBe(201);
      expect(mockGdprRequestService.createRectificationRequest).toHaveBeenCalledWith('user-9', {
        fields,
      });
    });

    it('returns 400 when fields is missing', async () => {
      const response = await request(app)
        .post('/api/gdpr/requests/rectification')
        .send({ userId: 'user-9' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('fields is required');
    });

    it('returns 400 when fields is an empty array', async () => {
      const response = await request(app)
        .post('/api/gdpr/requests/rectification')
        .send({ fields: [] });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('fields is required');
    });

    it('returns 500 on service error', async () => {
      mockGdprRequestService.createRectificationRequest.mockRejectedValue(new Error('boom'));

      const response = await request(app)
        .post('/api/gdpr/requests/rectification')
        .send({ fields: [{ field: 'x' }] });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to create rectification request');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/gdpr/requests/erasure
  // --------------------------------------------------------------------------

  describe('POST /api/gdpr/requests/erasure', () => {
    it('creates an erasure request and appends a verification message', async () => {
      mockGdprRequestService.createErasureRequest.mockResolvedValue({ ...SAMPLE_REQUEST, requestType: 'erasure' });

      const response = await request(app)
        .post('/api/gdpr/requests/erasure')
        .send({ userId: 'user-9', reason: 'no longer needed', scope: 'all' });

      expect(response.status).toBe(201);
      expect(response.body.message).toContain('Verification email');
      expect(response.body.id).toBe('req-001');
      expect(mockGdprRequestService.createErasureRequest).toHaveBeenCalledWith('user-9', {
        reason: 'no longer needed',
        scope: 'all',
        specificData: undefined,
      });
    });

    it('returns 400 on service error', async () => {
      mockGdprRequestService.createErasureRequest.mockRejectedValue(new Error('not allowed'));

      const response = await request(app).post('/api/gdpr/requests/erasure').send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('not allowed');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/gdpr/requests/restriction
  // --------------------------------------------------------------------------

  describe('POST /api/gdpr/requests/restriction', () => {
    it('creates a restriction request', async () => {
      mockGdprRequestService.createRestrictionRequest.mockResolvedValue(SAMPLE_REQUEST);

      const response = await request(app)
        .post('/api/gdpr/requests/restriction')
        .send({ userId: 'user-9', scope: 'all', reason: 'accuracy_disputed', details: 'x' });

      expect(response.status).toBe(201);
      expect(mockGdprRequestService.createRestrictionRequest).toHaveBeenCalledWith('user-9', {
        scope: 'all',
        reason: 'accuracy_disputed',
        details: 'x',
      });
    });

    it('returns 400 for invalid scope', async () => {
      const response = await request(app)
        .post('/api/gdpr/requests/restriction')
        .send({ scope: 'invalid', reason: 'accuracy_disputed' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('scope is required');
    });

    it('returns 400 for invalid reason', async () => {
      const response = await request(app)
        .post('/api/gdpr/requests/restriction')
        .send({ scope: 'all', reason: 'invalid' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('reason is required');
    });

    it('returns 500 on service error', async () => {
      mockGdprRequestService.createRestrictionRequest.mockRejectedValue(new Error('boom'));

      const response = await request(app)
        .post('/api/gdpr/requests/restriction')
        .send({ scope: 'all', reason: 'accuracy_disputed' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to create restriction request');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/gdpr/requests/portability
  // --------------------------------------------------------------------------

  describe('POST /api/gdpr/requests/portability', () => {
    it('creates a portability request', async () => {
      mockGdprRequestService.createPortabilityRequest.mockResolvedValue(SAMPLE_REQUEST);

      const response = await request(app)
        .post('/api/gdpr/requests/portability')
        .send({ userId: 'user-9', format: 'csv', dataCategories: ['profile'] });

      expect(response.status).toBe(201);
      expect(mockGdprRequestService.createPortabilityRequest).toHaveBeenCalledWith('user-9', {
        format: 'csv',
        dataCategories: ['profile'],
      });
    });

    it('returns 400 for invalid format', async () => {
      const response = await request(app)
        .post('/api/gdpr/requests/portability')
        .send({ format: 'xml' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('format must be');
    });

    it('returns 500 on service error', async () => {
      mockGdprRequestService.createPortabilityRequest.mockRejectedValue(new Error('boom'));

      const response = await request(app)
        .post('/api/gdpr/requests/portability')
        .send({ format: 'json' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to create portability request');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/gdpr/requests/objection
  // --------------------------------------------------------------------------

  describe('POST /api/gdpr/requests/objection', () => {
    it('creates an objection request', async () => {
      mockGdprRequestService.createObjectionRequest.mockResolvedValue(SAMPLE_REQUEST);

      const response = await request(app)
        .post('/api/gdpr/requests/objection')
        .send({ userId: 'user-9', processingActivity: 'marketing', reason: 'no consent', details: 'd' });

      expect(response.status).toBe(201);
      expect(mockGdprRequestService.createObjectionRequest).toHaveBeenCalledWith('user-9', {
        processingActivity: 'marketing',
        reason: 'no consent',
        details: 'd',
      });
    });

    it('returns 400 when processingActivity missing', async () => {
      const response = await request(app)
        .post('/api/gdpr/requests/objection')
        .send({ reason: 'no consent' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('processingActivity is required');
    });

    it('returns 400 when reason missing', async () => {
      const response = await request(app)
        .post('/api/gdpr/requests/objection')
        .send({ processingActivity: 'marketing' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('reason is required');
    });

    it('returns 500 on service error', async () => {
      mockGdprRequestService.createObjectionRequest.mockRejectedValue(new Error('boom'));

      const response = await request(app)
        .post('/api/gdpr/requests/objection')
        .send({ processingActivity: 'marketing', reason: 'no consent' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to create objection request');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/gdpr/requests/adm-review
  // --------------------------------------------------------------------------

  describe('POST /api/gdpr/requests/adm-review', () => {
    it('creates an ADM review request', async () => {
      mockGdprRequestService.createADMReviewRequest.mockResolvedValue(SAMPLE_REQUEST);

      const response = await request(app)
        .post('/api/gdpr/requests/adm-review')
        .send({ userId: 'user-9', decisionId: 'dec-1', contestReason: 'unfair', evidence: 'e' });

      expect(response.status).toBe(201);
      expect(mockGdprRequestService.createADMReviewRequest).toHaveBeenCalledWith('user-9', {
        decisionId: 'dec-1',
        contestReason: 'unfair',
        evidence: 'e',
      });
    });

    it('returns 400 when decisionId missing', async () => {
      const response = await request(app)
        .post('/api/gdpr/requests/adm-review')
        .send({ contestReason: 'unfair' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('decisionId is required');
    });

    it('returns 400 when contestReason missing', async () => {
      const response = await request(app)
        .post('/api/gdpr/requests/adm-review')
        .send({ decisionId: 'dec-1' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('contestReason is required');
    });

    it('returns 400 on service error (message passthrough)', async () => {
      mockGdprRequestService.createADMReviewRequest.mockRejectedValue(new Error('queue full'));

      const response = await request(app)
        .post('/api/gdpr/requests/adm-review')
        .send({ decisionId: 'dec-1', contestReason: 'unfair' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('queue full');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/gdpr/requests
  // --------------------------------------------------------------------------

  describe('GET /api/gdpr/requests', () => {
    it('lists user requests', async () => {
      mockGdprRequestService.getUserRequests.mockResolvedValue([SAMPLE_REQUEST]);

      const response = await request(app).get('/api/gdpr/requests?userId=user-9');

      expect(response.status).toBe(200);
      expect(response.body.requests).toHaveLength(1);
      expect(mockGdprRequestService.getUserRequests).toHaveBeenCalledWith('user-9');
    });

    it('defaults to current-user when no userId', async () => {
      mockGdprRequestService.getUserRequests.mockResolvedValue([]);

      const response = await request(app).get('/api/gdpr/requests');

      expect(response.status).toBe(200);
      expect(mockGdprRequestService.getUserRequests).toHaveBeenCalledWith('current-user');
    });

    it('returns 500 on service error', async () => {
      mockGdprRequestService.getUserRequests.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/gdpr/requests');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch requests');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/gdpr/requests/:id
  // --------------------------------------------------------------------------

  describe('GET /api/gdpr/requests/:id', () => {
    it('returns request with history', async () => {
      mockGdprRequestService.getRequest.mockResolvedValue(SAMPLE_REQUEST);
      mockGdprRequestService.getStatusHistory.mockResolvedValue([{ id: 'h1' }]);

      const response = await request(app).get('/api/gdpr/requests/req-001');

      expect(response.status).toBe(200);
      expect(response.body.request.id).toBe('req-001');
      expect(response.body.history).toHaveLength(1);
      expect(mockGdprRequestService.getRequest).toHaveBeenCalledWith('req-001');
      expect(mockGdprRequestService.getStatusHistory).toHaveBeenCalledWith('req-001');
    });

    it('returns 404 when request not found', async () => {
      mockGdprRequestService.getRequest.mockResolvedValue(null);

      const response = await request(app).get('/api/gdpr/requests/missing');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Request not found');
    });

    it('returns 500 on service error', async () => {
      mockGdprRequestService.getRequest.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/gdpr/requests/req-001');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch request');
    });
  });

  // --------------------------------------------------------------------------
  // DELETE /api/gdpr/requests/:id
  // --------------------------------------------------------------------------

  describe('DELETE /api/gdpr/requests/:id', () => {
    it('cancels a request', async () => {
      mockGdprRequestService.cancelRequest.mockResolvedValue({ ...SAMPLE_REQUEST, status: 'cancelled' });

      const response = await request(app).delete('/api/gdpr/requests/req-001?userId=user-9');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('cancelled');
      expect(mockGdprRequestService.cancelRequest).toHaveBeenCalledWith('req-001', 'user-9');
    });

    it('returns 400 on service error (message passthrough)', async () => {
      mockGdprRequestService.cancelRequest.mockRejectedValue(new Error('already completed'));

      const response = await request(app).delete('/api/gdpr/requests/req-001');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('already completed');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/gdpr/requests/:id/download
  // --------------------------------------------------------------------------

  describe('GET /api/gdpr/requests/:id/download', () => {
    it('returns export data for completed request', async () => {
      mockGdprRequestService.getRequest.mockResolvedValue({
        ...SAMPLE_REQUEST,
        status: 'completed',
        responseData: { export: { records: 5 } },
      });

      const response = await request(app).get('/api/gdpr/requests/req-001/download');

      expect(response.status).toBe(200);
      expect(response.body.export.records).toBe(5);
    });

    it('returns 404 when request not found', async () => {
      mockGdprRequestService.getRequest.mockResolvedValue(null);

      const response = await request(app).get('/api/gdpr/requests/missing/download');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Request not found');
    });

    it('returns 400 when request not completed', async () => {
      mockGdprRequestService.getRequest.mockResolvedValue({ ...SAMPLE_REQUEST, status: 'pending' });

      const response = await request(app).get('/api/gdpr/requests/req-001/download');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Request is not yet completed');
    });

    it('returns 404 when no responseData available', async () => {
      mockGdprRequestService.getRequest.mockResolvedValue({
        ...SAMPLE_REQUEST,
        status: 'completed',
        responseData: null,
      });

      const response = await request(app).get('/api/gdpr/requests/req-001/download');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('No export data available');
    });

    it('returns 500 on service error', async () => {
      mockGdprRequestService.getRequest.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/gdpr/requests/req-001/download');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to download export');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/gdpr/verify/:token
  // --------------------------------------------------------------------------

  describe('GET /api/gdpr/verify/:token', () => {
    it('verifies a request', async () => {
      mockGdprRequestService.verifyRequest.mockResolvedValue(SAMPLE_REQUEST);

      const response = await request(app).get('/api/gdpr/verify/tok-123');

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Request verified successfully');
      expect(mockGdprRequestService.verifyRequest).toHaveBeenCalledWith('tok-123');
    });

    it('returns 400 on verification failure (message passthrough)', async () => {
      mockGdprRequestService.verifyRequest.mockRejectedValue(new Error('expired token'));

      const response = await request(app).get('/api/gdpr/verify/tok-123');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('expired token');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/gdpr/consents
  // --------------------------------------------------------------------------

  describe('GET /api/gdpr/consents', () => {
    it('returns user consents', async () => {
      mockConsentService.getUserConsents.mockResolvedValue([{ consentType: 'marketing', granted: true }]);

      const response = await request(app).get('/api/gdpr/consents?userId=user-9');

      expect(response.status).toBe(200);
      expect(response.body.consents).toHaveLength(1);
      expect(mockConsentService.getUserConsents).toHaveBeenCalledWith('user-9');
    });

    it('returns 500 on service error', async () => {
      mockConsentService.getUserConsents.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/gdpr/consents');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch consents');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/gdpr/consents
  // --------------------------------------------------------------------------

  describe('POST /api/gdpr/consents', () => {
    it('updates a single consent', async () => {
      mockConsentService.updateConsent.mockResolvedValue({ consentType: 'marketing', granted: true });

      const response = await request(app)
        .post('/api/gdpr/consents')
        .send({ userId: 'user-9', type: 'marketing', granted: true });

      expect(response.status).toBe(200);
      expect(response.body.granted).toBe(true);
      expect(mockConsentService.updateConsent).toHaveBeenCalledWith(
        'user-9',
        'marketing',
        true,
        expect.any(String),
        undefined,
      );
    });

    it('updates multiple consents in batch', async () => {
      mockConsentService.updateMultipleConsents.mockResolvedValue([{ consentType: 'analytics', granted: false }]);

      const response = await request(app)
        .post('/api/gdpr/consents')
        .send({ userId: 'user-9', consents: [{ consentType: 'analytics', granted: false }] });

      expect(response.status).toBe(200);
      expect(response.body.consents).toHaveLength(1);
      expect(mockConsentService.updateMultipleConsents).toHaveBeenCalled();
    });

    it('returns 400 for invalid consent type', async () => {
      const response = await request(app)
        .post('/api/gdpr/consents')
        .send({ type: 'invalid', granted: true });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('type is required');
    });

    it('returns 400 when granted is not boolean', async () => {
      const response = await request(app)
        .post('/api/gdpr/consents')
        .send({ type: 'marketing', granted: 'yes' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('granted must be a boolean');
    });

    it('returns 500 on service error', async () => {
      mockConsentService.updateConsent.mockRejectedValue(new Error('boom'));

      const response = await request(app)
        .post('/api/gdpr/consents')
        .send({ type: 'marketing', granted: true });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to update consent');
    });
  });

  // --------------------------------------------------------------------------
  // DELETE /api/gdpr/consents/:type
  // --------------------------------------------------------------------------

  describe('DELETE /api/gdpr/consents/:type', () => {
    it('revokes a consent', async () => {
      mockConsentService.revokeConsent.mockResolvedValue({ consentType: 'marketing', granted: false });

      const response = await request(app).delete('/api/gdpr/consents/marketing?userId=user-9');

      expect(response.status).toBe(200);
      expect(response.body.granted).toBe(false);
      expect(mockConsentService.revokeConsent).toHaveBeenCalledWith('user-9', 'marketing');
    });

    it('returns 400 for invalid consent type', async () => {
      const response = await request(app).delete('/api/gdpr/consents/invalid');

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid consent type');
    });

    it('returns 500 on service error', async () => {
      mockConsentService.revokeConsent.mockRejectedValue(new Error('boom'));

      const response = await request(app).delete('/api/gdpr/consents/marketing');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to revoke consent');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/gdpr/admin/requests
  // --------------------------------------------------------------------------

  describe('GET /api/gdpr/admin/requests', () => {
    it('returns all requests with filters and pagination', async () => {
      mockGdprRequestService.getAllRequests.mockResolvedValue({
        requests: [SAMPLE_REQUEST],
        total: 1,
        page: 2,
        limit: 5,
      });

      const response = await request(app).get(
        '/api/gdpr/admin/requests?status=pending&overdue=true&page=2&limit=5',
      );

      expect(response.status).toBe(200);
      expect(response.body.total).toBe(1);
      expect(mockGdprRequestService.getAllRequests).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'pending', overdue: true }),
        2,
        5,
      );
    });

    it('uses default pagination when not provided', async () => {
      mockGdprRequestService.getAllRequests.mockResolvedValue({ requests: [], total: 0, page: 1, limit: 20 });

      const response = await request(app).get('/api/gdpr/admin/requests');

      expect(response.status).toBe(200);
      expect(mockGdprRequestService.getAllRequests).toHaveBeenCalledWith({}, 1, 20);
    });

    it('returns 500 on service error', async () => {
      mockGdprRequestService.getAllRequests.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/gdpr/admin/requests');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch requests');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/gdpr/admin/requests/:id/acknowledge
  // --------------------------------------------------------------------------

  describe('POST /api/gdpr/admin/requests/:id/acknowledge', () => {
    it('acknowledges a request', async () => {
      mockGdprRequestService.acknowledgeRequest.mockResolvedValue({ ...SAMPLE_REQUEST, status: 'acknowledged' });

      const response = await request(app)
        .post('/api/gdpr/admin/requests/req-001/acknowledge')
        .send({ adminId: 'admin-7' });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('acknowledged');
      expect(mockGdprRequestService.acknowledgeRequest).toHaveBeenCalledWith('req-001', 'admin-7');
    });

    it('returns 500 on service error', async () => {
      mockGdprRequestService.acknowledgeRequest.mockRejectedValue(new Error('boom'));

      const response = await request(app).post('/api/gdpr/admin/requests/req-001/acknowledge').send({});

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to acknowledge request');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/gdpr/admin/requests/:id/start-processing
  // --------------------------------------------------------------------------

  describe('POST /api/gdpr/admin/requests/:id/start-processing', () => {
    it('starts processing a request', async () => {
      mockGdprRequestService.startProcessing.mockResolvedValue({ ...SAMPLE_REQUEST, status: 'in_progress' });

      const response = await request(app)
        .post('/api/gdpr/admin/requests/req-001/start-processing')
        .send({ adminId: 'admin-7' });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('in_progress');
      expect(mockGdprRequestService.startProcessing).toHaveBeenCalledWith('req-001', 'admin-7');
    });

    it('returns 500 on service error', async () => {
      mockGdprRequestService.startProcessing.mockRejectedValue(new Error('boom'));

      const response = await request(app)
        .post('/api/gdpr/admin/requests/req-001/start-processing')
        .send({});

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to start processing');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/gdpr/admin/requests/:id/complete
  // --------------------------------------------------------------------------

  describe('POST /api/gdpr/admin/requests/:id/complete', () => {
    it('completes a non-export request without generating an export', async () => {
      mockGdprRequestService.getRequest.mockResolvedValue({ ...SAMPLE_REQUEST, requestType: 'objection' });
      mockGdprRequestService.completeRequest.mockResolvedValue({ ...SAMPLE_REQUEST, status: 'completed' });

      const response = await request(app)
        .post('/api/gdpr/admin/requests/req-001/complete')
        .send({ adminId: 'admin-7' });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('completed');
      expect(mockGdprRequestService.generateDataExport).not.toHaveBeenCalled();
      expect(mockGdprRequestService.completeRequest).toHaveBeenCalledWith('req-001', 'admin-7', {});
    });

    it('generates an export for access requests then completes', async () => {
      mockGdprRequestService.getRequest.mockResolvedValue({
        ...SAMPLE_REQUEST,
        requestType: 'access',
        userId: 'owner-1',
        requestData: { format: 'csv' },
      });
      mockGdprRequestService.generateDataExport.mockResolvedValue({ format: 'csv', recordCount: 3 });
      mockGdprRequestService.completeRequest.mockResolvedValue({ ...SAMPLE_REQUEST, status: 'completed' });

      const response = await request(app)
        .post('/api/gdpr/admin/requests/req-001/complete')
        .send({ adminId: 'admin-7' });

      expect(response.status).toBe(200);
      expect(mockGdprRequestService.generateDataExport).toHaveBeenCalledWith('owner-1', 'csv');
      expect(mockGdprRequestService.completeRequest).toHaveBeenCalledWith(
        'req-001',
        'admin-7',
        expect.objectContaining({ export: { format: 'csv', recordCount: 3 } }),
      );
    });

    it('returns 500 on service error', async () => {
      mockGdprRequestService.getRequest.mockResolvedValue(null);
      mockGdprRequestService.completeRequest.mockRejectedValue(new Error('boom'));

      const response = await request(app).post('/api/gdpr/admin/requests/req-001/complete').send({});

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to complete request');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/gdpr/admin/requests/:id/reject
  // --------------------------------------------------------------------------

  describe('POST /api/gdpr/admin/requests/:id/reject', () => {
    it('rejects a request', async () => {
      mockGdprRequestService.rejectRequest.mockResolvedValue({ ...SAMPLE_REQUEST, status: 'rejected' });

      const response = await request(app)
        .post('/api/gdpr/admin/requests/req-001/reject')
        .send({ adminId: 'admin-7', reason: 'invalid' });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('rejected');
      expect(mockGdprRequestService.rejectRequest).toHaveBeenCalledWith('req-001', 'admin-7', 'invalid');
    });

    it('returns 400 when reason missing', async () => {
      const response = await request(app)
        .post('/api/gdpr/admin/requests/req-001/reject')
        .send({ adminId: 'admin-7' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('reason is required');
    });

    it('returns 500 on service error', async () => {
      mockGdprRequestService.rejectRequest.mockRejectedValue(new Error('boom'));

      const response = await request(app)
        .post('/api/gdpr/admin/requests/req-001/reject')
        .send({ reason: 'invalid' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to reject request');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/gdpr/admin/requests/:id/execute-erasure
  // --------------------------------------------------------------------------

  describe('POST /api/gdpr/admin/requests/:id/execute-erasure', () => {
    it('executes erasure and completes the request', async () => {
      mockGdprRequestService.getRequest.mockResolvedValue({
        ...SAMPLE_REQUEST,
        requestType: 'erasure',
        status: 'in_progress',
        userId: 'owner-1',
      });
      mockGdprRequestService.executeErasure.mockResolvedValue({ deletedRecords: 4 });
      mockGdprRequestService.completeRequest.mockResolvedValue({ ...SAMPLE_REQUEST, status: 'completed' });

      const response = await request(app)
        .post('/api/gdpr/admin/requests/req-001/execute-erasure')
        .send({ adminId: 'admin-7' });

      expect(response.status).toBe(200);
      expect(response.body.erasureResult.deletedRecords).toBe(4);
      // No `eraseRobotMemory` in the body ⇒ the fleet-wide robot memory wipe
      // (which would also erase other operators' place notes) stays off.
      expect(mockGdprRequestService.executeErasure).toHaveBeenCalledWith('owner-1', {
        eraseRobotMemory: false,
      });
      expect(mockGdprRequestService.completeRequest).toHaveBeenCalledWith('req-001', 'admin-7', {
        erasureResult: { deletedRecords: 4 },
      });
    });

    it('passes the explicit fleet-wide opt-in through to the service', async () => {
      mockGdprRequestService.getRequest.mockResolvedValue({
        ...SAMPLE_REQUEST,
        requestType: 'erasure',
        status: 'in_progress',
        userId: 'owner-1',
      });
      mockGdprRequestService.executeErasure.mockResolvedValue({ deletedRecords: 0 });
      mockGdprRequestService.completeRequest.mockResolvedValue({ ...SAMPLE_REQUEST, status: 'completed' });

      await request(app)
        .post('/api/gdpr/admin/requests/req-001/execute-erasure')
        .send({ adminId: 'admin-7', eraseRobotMemory: true });

      expect(mockGdprRequestService.executeErasure).toHaveBeenCalledWith('owner-1', {
        eraseRobotMemory: true,
      });
    });

    it('returns 404 when request not found', async () => {
      mockGdprRequestService.getRequest.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/gdpr/admin/requests/req-001/execute-erasure')
        .send({});

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Request not found');
    });

    it('returns 400 when not an erasure request', async () => {
      mockGdprRequestService.getRequest.mockResolvedValue({ ...SAMPLE_REQUEST, requestType: 'access' });

      const response = await request(app)
        .post('/api/gdpr/admin/requests/req-001/execute-erasure')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('This is not an erasure request');
    });

    it('returns 400 when request not in progress', async () => {
      mockGdprRequestService.getRequest.mockResolvedValue({
        ...SAMPLE_REQUEST,
        requestType: 'erasure',
        status: 'pending',
      });

      const response = await request(app)
        .post('/api/gdpr/admin/requests/req-001/execute-erasure')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Request must be in progress to execute erasure');
    });

    it('returns 400 on service error (message passthrough)', async () => {
      mockGdprRequestService.getRequest.mockResolvedValue({
        ...SAMPLE_REQUEST,
        requestType: 'erasure',
        status: 'in_progress',
        userId: 'owner-1',
      });
      mockGdprRequestService.executeErasure.mockRejectedValue(new Error('erasure blocked'));

      const response = await request(app)
        .post('/api/gdpr/admin/requests/req-001/execute-erasure')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('erasure blocked');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/gdpr/admin/metrics
  // --------------------------------------------------------------------------

  describe('GET /api/gdpr/admin/metrics', () => {
    it('returns metrics', async () => {
      mockGdprRequestService.getMetrics.mockResolvedValue({ totalRequests: 10 });

      const response = await request(app).get('/api/gdpr/admin/metrics');

      expect(response.status).toBe(200);
      expect(response.body.totalRequests).toBe(10);
    });

    it('returns 500 on service error', async () => {
      mockGdprRequestService.getMetrics.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/gdpr/admin/metrics');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch metrics');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/gdpr/admin/sla-report
  // --------------------------------------------------------------------------

  describe('GET /api/gdpr/admin/sla-report', () => {
    it('returns SLA report', async () => {
      mockGdprRequestService.getSLAReport.mockResolvedValue({ complianceRate: 95 });

      const response = await request(app).get('/api/gdpr/admin/sla-report');

      expect(response.status).toBe(200);
      expect(response.body.complianceRate).toBe(95);
    });

    it('returns 500 on service error', async () => {
      mockGdprRequestService.getSLAReport.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/gdpr/admin/sla-report');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch SLA report');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/gdpr/admin/overdue
  // --------------------------------------------------------------------------

  describe('GET /api/gdpr/admin/overdue', () => {
    it('returns overdue requests', async () => {
      mockGdprRequestService.getOverdueRequests.mockResolvedValue([SAMPLE_REQUEST]);

      const response = await request(app).get('/api/gdpr/admin/overdue');

      expect(response.status).toBe(200);
      expect(response.body.requests).toHaveLength(1);
    });

    it('returns 500 on service error', async () => {
      mockGdprRequestService.getOverdueRequests.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/gdpr/admin/overdue');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch overdue requests');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/gdpr/admin/nearing-deadline
  // --------------------------------------------------------------------------

  describe('GET /api/gdpr/admin/nearing-deadline', () => {
    it('returns requests nearing deadline with explicit hours', async () => {
      mockGdprRequestService.getRequestsNearingSLA.mockResolvedValue([SAMPLE_REQUEST]);

      const response = await request(app).get('/api/gdpr/admin/nearing-deadline?hours=24');

      expect(response.status).toBe(200);
      expect(response.body.requests).toHaveLength(1);
      expect(mockGdprRequestService.getRequestsNearingSLA).toHaveBeenCalledWith(24);
    });

    it('defaults to 48 hours when not provided', async () => {
      mockGdprRequestService.getRequestsNearingSLA.mockResolvedValue([]);

      const response = await request(app).get('/api/gdpr/admin/nearing-deadline');

      expect(response.status).toBe(200);
      expect(mockGdprRequestService.getRequestsNearingSLA).toHaveBeenCalledWith(48);
    });

    it('returns 500 on service error', async () => {
      mockGdprRequestService.getRequestsNearingSLA.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/gdpr/admin/nearing-deadline');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch nearing deadline requests');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/gdpr/admin/consent-metrics
  // --------------------------------------------------------------------------

  describe('GET /api/gdpr/admin/consent-metrics', () => {
    it('returns consent metrics', async () => {
      mockConsentService.getConsentMetrics.mockResolvedValue({ marketing: 5 });

      const response = await request(app).get('/api/gdpr/admin/consent-metrics');

      expect(response.status).toBe(200);
      expect(response.body.marketing).toBe(5);
    });

    it('returns 500 on service error', async () => {
      mockConsentService.getConsentMetrics.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/gdpr/admin/consent-metrics');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch consent metrics');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/gdpr/admin/restriction-stats
  // --------------------------------------------------------------------------

  describe('GET /api/gdpr/admin/restriction-stats', () => {
    it('returns restriction stats', async () => {
      mockDataRestrictionService.getRestrictionStats.mockResolvedValue({ active: 2 });

      const response = await request(app).get('/api/gdpr/admin/restriction-stats');

      expect(response.status).toBe(200);
      expect(response.body.active).toBe(2);
    });

    it('returns 500 on service error', async () => {
      mockDataRestrictionService.getRestrictionStats.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/gdpr/admin/restriction-stats');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch restriction stats');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/gdpr/admin/restrictions
  // --------------------------------------------------------------------------

  describe('GET /api/gdpr/admin/restrictions', () => {
    it('returns active restrictions', async () => {
      mockDataRestrictionService.getActiveRestrictions.mockResolvedValue([{ id: 'r1' }]);

      const response = await request(app).get('/api/gdpr/admin/restrictions');

      expect(response.status).toBe(200);
      expect(response.body.restrictions).toHaveLength(1);
    });

    it('returns 500 on service error', async () => {
      mockDataRestrictionService.getActiveRestrictions.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/gdpr/admin/restrictions');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch restrictions');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/gdpr/admin/restrictions/:id/lift
  // --------------------------------------------------------------------------

  describe('POST /api/gdpr/admin/restrictions/:id/lift', () => {
    it('lifts a restriction', async () => {
      mockDataRestrictionService.liftRestriction.mockResolvedValue({ id: 'r1', isActive: false });

      const response = await request(app)
        .post('/api/gdpr/admin/restrictions/r1/lift')
        .send({ adminId: 'admin-7' });

      expect(response.status).toBe(200);
      expect(response.body.isActive).toBe(false);
      expect(mockDataRestrictionService.liftRestriction).toHaveBeenCalledWith('r1', 'admin-7');
    });

    it('returns 500 on service error', async () => {
      mockDataRestrictionService.liftRestriction.mockRejectedValue(new Error('boom'));

      const response = await request(app).post('/api/gdpr/admin/restrictions/r1/lift').send({});

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to lift restriction');
    });
  });
});
