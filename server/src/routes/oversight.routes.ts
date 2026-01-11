/**
 * @file oversight.routes.ts
 * @description REST API routes for human oversight mechanisms (EU AI Act Art. 14)
 * @feature oversight
 */

import { Router, type Request, type Response } from 'express';
import { oversightService } from '../services/OversightService.js';
import type {
  AnomalyType,
  AnomalySeverity,
  OversightActionType,
  VerificationStatus,
} from '../types/oversight.types.js';

export const oversightRoutes = Router();

// ============================================================================
// MANUAL CONTROL MODE
// ============================================================================

/**
 * POST /robots/:id/manual-mode - Activate manual control mode for a robot
 * Body: { reason: string, mode?: 'reduced_speed' | 'full_speed' }
 */
oversightRoutes.post('/robots/:id/manual-mode', async (req: Request, res: Response) => {
  try {
    const robotId = req.params.id;
    const { reason, mode } = req.body;
    const operatorId = req.body.operatorId || 'system'; // TODO: Get from auth

    if (!reason) {
      return res.status(400).json({ error: 'Reason is required' });
    }

    const result = await oversightService.activateManualMode({
      robotId,
      operatorId,
      reason,
      mode,
    });

    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to activate manual mode';
    res.status(500).json({ error: message });
  }
});

/**
 * DELETE /robots/:id/manual-mode - Deactivate manual control mode
 */
oversightRoutes.delete('/robots/:id/manual-mode', async (req: Request, res: Response) => {
  try {
    const robotId = req.params.id;
    const operatorId = req.body.operatorId || 'system'; // TODO: Get from auth

    // Get active session for this robot
    const session = await oversightService.getRobotManualSession(robotId);
    if (!session) {
      return res.status(404).json({ error: 'No active manual session for this robot' });
    }

    const result = await oversightService.deactivateManualMode(session.id, operatorId);
    if (!result) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to deactivate manual mode';
    res.status(500).json({ error: message });
  }
});

/**
 * GET /manual-sessions - List active manual control sessions
 */
oversightRoutes.get('/manual-sessions', async (req: Request, res: Response) => {
  try {
    const { robotId, operatorId, isActive, startDate, endDate } = req.query;

    const params: Record<string, unknown> = {};
    if (robotId) params.robotId = robotId as string;
    if (operatorId) params.operatorId = operatorId as string;
    if (isActive !== undefined) params.isActive = isActive === 'true';
    if (startDate) params.startDate = new Date(startDate as string);
    if (endDate) params.endDate = new Date(endDate as string);

    const sessions = await oversightService.getManualSessionHistory(params);
    res.json(sessions);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get manual sessions';
    res.status(500).json({ error: message });
  }
});

// ============================================================================
// VERIFICATION SCHEDULES
// ============================================================================

/**
 * GET /verifications - List verification schedules
 */
oversightRoutes.get('/verifications', async (req: Request, res: Response) => {
  try {
    const { isActive, robotScope, scopeId } = req.query;

    const params: Record<string, unknown> = {};
    if (isActive !== undefined) params.isActive = isActive === 'true';
    if (robotScope) params.robotScope = robotScope as string;
    if (scopeId) params.scopeId = scopeId as string;

    const schedules = await oversightService.getVerificationSchedules(params);
    res.json(schedules);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get verification schedules';
    res.status(500).json({ error: message });
  }
});

/**
 * POST /verifications - Create a new verification schedule
 * Body: { name, description?, intervalMinutes, robotScope?, scopeId? }
 */
oversightRoutes.post('/verifications', async (req: Request, res: Response) => {
  try {
    const { name, description, intervalMinutes, robotScope, scopeId } = req.body;

    if (!name || !intervalMinutes) {
      return res.status(400).json({ error: 'Name and intervalMinutes are required' });
    }

    const schedule = await oversightService.createVerificationSchedule({
      name,
      description,
      intervalMinutes,
      robotScope,
      scopeId,
    });

    res.status(201).json(schedule);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create verification schedule';
    res.status(500).json({ error: message });
  }
});

/**
 * GET /verifications/due - Get due verifications
 */
oversightRoutes.get('/verifications/due', async (req: Request, res: Response) => {
  try {
    const dueVerifications = await oversightService.getDueVerifications();
    res.json(dueVerifications);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get due verifications';
    res.status(500).json({ error: message });
  }
});

/**
 * POST /verifications/:id/complete - Complete a verification
 * Body: { status: 'completed' | 'skipped' | 'deferred', notes?, robotId? }
 */
oversightRoutes.post('/verifications/:id/complete', async (req: Request, res: Response) => {
  try {
    const scheduleId = req.params.id;
    const { status, notes, robotId } = req.body;
    const operatorId = req.body.operatorId || 'system'; // TODO: Get from auth

    if (!status || !['completed', 'skipped', 'deferred'].includes(status)) {
      return res.status(400).json({ error: 'Valid status is required' });
    }

    const completion = await oversightService.completeVerification({
      scheduleId,
      operatorId,
      status: status as VerificationStatus,
      notes,
      robotId,
    });

    res.status(201).json(completion);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to complete verification';
    res.status(500).json({ error: message });
  }
});

/**
 * PATCH /verifications/:id - Update a verification schedule
 */
oversightRoutes.patch('/verifications/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const { name, description, intervalMinutes, robotScope, scopeId } = req.body;

    const schedule = await oversightService.updateVerificationSchedule(id, {
      name,
      description,
      intervalMinutes,
      robotScope,
      scopeId,
    });

    if (!schedule) {
      return res.status(404).json({ error: 'Verification schedule not found' });
    }

    res.json(schedule);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update verification schedule';
    res.status(500).json({ error: message });
  }
});

/**
 * DELETE /verifications/:id - Deactivate a verification schedule
 */
oversightRoutes.delete('/verifications/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const schedule = await oversightService.deactivateVerificationSchedule(id);

    if (!schedule) {
      return res.status(404).json({ error: 'Verification schedule not found' });
    }

    res.json(schedule);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to deactivate verification schedule';
    res.status(500).json({ error: message });
  }
});

// ============================================================================
// ANOMALIES
// ============================================================================

/**
 * GET /anomalies - List anomalies with filters
 * Query params: robotId, anomalyType, severity, isActive, startDate, endDate, page, limit
 */
oversightRoutes.get('/anomalies', async (req: Request, res: Response) => {
  try {
    const {
      robotId,
      anomalyType,
      severity,
      isActive,
      startDate,
      endDate,
      page,
      limit,
    } = req.query;

    const params: Record<string, unknown> = {};

    if (robotId) params.robotId = robotId as string;
    if (isActive !== undefined) params.isActive = isActive === 'true';

    if (anomalyType) {
      const types = (anomalyType as string).split(',') as AnomalyType[];
      params.anomalyType = types.length === 1 ? types[0] : types;
    }

    if (severity) {
      const severities = (severity as string).split(',') as AnomalySeverity[];
      params.severity = severities.length === 1 ? severities[0] : severities;
    }

    if (startDate) params.startDate = new Date(startDate as string);
    if (endDate) params.endDate = new Date(endDate as string);
    if (page) params.page = parseInt(page as string, 10);
    if (limit) params.limit = parseInt(limit as string, 10);

    const result = await oversightService.getAnomalies(params);
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get anomalies';
    res.status(500).json({ error: message });
  }
});

/**
 * GET /anomalies/active - Get all active anomalies
 */
oversightRoutes.get('/anomalies/active', async (req: Request, res: Response) => {
  try {
    const robotId = req.query.robotId as string | undefined;
    const anomalies = await oversightService.getActiveAnomalies(robotId);
    res.json(anomalies);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get active anomalies';
    res.status(500).json({ error: message });
  }
});

/**
 * GET /anomalies/unacknowledged - Get unacknowledged anomalies
 */
oversightRoutes.get('/anomalies/unacknowledged', async (req: Request, res: Response) => {
  try {
    const anomalies = await oversightService.getUnacknowledgedAnomalies();
    res.json(anomalies);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get unacknowledged anomalies';
    res.status(500).json({ error: message });
  }
});

/**
 * POST /anomalies/:id/acknowledge - Acknowledge an anomaly
 */
oversightRoutes.post('/anomalies/:id/acknowledge', async (req: Request, res: Response) => {
  try {
    const anomalyId = req.params.id;
    const operatorId = req.body.operatorId || 'system'; // TODO: Get from auth

    const anomaly = await oversightService.acknowledgeAnomaly(anomalyId, operatorId);
    if (!anomaly) {
      return res.status(404).json({ error: 'Anomaly not found' });
    }

    res.json(anomaly);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to acknowledge anomaly';
    res.status(500).json({ error: message });
  }
});

/**
 * POST /anomalies/:id/resolve - Resolve an anomaly
 * Body: { resolution: string }
 */
oversightRoutes.post('/anomalies/:id/resolve', async (req: Request, res: Response) => {
  try {
    const anomalyId = req.params.id;
    const { resolution } = req.body;
    const operatorId = req.body.operatorId || 'system'; // TODO: Get from auth

    if (!resolution) {
      return res.status(400).json({ error: 'Resolution is required' });
    }

    const anomaly = await oversightService.resolveAnomaly(anomalyId, resolution, operatorId);
    if (!anomaly) {
      return res.status(404).json({ error: 'Anomaly not found' });
    }

    res.json(anomaly);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to resolve anomaly';
    res.status(500).json({ error: message });
  }
});

// ============================================================================
// CAPABILITIES & STATUS
// ============================================================================

/**
 * GET /robots/:id/capabilities - Get robot capabilities summary
 */
oversightRoutes.get('/robots/:id/capabilities', async (req: Request, res: Response) => {
  try {
    const robotId = req.params.id;
    const summary = await oversightService.getRobotCapabilitiesSummary(robotId);

    if (!summary) {
      return res.status(404).json({ error: 'Robot not found' });
    }

    res.json(summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get robot capabilities';
    res.status(500).json({ error: message });
  }
});

/**
 * GET /fleet/overview - Get fleet capabilities overview
 */
oversightRoutes.get('/fleet/overview', async (req: Request, res: Response) => {
  try {
    const overview = await oversightService.getFleetCapabilitiesOverview();
    res.json(overview);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get fleet overview';
    res.status(500).json({ error: message });
  }
});

// ============================================================================
// OVERSIGHT LOGS
// ============================================================================

/**
 * GET /logs - Get oversight logs with filters
 * Query params: actionType, operatorId, robotId, startDate, endDate, page, limit
 */
oversightRoutes.get('/logs', async (req: Request, res: Response) => {
  try {
    const {
      actionType,
      operatorId,
      robotId,
      startDate,
      endDate,
      page,
      limit,
    } = req.query;

    const params: Record<string, unknown> = {};

    if (operatorId) params.operatorId = operatorId as string;
    if (robotId) params.robotId = robotId as string;

    if (actionType) {
      const types = (actionType as string).split(',') as OversightActionType[];
      params.actionType = types.length === 1 ? types[0] : types;
    }

    if (startDate) params.startDate = new Date(startDate as string);
    if (endDate) params.endDate = new Date(endDate as string);
    if (page) params.page = parseInt(page as string, 10);
    if (limit) params.limit = parseInt(limit as string, 10);

    const result = await oversightService.getOversightLogs(params);
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get oversight logs';
    res.status(500).json({ error: message });
  }
});

// ============================================================================
// DASHBOARD
// ============================================================================

/**
 * GET /dashboard - Get oversight dashboard statistics
 */
oversightRoutes.get('/dashboard', async (req: Request, res: Response) => {
  try {
    const stats = await oversightService.getDashboardStats();
    res.json(stats);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get dashboard stats';
    res.status(500).json({ error: message });
  }
});
