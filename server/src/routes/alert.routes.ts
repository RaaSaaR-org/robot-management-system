/**
 * @file alert.routes.ts
 * @description REST API routes for alert management
 */

import { Router, type Request, type Response } from 'express';
import { alertService, type AlertSeverity, type AlertSource } from '../services/AlertService.js';

export const alertRoutes = Router();

/**
 * GET / - List alerts with optional filters and pagination
 * Query params:
 *   - severity: AlertSeverity | AlertSeverity[] (comma-separated)
 *   - source: AlertSource | AlertSource[] (comma-separated)
 *   - sourceId: string
 *   - acknowledged: boolean
 *   - startDate: ISO date string
 *   - endDate: ISO date string
 *   - page: number (default: 1)
 *   - pageSize: number (default: 50)
 */
alertRoutes.get('/', async (req: Request, res: Response) => {
  try {
    const {
      severity,
      source,
      sourceId,
      acknowledged,
      startDate,
      endDate,
      page,
      pageSize,
    } = req.query;

    // Build filters
    const filters: {
      severity?: AlertSeverity | AlertSeverity[];
      source?: AlertSource | AlertSource[];
      sourceId?: string;
      acknowledged?: boolean;
      startDate?: Date;
      endDate?: Date;
    } = {};

    if (severity) {
      const severities = (severity as string).split(',') as AlertSeverity[];
      filters.severity = severities.length === 1 ? severities[0] : severities;
    }

    if (source) {
      const sources = (source as string).split(',') as AlertSource[];
      filters.source = sources.length === 1 ? sources[0] : sources;
    }

    if (sourceId) {
      filters.sourceId = sourceId as string;
    }

    if (acknowledged !== undefined) {
      filters.acknowledged = acknowledged === 'true';
    }

    if (startDate) {
      filters.startDate = new Date(startDate as string);
    }

    if (endDate) {
      filters.endDate = new Date(endDate as string);
    }

    const pagination = {
      page: page ? parseInt(page as string, 10) : 1,
      pageSize: pageSize ? parseInt(pageSize as string, 10) : 50,
    };

    const result = await alertService.getAlerts(filters, pagination);
    res.json(result);
  } catch (error) {
    console.error('Error listing alerts:', error);
    res.status(500).json({ error: 'Failed to list alerts' });
  }
});

/**
 * GET /active - Get active (unacknowledged) alerts
 * Query params:
 *   - severity: AlertSeverity | AlertSeverity[] (comma-separated)
 *   - source: AlertSource | AlertSource[] (comma-separated)
 *   - sourceId: string
 */
alertRoutes.get('/active', async (req: Request, res: Response) => {
  try {
    const { severity, source, sourceId } = req.query;

    const filters: {
      severity?: AlertSeverity | AlertSeverity[];
      source?: AlertSource | AlertSource[];
      sourceId?: string;
    } = {};

    if (severity) {
      const severities = (severity as string).split(',') as AlertSeverity[];
      filters.severity = severities.length === 1 ? severities[0] : severities;
    }

    if (source) {
      const sources = (source as string).split(',') as AlertSource[];
      filters.source = sources.length === 1 ? sources[0] : sources;
    }

    if (sourceId) {
      filters.sourceId = sourceId as string;
    }

    const alerts = await alertService.getActiveAlerts(filters);
    res.json({ alerts });
  } catch (error) {
    console.error('Error getting active alerts:', error);
    res.status(500).json({ error: 'Failed to get active alerts' });
  }
});

/**
 * GET /counts - Get alert counts by severity
 */
alertRoutes.get('/counts', async (_req: Request, res: Response) => {
  try {
    const counts = await alertService.getAlertCounts();
    res.json({ counts });
  } catch (error) {
    console.error('Error getting alert counts:', error);
    res.status(500).json({ error: 'Failed to get alert counts' });
  }
});

/**
 * GET /history - Get alert history (alias for / with all alerts)
 */
alertRoutes.get('/history', async (req: Request, res: Response) => {
  try {
    const { page, pageSize, ...filters } = req.query;

    const filtersParsed: {
      severity?: AlertSeverity | AlertSeverity[];
      source?: AlertSource | AlertSource[];
      sourceId?: string;
      startDate?: Date;
      endDate?: Date;
    } = {};

    if (filters.severity) {
      const severities = (filters.severity as string).split(',') as AlertSeverity[];
      filtersParsed.severity = severities.length === 1 ? severities[0] : severities;
    }

    if (filters.source) {
      const sources = (filters.source as string).split(',') as AlertSource[];
      filtersParsed.source = sources.length === 1 ? sources[0] : sources;
    }

    if (filters.sourceId) {
      filtersParsed.sourceId = filters.sourceId as string;
    }

    if (filters.startDate) {
      filtersParsed.startDate = new Date(filters.startDate as string);
    }

    if (filters.endDate) {
      filtersParsed.endDate = new Date(filters.endDate as string);
    }

    const pagination = {
      page: page ? parseInt(page as string, 10) : 1,
      pageSize: pageSize ? parseInt(pageSize as string, 10) : 50,
    };

    const result = await alertService.getAlertHistory(filtersParsed, pagination);
    res.json(result);
  } catch (error) {
    console.error('Error getting alert history:', error);
    res.status(500).json({ error: 'Failed to get alert history' });
  }
});

/**
 * GET /:id - Get a single alert by ID
 */
alertRoutes.get('/:id', async (req: Request, res: Response) => {
  try {
    const alert = await alertService.getAlert(req.params.id);

    if (!alert) {
      return res.status(404).json({ error: 'Alert not found' });
    }

    res.json(alert);
  } catch (error) {
    console.error('Error getting alert:', error);
    res.status(500).json({ error: 'Failed to get alert' });
  }
});

/**
 * POST / - Create a new alert
 * Body: CreateAlertInput
 */
alertRoutes.post('/', async (req: Request, res: Response) => {
  try {
    const { severity, title, message, source, sourceId, dismissable, autoDismissMs } = req.body;

    if (!severity || !title || !message || !source) {
      return res.status(400).json({
        error: 'Missing required fields: severity, title, message, source',
      });
    }

    const validSeverities = ['critical', 'error', 'warning', 'info'];
    if (!validSeverities.includes(severity)) {
      return res.status(400).json({
        error: `Invalid severity. Must be one of: ${validSeverities.join(', ')}`,
      });
    }

    const validSources = ['robot', 'task', 'system', 'user'];
    if (!validSources.includes(source)) {
      return res.status(400).json({
        error: `Invalid source. Must be one of: ${validSources.join(', ')}`,
      });
    }

    const alert = await alertService.createAlert({
      severity,
      title,
      message,
      source,
      sourceId,
      dismissable,
      autoDismissMs,
    });

    res.status(201).json(alert);
  } catch (error) {
    console.error('Error creating alert:', error);
    res.status(500).json({ error: 'Failed to create alert' });
  }
});

/**
 * PATCH /:id/acknowledge - Acknowledge an alert
 */
alertRoutes.patch('/:id/acknowledge', async (req: Request, res: Response) => {
  try {
    // Get user ID from auth if available
    const userId = (req as Request & { user?: { id: string } }).user?.id;

    const alert = await alertService.acknowledgeAlert(req.params.id, userId);

    if (!alert) {
      return res.status(404).json({ error: 'Alert not found' });
    }

    res.json(alert);
  } catch (error) {
    console.error('Error acknowledging alert:', error);
    res.status(500).json({ error: 'Failed to acknowledge alert' });
  }
});

/**
 * DELETE /:id - Delete an alert
 */
alertRoutes.delete('/:id', async (req: Request, res: Response) => {
  try {
    const deleted = await alertService.deleteAlert(req.params.id);

    if (!deleted) {
      return res.status(404).json({ error: 'Alert not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting alert:', error);
    res.status(500).json({ error: 'Failed to delete alert' });
  }
});

/**
 * DELETE /clear/acknowledged - Clear all acknowledged alerts
 */
alertRoutes.delete('/clear/acknowledged', async (_req: Request, res: Response) => {
  try {
    const count = await alertService.clearAcknowledgedAlerts();
    res.json({ success: true, deleted: count });
  } catch (error) {
    console.error('Error clearing acknowledged alerts:', error);
    res.status(500).json({ error: 'Failed to clear acknowledged alerts' });
  }
});

/**
 * DELETE /clear/all - Clear all alerts (requires admin)
 */
alertRoutes.delete('/clear/all', async (_req: Request, res: Response) => {
  try {
    const count = await alertService.clearAllAlerts();
    res.json({ success: true, deleted: count });
  } catch (error) {
    console.error('Error clearing all alerts:', error);
    res.status(500).json({ error: 'Failed to clear all alerts' });
  }
});
