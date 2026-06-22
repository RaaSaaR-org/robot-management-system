/**
 * @file zone-routes.test.ts
 * @description Integration tests for zone management routes
 * @feature fleet
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Use vi.hoisted so mock objects exist before vi.mock hoisting.
const { mockZoneService, ZoneValidationError } = vi.hoisted(() => {
  class ZoneValidationError extends Error {
    constructor(
      message: string,
      public errors: Array<{ field: string; message: string }>
    ) {
      super(message);
      this.name = 'ZoneValidationError';
    }
  }
  return {
    ZoneValidationError,
    mockZoneService: {
      getZones: vi.fn(),
      getZoneAtPoint: vi.fn(),
      getNamedLocations: vi.fn(),
      getZonesByFloor: vi.fn(),
      getZone: vi.fn(),
      createZone: vi.fn(),
      updateZone: vi.fn(),
      deleteZone: vi.fn(),
      deleteZonesByFloor: vi.fn(),
    },
  };
});

vi.mock('../services/ZoneService.js', () => ({
  zoneService: mockZoneService,
  ZoneValidationError,
}));

vi.mock('../middleware/auth.middleware.js', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-123', email: 'test@example.com', name: 'Test', role: 'admin' };
    next();
  },
  AuthenticatedRequest: {},
}));

import { zoneRoutes } from '../routes/zone.routes.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/zones', authMiddleware as any, zoneRoutes);
  return app;
}

const MOCK_ZONE = {
  id: 'zone-001',
  name: 'Warehouse A',
  floor: '1',
  type: 'storage',
  bounds: { x: 0, y: 0, width: 10, height: 10 },
  color: '#FF6700',
  description: 'Main storage',
  metadata: null,
  createdAt: '2026-02-26T00:00:00.000Z',
  updatedAt: '2026-02-26T00:00:00.000Z',
};

describe('Zone Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // --------------------------------------------------------------------------
  // GET /api/zones
  // --------------------------------------------------------------------------

  describe('GET /api/zones', () => {
    it('lists zones with default pagination', async () => {
      const result = { zones: [MOCK_ZONE], total: 1, page: 1, pageSize: 100 };
      mockZoneService.getZones.mockResolvedValue(result);

      const response = await request(app).get('/api/zones');

      expect(response.status).toBe(200);
      expect(response.body.zones).toHaveLength(1);
      expect(response.body.zones[0].name).toBe('Warehouse A');
      expect(mockZoneService.getZones).toHaveBeenCalledWith(
        {},
        { page: 1, pageSize: 100 }
      );
    });

    it('applies floor filter and single type filter', async () => {
      mockZoneService.getZones.mockResolvedValue({ zones: [], total: 0, page: 1, pageSize: 100 });

      const response = await request(app).get('/api/zones?floor=2&type=storage');

      expect(response.status).toBe(200);
      expect(mockZoneService.getZones).toHaveBeenCalledWith(
        { floor: '2', type: 'storage' },
        { page: 1, pageSize: 100 }
      );
    });

    it('parses comma-separated type list into an array', async () => {
      mockZoneService.getZones.mockResolvedValue({ zones: [], total: 0, page: 1, pageSize: 100 });

      await request(app).get('/api/zones?type=storage,charging');

      expect(mockZoneService.getZones).toHaveBeenCalledWith(
        { type: ['storage', 'charging'] },
        { page: 1, pageSize: 100 }
      );
    });

    it('clamps pagination bounds (page>=1, pageSize<=1000)', async () => {
      mockZoneService.getZones.mockResolvedValue({ zones: [], total: 0, page: 1, pageSize: 1000 });

      await request(app).get('/api/zones?page=0&pageSize=5000');

      expect(mockZoneService.getZones).toHaveBeenCalledWith(
        {},
        { page: 1, pageSize: 1000 }
      );
    });

    it('falls back to defaults for non-numeric pagination', async () => {
      mockZoneService.getZones.mockResolvedValue({ zones: [], total: 0, page: 1, pageSize: 100 });

      await request(app).get('/api/zones?page=abc&pageSize=xyz');

      expect(mockZoneService.getZones).toHaveBeenCalledWith(
        {},
        { page: 1, pageSize: 100 }
      );
    });

    it('returns 500 on service error', async () => {
      mockZoneService.getZones.mockRejectedValue(new Error('DB error'));

      const response = await request(app).get('/api/zones');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to list zones');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/zones/at-point
  // --------------------------------------------------------------------------

  describe('GET /api/zones/at-point', () => {
    it('returns the zone at a point', async () => {
      mockZoneService.getZoneAtPoint.mockResolvedValue(MOCK_ZONE);

      const response = await request(app).get('/api/zones/at-point?x=5&y=6&floor=1');

      expect(response.status).toBe(200);
      expect(response.body.id).toBe('zone-001');
      expect(mockZoneService.getZoneAtPoint).toHaveBeenCalledWith(5, 6, '1');
    });

    it('returns 400 when required query params are missing', async () => {
      const response = await request(app).get('/api/zones/at-point?x=5&y=6');

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Missing required query params');
      expect(mockZoneService.getZoneAtPoint).not.toHaveBeenCalled();
    });

    it('returns 400 for invalid (non-finite) coordinates', async () => {
      const response = await request(app).get('/api/zones/at-point?x=foo&y=6&floor=1');

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid coordinates');
      expect(mockZoneService.getZoneAtPoint).not.toHaveBeenCalled();
    });

    it('returns 404 when no zone exists at the point', async () => {
      mockZoneService.getZoneAtPoint.mockResolvedValue(null);

      const response = await request(app).get('/api/zones/at-point?x=5&y=6&floor=1');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('No zone found at point');
    });

    it('returns 500 on service error', async () => {
      mockZoneService.getZoneAtPoint.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/zones/at-point?x=5&y=6&floor=1');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to find zone at point');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/zones/named-locations
  // --------------------------------------------------------------------------

  describe('GET /api/zones/named-locations', () => {
    it('returns derived named locations', async () => {
      const locations = { 'Warehouse A': { x: 5, y: 5, floor: '1' } };
      mockZoneService.getNamedLocations.mockResolvedValue(locations);

      const response = await request(app).get('/api/zones/named-locations');

      expect(response.status).toBe(200);
      expect(response.body.locations['Warehouse A']).toEqual({ x: 5, y: 5, floor: '1' });
      expect(mockZoneService.getNamedLocations).toHaveBeenCalledTimes(1);
    });

    it('returns 500 on service error', async () => {
      mockZoneService.getNamedLocations.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/zones/named-locations');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get named locations');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/zones/floor/:floor
  // --------------------------------------------------------------------------

  describe('GET /api/zones/floor/:floor', () => {
    it('returns zones for a floor', async () => {
      mockZoneService.getZonesByFloor.mockResolvedValue([MOCK_ZONE]);

      const response = await request(app).get('/api/zones/floor/3');

      expect(response.status).toBe(200);
      expect(response.body.zones).toHaveLength(1);
      expect(mockZoneService.getZonesByFloor).toHaveBeenCalledWith('3');
    });

    it('returns 500 on service error', async () => {
      mockZoneService.getZonesByFloor.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/zones/floor/3');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get zones by floor');
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/zones/:id
  // --------------------------------------------------------------------------

  describe('GET /api/zones/:id', () => {
    it('returns a single zone by id', async () => {
      mockZoneService.getZone.mockResolvedValue(MOCK_ZONE);

      const response = await request(app).get('/api/zones/zone-001');

      expect(response.status).toBe(200);
      expect(response.body.id).toBe('zone-001');
      expect(mockZoneService.getZone).toHaveBeenCalledWith('zone-001');
    });

    it('returns 404 when zone not found', async () => {
      mockZoneService.getZone.mockResolvedValue(null);

      const response = await request(app).get('/api/zones/missing');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Zone not found');
    });

    it('returns 500 on service error', async () => {
      mockZoneService.getZone.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/zones/zone-001');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get zone');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/zones
  // --------------------------------------------------------------------------

  describe('POST /api/zones', () => {
    it('creates a zone and returns 201', async () => {
      mockZoneService.createZone.mockResolvedValue(MOCK_ZONE);

      const body = {
        name: 'Warehouse A',
        floor: '1',
        type: 'storage',
        bounds: { x: 0, y: 0, width: 10, height: 10 },
        color: '#FF6700',
        description: 'Main storage',
        metadata: null,
      };

      const response = await request(app).post('/api/zones').send(body);

      expect(response.status).toBe(201);
      expect(response.body.id).toBe('zone-001');
      expect(mockZoneService.createZone).toHaveBeenCalledWith(body);
    });

    it('returns 400 on validation error', async () => {
      mockZoneService.createZone.mockRejectedValue(
        new ZoneValidationError('Validation failed', [
          { field: 'name', message: 'Name is required' },
        ])
      );

      const response = await request(app).post('/api/zones').send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation failed');
      expect(response.body.details).toEqual([{ field: 'name', message: 'Name is required' }]);
    });

    it('returns 500 on unexpected service error', async () => {
      mockZoneService.createZone.mockRejectedValue(new Error('boom'));

      const response = await request(app).post('/api/zones').send({ name: 'X' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to create zone');
    });
  });

  // --------------------------------------------------------------------------
  // PUT /api/zones/:id
  // --------------------------------------------------------------------------

  describe('PUT /api/zones/:id', () => {
    it('updates a zone successfully', async () => {
      const updated = { ...MOCK_ZONE, name: 'Warehouse B' };
      mockZoneService.updateZone.mockResolvedValue(updated);

      const body = {
        name: 'Warehouse B',
        floor: '1',
        type: 'storage',
        bounds: { x: 0, y: 0, width: 10, height: 10 },
        color: '#FF6700',
        description: 'Renamed',
        metadata: null,
      };

      const response = await request(app).put('/api/zones/zone-001').send(body);

      expect(response.status).toBe(200);
      expect(response.body.name).toBe('Warehouse B');
      expect(mockZoneService.updateZone).toHaveBeenCalledWith('zone-001', body);
    });

    it('returns 404 when zone to update not found', async () => {
      mockZoneService.updateZone.mockResolvedValue(null);

      const response = await request(app).put('/api/zones/missing').send({ name: 'X' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Zone not found');
    });

    it('returns 400 on validation error', async () => {
      mockZoneService.updateZone.mockRejectedValue(
        new ZoneValidationError('Validation failed', [
          { field: 'bounds', message: 'Bounds is required' },
        ])
      );

      const response = await request(app).put('/api/zones/zone-001').send({ bounds: null });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation failed');
      expect(response.body.details).toEqual([{ field: 'bounds', message: 'Bounds is required' }]);
    });

    it('returns 500 on unexpected service error', async () => {
      mockZoneService.updateZone.mockRejectedValue(new Error('boom'));

      const response = await request(app).put('/api/zones/zone-001').send({ name: 'X' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to update zone');
    });
  });

  // --------------------------------------------------------------------------
  // DELETE /api/zones/:id
  // --------------------------------------------------------------------------

  describe('DELETE /api/zones/:id', () => {
    it('deletes a zone successfully', async () => {
      mockZoneService.deleteZone.mockResolvedValue(true);

      const response = await request(app).delete('/api/zones/zone-001');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockZoneService.deleteZone).toHaveBeenCalledWith('zone-001');
    });

    it('returns 404 when zone to delete not found', async () => {
      mockZoneService.deleteZone.mockResolvedValue(false);

      const response = await request(app).delete('/api/zones/missing');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Zone not found');
    });

    it('returns 500 on service error', async () => {
      mockZoneService.deleteZone.mockRejectedValue(new Error('boom'));

      const response = await request(app).delete('/api/zones/zone-001');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to delete zone');
    });
  });

  // --------------------------------------------------------------------------
  // DELETE /api/zones/floor/:floor
  // --------------------------------------------------------------------------

  describe('DELETE /api/zones/floor/:floor', () => {
    it('deletes all zones on a floor and returns the count', async () => {
      mockZoneService.deleteZonesByFloor.mockResolvedValue(3);

      const response = await request(app).delete('/api/zones/floor/2');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.deleted).toBe(3);
      expect(mockZoneService.deleteZonesByFloor).toHaveBeenCalledWith('2');
    });

    it('returns 500 on service error', async () => {
      mockZoneService.deleteZonesByFloor.mockRejectedValue(new Error('boom'));

      const response = await request(app).delete('/api/zones/floor/2');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to delete zones by floor');
    });
  });
});
