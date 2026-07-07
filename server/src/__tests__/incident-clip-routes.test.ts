/**
 * @file incident-clip-routes.test.ts
 * @description Integration tests for the incident highlight-clip routes
 *   (TASK-179 §6): PUT /api/incidents/:id/clip (raw-body upload) and
 *   GET /api/incidents/:id/clip (stream back). The real IncidentService and
 *   routes run; the repository and object storage (the I/O boundaries) are
 *   mocked — storage as an in-memory map so PUT→GET is a true roundtrip.
 * @feature incidents
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { Readable } from 'stream';

// In-memory clip store + repository state (the mocked I/O boundaries)
const { clipStore, mockIncidentRepository, mockStorage } = vi.hoisted(() => {
  const clipStore = new Map<string, Buffer>();
  return {
    clipStore,
    mockIncidentRepository: {
      findById: vi.fn(),
      updateClipKey: vi.fn(),
    },
    mockStorage: {
      uploadIncidentClip: vi.fn(async (incidentId: string, data: Buffer) => {
        const key = `incidents/${incidentId}/clip.json`;
        clipStore.set(key, data);
        return key;
      }),
      getIncidentClipStream: vi.fn(async (key: string) => {
        const data = clipStore.get(key);
        if (!data) throw new Error('NoSuchKey');
        return Readable.from(data);
      }),
    },
  };
});

vi.mock('../repositories/IncidentRepository.js', () => ({
  incidentRepository: mockIncidentRepository,
  incidentNotificationRepository: {},
}));

// Keep INCIDENT_CLIP small so the 413 size-guard test doesn't need 32MB.
vi.mock('../storage/model-storage.js', () => ({
  modelStorage: mockStorage,
  BUCKETS: { INCIDENT_CLIPS: 'incident-clips' },
  SIZE_LIMITS: { INCIDENT_CLIP: 64 * 1024 },
}));

// Stub the heavy service graph IncidentService pulls in.
vi.mock('../services/SafetyService.js', () => ({
  safetyService: { onEStopEvent: vi.fn(() => () => {}) },
}));
vi.mock('../services/RobotManager.js', () => ({
  robotManager: { listRobots: vi.fn().mockResolvedValue([]) },
}));
vi.mock('../services/AlertService.js', () => ({
  alertService: { createAlert: vi.fn(), getActiveAlerts: vi.fn().mockResolvedValue([]) },
}));
vi.mock('../services/BreachAssessmentService.js', () => ({
  breachAssessmentService: {},
}));
vi.mock('../services/NotificationWorkflowService.js', () => ({
  notificationWorkflowService: {},
}));

vi.mock('../middleware/auth.middleware.js', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-123', email: 'test@example.com', name: 'Test', role: 'admin' };
    next();
  },
  AuthenticatedRequest: {},
}));

import { incidentRoutes } from '../routes/incident.routes.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/incidents', authMiddleware as any, incidentRoutes);
  return app;
}

const INCIDENT = {
  id: 'inc-001',
  incidentNumber: 'INC-2026-001',
  type: 'safety',
  severity: 'high',
  status: 'detected',
  title: 'Rollout failure',
  description: 'highlight strategy captured a failure',
  clipKey: null,
};

const CLIP = {
  format: 'jpeg-frames',
  fps: 5,
  capturedAt: '2026-07-07T10:00:00.000Z',
  frames: ['/9j/4AAQSkZJRg==', '/9j/4AAQSkZJRh=='],
};

describe('Incident Clip Routes (TASK-179 §6)', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    clipStore.clear();
    app = createApp();
    mockIncidentRepository.findById.mockResolvedValue({ ...INCIDENT });
    mockIncidentRepository.updateClipKey.mockImplementation(async (id: string, clipKey: string) => ({
      ...INCIDENT,
      id,
      clipKey,
    }));
  });

  // --------------------------------------------------------------------------
  // PUT /api/incidents/:id/clip
  // --------------------------------------------------------------------------

  describe('PUT /api/incidents/:id/clip', () => {
    it('stores a raw-body clip upload and sets Incident.clipKey', async () => {
      const response = await request(app)
        .put('/api/incidents/inc-001/clip')
        .set('Content-Type', 'application/octet-stream')
        .send(Buffer.from(JSON.stringify(CLIP), 'utf-8'));

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: 'ok', clipKey: 'incidents/inc-001/clip.json' });
      expect(mockStorage.uploadIncidentClip).toHaveBeenCalledWith('inc-001', expect.any(Buffer));
      expect(mockIncidentRepository.updateClipKey).toHaveBeenCalledWith(
        'inc-001',
        'incidents/inc-001/clip.json'
      );
    });

    it('also accepts a small application/json body (pre-parsed by express.json)', async () => {
      const response = await request(app)
        .put('/api/incidents/inc-001/clip')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify(CLIP));

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ok');
      expect(clipStore.size).toBe(1);
    });

    it('returns 400 for invalid JSON bytes', async () => {
      const response = await request(app)
        .put('/api/incidents/inc-001/clip')
        .set('Content-Type', 'application/octet-stream')
        .send(Buffer.from('not json at all'));

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Clip body must be valid JSON');
      expect(mockStorage.uploadIncidentClip).not.toHaveBeenCalled();
    });

    it("returns 400 when format is not 'jpeg-frames'", async () => {
      const response = await request(app)
        .put('/api/incidents/inc-001/clip')
        .set('Content-Type', 'application/octet-stream')
        .send(Buffer.from(JSON.stringify({ ...CLIP, format: 'mp4' })));

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("jpeg-frames");
    });

    it('returns 404 when the incident does not exist', async () => {
      mockIncidentRepository.findById.mockResolvedValue(null);

      const response = await request(app)
        .put('/api/incidents/missing/clip')
        .set('Content-Type', 'application/octet-stream')
        .send(Buffer.from(JSON.stringify(CLIP)));

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Incident not found');
    });

    it('rejects uploads over the size guard (413)', async () => {
      // SIZE_LIMITS.INCIDENT_CLIP is mocked to 64KB; send ~128KB.
      const bigFrames = { ...CLIP, frames: [Buffer.alloc(128 * 1024, 65).toString('base64')] };

      const response = await request(app)
        .put('/api/incidents/inc-001/clip')
        .set('Content-Type', 'application/octet-stream')
        .send(Buffer.from(JSON.stringify(bigFrames)));

      expect(response.status).toBe(413);
      expect(mockStorage.uploadIncidentClip).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/incidents/:id/clip — roundtrip
  // --------------------------------------------------------------------------

  describe('GET /api/incidents/:id/clip', () => {
    it('streams back the exact bytes stored via PUT (roundtrip)', async () => {
      const putRes = await request(app)
        .put('/api/incidents/inc-001/clip')
        .set('Content-Type', 'application/octet-stream')
        .send(Buffer.from(JSON.stringify(CLIP), 'utf-8'));
      expect(putRes.status).toBe(200);

      // GET reads the clipKey off the incident row.
      mockIncidentRepository.findById.mockResolvedValue({
        ...INCIDENT,
        clipKey: putRes.body.clipKey,
      });

      const getRes = await request(app).get('/api/incidents/inc-001/clip');

      expect(getRes.status).toBe(200);
      expect(getRes.headers['content-type']).toContain('application/json');
      expect(getRes.body).toEqual(CLIP);
    });

    it('returns 404 when the incident has no clip', async () => {
      mockIncidentRepository.findById.mockResolvedValue({ ...INCIDENT, clipKey: null });

      const response = await request(app).get('/api/incidents/inc-001/clip');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Clip not available');
    });

    it('returns 404 when the incident does not exist', async () => {
      mockIncidentRepository.findById.mockResolvedValue(null);

      const response = await request(app).get('/api/incidents/missing/clip');

      expect(response.status).toBe(404);
    });
  });
});
