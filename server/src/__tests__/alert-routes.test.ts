/**
 * @file alert-routes.test.ts
 * @description Integration tests for alert management routes
 * @feature alerts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Use vi.hoisted so mock objects are available before vi.mock hoisting
const { mockAlertService } = vi.hoisted(() => ({
  mockAlertService: {
    getAlerts: vi.fn(),
    getActiveAlerts: vi.fn(),
    getAlertCounts: vi.fn(),
    getAlertHistory: vi.fn(),
    getAlert: vi.fn(),
    createAlert: vi.fn(),
    acknowledgeAlert: vi.fn(),
    deleteAlert: vi.fn(),
    clearAcknowledgedAlerts: vi.fn(),
    clearAllAlerts: vi.fn(),
  },
}));

vi.mock('../services/AlertService.js', () => ({
  alertService: mockAlertService,
  AlertSeverity: {},
  AlertSource: {},
}));

vi.mock('../middleware/auth.middleware.js', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-123', email: 'test@example.com', name: 'Test', role: 'admin' };
    next();
  },
  AuthenticatedRequest: {},
}));

import { alertRoutes } from '../routes/alert.routes.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/alerts', authMiddleware as any, alertRoutes);
  return app;
}

const SAMPLE_ALERT = {
  id: 'alert-001',
  severity: 'warning',
  title: 'Battery low',
  message: 'Robot battery is below 20%',
  source: 'robot',
  sourceId: 'robot-001',
  acknowledged: false,
  acknowledgedBy: null,
  acknowledgedAt: null,
  dismissable: true,
  autoDismissMs: null,
  createdAt: '2026-06-23T00:00:00.000Z',
};

describe('Alert Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // --------------------------------------------------------------------------
  // GET /api/alerts
  // --------------------------------------------------------------------------

  describe('GET /api/alerts', () => {
    it('lists alerts with default pagination', async () => {
      const result = { alerts: [SAMPLE_ALERT], total: 1, page: 1, pageSize: 50 };
      mockAlertService.getAlerts.mockResolvedValue(result);

      const response = await request(app).get('/api/alerts');

      expect(response.status).toBe(200);
      expect(response.body.total).toBe(1);
      expect(response.body.alerts[0].id).toBe('alert-001');
      expect(mockAlertService.getAlerts).toHaveBeenCalledWith({}, { page: 1, pageSize: 50 });
    });

    it('parses single and multi-value filters plus pagination', async () => {
      mockAlertService.getAlerts.mockResolvedValue({ alerts: [], total: 0, page: 2, pageSize: 10 });

      const response = await request(app).get(
        '/api/alerts?severity=warning,error&source=robot&sourceId=robot-001&acknowledged=true&startDate=2026-01-01T00:00:00.000Z&endDate=2026-02-01T00:00:00.000Z&page=2&pageSize=10'
      );

      expect(response.status).toBe(200);
      expect(mockAlertService.getAlerts).toHaveBeenCalledWith(
        {
          severity: ['warning', 'error'],
          source: 'robot',
          sourceId: 'robot-001',
          acknowledged: true,
          startDate: new Date('2026-01-01T00:00:00.000Z'),
          endDate: new Date('2026-02-01T00:00:00.000Z'),
        },
        { page: 2, pageSize: 10 }
      );
    });

    it('returns 500 on service error', async () => {
      mockAlertService.getAlerts.mockRejectedValue(new Error('DB error'));

      const response = await request(app).get('/api/alerts');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to list alerts');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/alerts/active
  // --------------------------------------------------------------------------

  describe('GET /api/alerts/active', () => {
    it('returns active alerts wrapped in { alerts }', async () => {
      mockAlertService.getActiveAlerts.mockResolvedValue([SAMPLE_ALERT]);

      const response = await request(app).get('/api/alerts/active');

      expect(response.status).toBe(200);
      expect(response.body.alerts).toHaveLength(1);
      expect(mockAlertService.getActiveAlerts).toHaveBeenCalledWith({});
    });

    it('parses filters for active alerts', async () => {
      mockAlertService.getActiveAlerts.mockResolvedValue([]);

      const response = await request(app).get(
        '/api/alerts/active?severity=critical&source=system,user&sourceId=sys-1'
      );

      expect(response.status).toBe(200);
      expect(mockAlertService.getActiveAlerts).toHaveBeenCalledWith({
        severity: 'critical',
        source: ['system', 'user'],
        sourceId: 'sys-1',
      });
    });

    it('returns 500 on service error', async () => {
      mockAlertService.getActiveAlerts.mockRejectedValue(new Error('DB error'));

      const response = await request(app).get('/api/alerts/active');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get active alerts');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/alerts/counts
  // --------------------------------------------------------------------------

  describe('GET /api/alerts/counts', () => {
    it('returns alert counts wrapped in { counts }', async () => {
      const counts = { critical: 1, error: 2, warning: 3, info: 4 };
      mockAlertService.getAlertCounts.mockResolvedValue(counts);

      const response = await request(app).get('/api/alerts/counts');

      expect(response.status).toBe(200);
      expect(response.body.counts).toEqual(counts);
      expect(mockAlertService.getAlertCounts).toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockAlertService.getAlertCounts.mockRejectedValue(new Error('DB error'));

      const response = await request(app).get('/api/alerts/counts');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get alert counts');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/alerts/history
  // --------------------------------------------------------------------------

  describe('GET /api/alerts/history', () => {
    it('returns alert history with default pagination', async () => {
      const result = { alerts: [SAMPLE_ALERT], total: 1, page: 1, pageSize: 50 };
      mockAlertService.getAlertHistory.mockResolvedValue(result);

      const response = await request(app).get('/api/alerts/history');

      expect(response.status).toBe(200);
      expect(response.body.total).toBe(1);
      expect(mockAlertService.getAlertHistory).toHaveBeenCalledWith({}, { page: 1, pageSize: 50 });
    });

    it('parses filters and pagination for history', async () => {
      mockAlertService.getAlertHistory.mockResolvedValue({ alerts: [], total: 0, page: 3, pageSize: 5 });

      const response = await request(app).get(
        '/api/alerts/history?severity=info,warning&source=task&sourceId=task-9&startDate=2026-03-01T00:00:00.000Z&endDate=2026-04-01T00:00:00.000Z&page=3&pageSize=5'
      );

      expect(response.status).toBe(200);
      expect(mockAlertService.getAlertHistory).toHaveBeenCalledWith(
        {
          severity: ['info', 'warning'],
          source: 'task',
          sourceId: 'task-9',
          startDate: new Date('2026-03-01T00:00:00.000Z'),
          endDate: new Date('2026-04-01T00:00:00.000Z'),
        },
        { page: 3, pageSize: 5 }
      );
    });

    it('returns 500 on service error', async () => {
      mockAlertService.getAlertHistory.mockRejectedValue(new Error('DB error'));

      const response = await request(app).get('/api/alerts/history');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get alert history');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/alerts/:id
  // --------------------------------------------------------------------------

  describe('GET /api/alerts/:id', () => {
    it('returns a single alert', async () => {
      mockAlertService.getAlert.mockResolvedValue(SAMPLE_ALERT);

      const response = await request(app).get('/api/alerts/alert-001');

      expect(response.status).toBe(200);
      expect(response.body.id).toBe('alert-001');
      expect(mockAlertService.getAlert).toHaveBeenCalledWith('alert-001');
    });

    it('returns 404 when alert not found', async () => {
      mockAlertService.getAlert.mockResolvedValue(null);

      const response = await request(app).get('/api/alerts/missing');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Alert not found');
    });

    it('returns 500 on service error', async () => {
      mockAlertService.getAlert.mockRejectedValue(new Error('DB error'));

      const response = await request(app).get('/api/alerts/alert-001');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get alert');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/alerts
  // --------------------------------------------------------------------------

  describe('POST /api/alerts', () => {
    it('creates an alert and returns 201', async () => {
      mockAlertService.createAlert.mockResolvedValue(SAMPLE_ALERT);

      const body = {
        severity: 'warning',
        title: 'Battery low',
        message: 'Robot battery is below 20%',
        source: 'robot',
        sourceId: 'robot-001',
        dismissable: true,
        autoDismissMs: 5000,
      };

      const response = await request(app).post('/api/alerts').send(body);

      expect(response.status).toBe(201);
      expect(response.body.id).toBe('alert-001');
      expect(mockAlertService.createAlert).toHaveBeenCalledWith({
        severity: 'warning',
        title: 'Battery low',
        message: 'Robot battery is below 20%',
        source: 'robot',
        sourceId: 'robot-001',
        dismissable: true,
        autoDismissMs: 5000,
      });
    });

    it('returns 400 when required fields are missing', async () => {
      const response = await request(app).post('/api/alerts').send({ title: 'Only title' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Missing required fields');
      expect(mockAlertService.createAlert).not.toHaveBeenCalled();
    });

    it('returns 400 for invalid severity', async () => {
      const response = await request(app).post('/api/alerts').send({
        severity: 'fatal',
        title: 'T',
        message: 'M',
        source: 'robot',
      });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid severity');
      expect(mockAlertService.createAlert).not.toHaveBeenCalled();
    });

    it('returns 400 for invalid source', async () => {
      const response = await request(app).post('/api/alerts').send({
        severity: 'info',
        title: 'T',
        message: 'M',
        source: 'galaxy',
      });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid source');
      expect(mockAlertService.createAlert).not.toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockAlertService.createAlert.mockRejectedValue(new Error('DB error'));

      const response = await request(app).post('/api/alerts').send({
        severity: 'info',
        title: 'T',
        message: 'M',
        source: 'system',
      });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to create alert');
    });
  });

  // --------------------------------------------------------------------------
  // PATCH /api/alerts/:id/acknowledge
  // --------------------------------------------------------------------------

  describe('PATCH /api/alerts/:id/acknowledge', () => {
    it('acknowledges an alert using req.user id', async () => {
      const acked = { ...SAMPLE_ALERT, acknowledged: true, acknowledgedBy: 'user-123' };
      mockAlertService.acknowledgeAlert.mockResolvedValue(acked);

      const response = await request(app).patch('/api/alerts/alert-001/acknowledge');

      expect(response.status).toBe(200);
      expect(response.body.acknowledged).toBe(true);
      expect(mockAlertService.acknowledgeAlert).toHaveBeenCalledWith('alert-001', 'user-123');
    });

    it('returns 404 when alert not found', async () => {
      mockAlertService.acknowledgeAlert.mockResolvedValue(null);

      const response = await request(app).patch('/api/alerts/missing/acknowledge');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Alert not found');
    });

    it('returns 500 on service error', async () => {
      mockAlertService.acknowledgeAlert.mockRejectedValue(new Error('DB error'));

      const response = await request(app).patch('/api/alerts/alert-001/acknowledge');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to acknowledge alert');
    });
  });

  // --------------------------------------------------------------------------
  // DELETE /api/alerts/:id
  // --------------------------------------------------------------------------

  describe('DELETE /api/alerts/:id', () => {
    it('deletes an alert and returns success', async () => {
      mockAlertService.deleteAlert.mockResolvedValue(true);

      const response = await request(app).delete('/api/alerts/alert-001');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockAlertService.deleteAlert).toHaveBeenCalledWith('alert-001');
    });

    it('returns 404 when alert not found', async () => {
      mockAlertService.deleteAlert.mockResolvedValue(false);

      const response = await request(app).delete('/api/alerts/missing');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Alert not found');
    });

    it('returns 500 on service error', async () => {
      mockAlertService.deleteAlert.mockRejectedValue(new Error('DB error'));

      const response = await request(app).delete('/api/alerts/alert-001');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to delete alert');
    });
  });

  // --------------------------------------------------------------------------
  // DELETE /api/alerts/clear/acknowledged
  // --------------------------------------------------------------------------

  describe('DELETE /api/alerts/clear/acknowledged', () => {
    it('clears acknowledged alerts and returns count', async () => {
      mockAlertService.clearAcknowledgedAlerts.mockResolvedValue(3);

      const response = await request(app).delete('/api/alerts/clear/acknowledged');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.deleted).toBe(3);
      expect(mockAlertService.clearAcknowledgedAlerts).toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockAlertService.clearAcknowledgedAlerts.mockRejectedValue(new Error('DB error'));

      const response = await request(app).delete('/api/alerts/clear/acknowledged');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to clear acknowledged alerts');
    });
  });

  // --------------------------------------------------------------------------
  // DELETE /api/alerts/clear/all
  // --------------------------------------------------------------------------

  describe('DELETE /api/alerts/clear/all', () => {
    it('clears all alerts and returns count', async () => {
      mockAlertService.clearAllAlerts.mockResolvedValue(7);

      const response = await request(app).delete('/api/alerts/clear/all');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.deleted).toBe(7);
      expect(mockAlertService.clearAllAlerts).toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      mockAlertService.clearAllAlerts.mockRejectedValue(new Error('DB error'));

      const response = await request(app).delete('/api/alerts/clear/all');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to clear all alerts');
    });
  });
});
