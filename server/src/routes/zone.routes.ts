/**
 * @file zone.routes.ts
 * @description REST API routes for zone management
 */

import { Router, type Request, type Response } from 'express';
import {
  zoneService,
  ZoneValidationError,
  type ZoneType,
} from '../services/ZoneService.js';

export const zoneRoutes = Router();

/**
 * GET / - List zones with optional filters and pagination
 * Query params:
 *   - floor: string
 *   - type: ZoneType | ZoneType[] (comma-separated)
 *   - page: number (default: 1)
 *   - pageSize: number (default: 100)
 */
zoneRoutes.get('/', async (req: Request, res: Response) => {
  try {
    const { floor, type, page, pageSize } = req.query;

    // Build filters
    const filters: {
      floor?: string;
      type?: ZoneType | ZoneType[];
    } = {};

    if (floor) {
      filters.floor = floor as string;
    }

    if (type) {
      const types = (type as string).split(',') as ZoneType[];
      filters.type = types.length === 1 ? types[0] : types;
    }

    // Parse and validate pagination with bounds
    const parsedPage = page ? parseInt(page as string, 10) : 1;
    const parsedPageSize = pageSize ? parseInt(pageSize as string, 10) : 100;

    const pagination = {
      page: Math.max(1, Number.isFinite(parsedPage) ? parsedPage : 1),
      pageSize: Math.min(1000, Math.max(1, Number.isFinite(parsedPageSize) ? parsedPageSize : 100)),
    };

    const result = await zoneService.getZones(filters, pagination);
    res.json(result);
  } catch (error) {
    console.error('Error listing zones:', error);
    res.status(500).json({ error: 'Failed to list zones' });
  }
});

/**
 * GET /at-point - Find zone at a specific point
 * Query params:
 *   - x: number
 *   - y: number
 *   - floor: string
 */
zoneRoutes.get('/at-point', async (req: Request, res: Response) => {
  try {
    const { x, y, floor } = req.query;

    if (x === undefined || y === undefined || !floor) {
      return res.status(400).json({
        error: 'Missing required query params: x, y, floor',
      });
    }

    // Parse and validate coordinates
    const xVal = parseFloat(x as string);
    const yVal = parseFloat(y as string);

    if (!Number.isFinite(xVal) || !Number.isFinite(yVal)) {
      return res.status(400).json({
        error: 'Invalid coordinates: x and y must be valid finite numbers',
      });
    }

    const zone = await zoneService.getZoneAtPoint(
      xVal,
      yVal,
      floor as string
    );

    if (!zone) {
      return res.status(404).json({ error: 'No zone found at point' });
    }

    res.json(zone);
  } catch (error) {
    console.error('Error finding zone at point:', error);
    res.status(500).json({ error: 'Failed to find zone at point' });
  }
});

/**
 * GET /named-locations - Get derived named locations from zone centers
 * Returns a mapping of location name to coordinates (single source of truth)
 */
zoneRoutes.get('/named-locations', async (_req: Request, res: Response) => {
  try {
    const locations = await zoneService.getNamedLocations();
    res.json({ locations });
  } catch (error) {
    console.error('Error getting named locations:', error);
    res.status(500).json({ error: 'Failed to get named locations' });
  }
});

/**
 * GET /floor/:floor - Get all zones on a specific floor
 */
zoneRoutes.get('/floor/:floor', async (req: Request, res: Response) => {
  try {
    const zones = await zoneService.getZonesByFloor(req.params.floor);
    res.json({ zones });
  } catch (error) {
    console.error('Error getting zones by floor:', error);
    res.status(500).json({ error: 'Failed to get zones by floor' });
  }
});

/**
 * GET /:id - Get a single zone by ID
 */
zoneRoutes.get('/:id', async (req: Request, res: Response) => {
  try {
    const zone = await zoneService.getZone(req.params.id);

    if (!zone) {
      return res.status(404).json({ error: 'Zone not found' });
    }

    res.json(zone);
  } catch (error) {
    console.error('Error getting zone:', error);
    res.status(500).json({ error: 'Failed to get zone' });
  }
});

/**
 * POST / - Create a new zone
 * Body: CreateZoneInput
 */
zoneRoutes.post('/', async (req: Request, res: Response) => {
  try {
    const { name, floor, type, bounds, color, description, metadata } = req.body;

    const zone = await zoneService.createZone({
      name,
      floor,
      type,
      bounds,
      color,
      description,
      metadata,
    });

    res.status(201).json(zone);
  } catch (error) {
    if (error instanceof ZoneValidationError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors,
      });
    }
    console.error('Error creating zone:', error);
    res.status(500).json({ error: 'Failed to create zone' });
  }
});

/**
 * PUT /:id - Update a zone
 * Body: UpdateZoneInput
 */
zoneRoutes.put('/:id', async (req: Request, res: Response) => {
  try {
    const { name, floor, type, bounds, color, description, metadata } = req.body;

    const zone = await zoneService.updateZone(req.params.id, {
      name,
      floor,
      type,
      bounds,
      color,
      description,
      metadata,
    });

    if (!zone) {
      return res.status(404).json({ error: 'Zone not found' });
    }

    res.json(zone);
  } catch (error) {
    if (error instanceof ZoneValidationError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors,
      });
    }
    console.error('Error updating zone:', error);
    res.status(500).json({ error: 'Failed to update zone' });
  }
});

/**
 * DELETE /:id - Delete a zone
 */
zoneRoutes.delete('/:id', async (req: Request, res: Response) => {
  try {
    const deleted = await zoneService.deleteZone(req.params.id);

    if (!deleted) {
      return res.status(404).json({ error: 'Zone not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting zone:', error);
    res.status(500).json({ error: 'Failed to delete zone' });
  }
});

/**
 * DELETE /floor/:floor - Delete all zones on a floor
 */
zoneRoutes.delete('/floor/:floor', async (req: Request, res: Response) => {
  try {
    const count = await zoneService.deleteZonesByFloor(req.params.floor);
    res.json({ success: true, deleted: count });
  } catch (error) {
    console.error('Error deleting zones by floor:', error);
    res.status(500).json({ error: 'Failed to delete zones by floor' });
  }
});
