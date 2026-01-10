/**
 * @file compliance-log.routes.ts
 * @description REST API routes for compliance logging
 * @feature compliance
 *
 * Implements endpoints for:
 * - EU AI Act Article 12 (Record-keeping)
 * - GDPR Article 30 (Records of processing activities)
 * - Machinery Regulation Annex III
 */

import { Router, type Request, type Response } from 'express';
import { complianceLogService } from '../services/ComplianceLogService.js';
import { logExportService } from '../services/LogExportService.js';
import type { ComplianceEventType, ComplianceSeverity } from '../types/compliance.types.js';
import type { ExportOptions } from '../types/retention.types.js';

export const complianceLogRoutes = Router();

// ============================================================================
// LOG ENDPOINTS
// ============================================================================

/**
 * GET /logs - List compliance logs with pagination and filters
 * Query params:
 *   - page: number (default: 1)
 *   - limit: number (default: 50)
 *   - sessionId: string (optional)
 *   - robotId: string (optional)
 *   - operatorId: string (optional)
 *   - eventType: string (optional)
 *   - severity: string (optional)
 *   - startDate: string (optional) - ISO date string
 *   - endDate: string (optional) - ISO date string
 *   - decisionId: string (optional)
 *   - sortBy: 'timestamp' | 'severity' | 'eventType' (default: 'timestamp')
 *   - sortOrder: 'asc' | 'desc' (default: 'desc')
 */
complianceLogRoutes.get('/logs', async (req: Request, res: Response) => {
  try {
    const {
      page,
      limit,
      sessionId,
      robotId,
      operatorId,
      eventType,
      severity,
      startDate,
      endDate,
      decisionId,
      sortBy,
      sortOrder,
    } = req.query;

    const params = {
      page: page ? parseInt(page as string, 10) : 1,
      limit: limit ? parseInt(limit as string, 10) : 50,
      sessionId: sessionId as string | undefined,
      robotId: robotId as string | undefined,
      operatorId: operatorId as string | undefined,
      eventType: eventType as ComplianceEventType | undefined,
      severity: severity as ComplianceSeverity | undefined,
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined,
      decisionId: decisionId as string | undefined,
      sortBy: sortBy as 'timestamp' | 'severity' | 'eventType' | undefined,
      sortOrder: sortOrder as 'asc' | 'desc' | undefined,
    };

    const result = await complianceLogService.listLogs(params);
    res.json(result);
  } catch (error) {
    console.error('Error fetching compliance logs:', error);
    res.status(500).json({ error: 'Failed to fetch compliance logs' });
  }
});

/**
 * GET /logs/:id - Get a single compliance log by ID
 * Records access for audit trail
 */
complianceLogRoutes.get('/logs/:id', async (req: Request, res: Response) => {
  try {
    // Extract user info for audit trail (when auth is implemented)
    const userId = (req as Request & { user?: { id: string } }).user?.id;
    const ipAddress = req.ip || req.socket.remoteAddress;
    const userAgent = req.get('User-Agent');

    const log = await complianceLogService.getLog(
      req.params.id,
      userId,
      ipAddress,
      userAgent,
    );

    if (!log) {
      return res.status(404).json({ error: 'Compliance log not found' });
    }

    res.json(log);
  } catch (error) {
    console.error('Error fetching compliance log:', error);
    res.status(500).json({ error: 'Failed to fetch compliance log' });
  }
});

/**
 * GET /logs/:id/access-history - Get access history for a log
 */
complianceLogRoutes.get('/logs/:id/access-history', async (req: Request, res: Response) => {
  try {
    const history = await complianceLogService.getLogAccessHistory(req.params.id);
    res.json({ history });
  } catch (error) {
    console.error('Error fetching access history:', error);
    res.status(500).json({ error: 'Failed to fetch access history' });
  }
});

/**
 * GET /logs/decision/:decisionId - Get logs linked to a Decision
 */
complianceLogRoutes.get('/logs/decision/:decisionId', async (req: Request, res: Response) => {
  try {
    const logs = await complianceLogService.getLogsByDecision(req.params.decisionId);
    res.json({ logs });
  } catch (error) {
    console.error('Error fetching logs by decision:', error);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

/**
 * GET /logs/session/:sessionId - Get logs for a session
 */
complianceLogRoutes.get('/logs/session/:sessionId', async (req: Request, res: Response) => {
  try {
    const logs = await complianceLogService.getLogsBySession(req.params.sessionId);
    res.json({ logs });
  } catch (error) {
    console.error('Error fetching logs by session:', error);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

/**
 * POST /logs - Create a new compliance log (used by robot-agent)
 * Body:
 *   - sessionId: string (required)
 *   - robotId: string (required)
 *   - operatorId: string (optional)
 *   - eventType: string (required)
 *   - severity: string (optional, default: 'info')
 *   - payload: object (required)
 *   - modelVersion: string (optional)
 *   - modelHash: string (optional)
 *   - inputHash: string (optional)
 *   - outputHash: string (optional)
 *   - decisionId: string (optional)
 */
complianceLogRoutes.post('/logs', async (req: Request, res: Response) => {
  try {
    const {
      sessionId,
      robotId,
      operatorId,
      eventType,
      severity,
      payload,
      modelVersion,
      modelHash,
      inputHash,
      outputHash,
      decisionId,
    } = req.body;

    // Validation
    if (!sessionId || !robotId || !eventType || !payload) {
      return res.status(400).json({
        error: 'Missing required fields: sessionId, robotId, eventType, payload',
      });
    }

    const validEventTypes = ['ai_decision', 'safety_action', 'command_execution', 'system_event', 'access_audit'];
    if (!validEventTypes.includes(eventType)) {
      return res.status(400).json({
        error: `Invalid eventType. Must be one of: ${validEventTypes.join(', ')}`,
      });
    }

    // Route to appropriate logging method based on event type
    let log;
    switch (eventType) {
      case 'ai_decision':
        log = await complianceLogService.logAIDecision({
          sessionId,
          robotId,
          operatorId,
          payload,
          modelVersion,
          modelHash,
          decisionId,
          severity,
        });
        break;
      case 'safety_action':
        log = await complianceLogService.logSafetyAction({
          sessionId,
          robotId,
          operatorId,
          payload,
          decisionId,
        });
        break;
      case 'command_execution':
        log = await complianceLogService.logCommandExecution({
          sessionId,
          robotId,
          operatorId,
          payload,
          decisionId,
          severity,
        });
        break;
      case 'system_event':
        log = await complianceLogService.logSystemEvent({
          sessionId,
          robotId,
          payload,
          severity,
        });
        break;
      case 'access_audit':
        log = await complianceLogService.logAccess({
          sessionId,
          robotId,
          operatorId,
          payload,
          severity,
        });
        break;
    }

    res.status(201).json(log);
  } catch (error) {
    console.error('Error creating compliance log:', error);
    res.status(500).json({ error: 'Failed to create compliance log' });
  }
});

// ============================================================================
// VERIFICATION ENDPOINTS
// ============================================================================

/**
 * POST /verify - Verify hash chain integrity
 * Body:
 *   - startDate: string (optional) - ISO date string
 *   - endDate: string (optional) - ISO date string
 */
complianceLogRoutes.post('/verify', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.body;

    const result = await complianceLogService.verifyIntegrity(
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
    );

    res.json(result);
  } catch (error) {
    console.error('Error verifying hash chain:', error);
    res.status(500).json({ error: 'Failed to verify hash chain integrity' });
  }
});

/**
 * GET /verify - Quick hash chain verification (last 1000 logs)
 */
complianceLogRoutes.get('/verify', async (_req: Request, res: Response) => {
  try {
    const result = await complianceLogService.verifyIntegrity();
    res.json(result);
  } catch (error) {
    console.error('Error verifying hash chain:', error);
    res.status(500).json({ error: 'Failed to verify hash chain integrity' });
  }
});

// ============================================================================
// METRICS ENDPOINTS
// ============================================================================

/**
 * GET /metrics - Get compliance metrics summary
 * Query params:
 *   - startDate: string (optional) - ISO date string
 *   - endDate: string (optional) - ISO date string
 */
complianceLogRoutes.get('/metrics', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.query;

    const metrics = await complianceLogService.getMetricsSummary(
      startDate ? new Date(startDate as string) : undefined,
      endDate ? new Date(endDate as string) : undefined,
    );

    res.json(metrics);
  } catch (error) {
    console.error('Error fetching compliance metrics:', error);
    res.status(500).json({ error: 'Failed to fetch compliance metrics' });
  }
});

/**
 * GET /metrics/event-types - Get event type counts
 * Query params:
 *   - startDate: string (optional) - ISO date string
 *   - endDate: string (optional) - ISO date string
 */
complianceLogRoutes.get('/metrics/event-types', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.query;

    const counts = await complianceLogService.getEventTypeCounts(
      startDate ? new Date(startDate as string) : undefined,
      endDate ? new Date(endDate as string) : undefined,
    );

    res.json({ counts });
  } catch (error) {
    console.error('Error fetching event type counts:', error);
    res.status(500).json({ error: 'Failed to fetch event type counts' });
  }
});

// ============================================================================
// SESSION ENDPOINTS
// ============================================================================

/**
 * POST /sessions - Start a new compliance logging session
 * Body:
 *   - robotId: string (required)
 */
complianceLogRoutes.post('/sessions', async (req: Request, res: Response) => {
  try {
    const { robotId } = req.body;

    if (!robotId) {
      return res.status(400).json({ error: 'Missing required field: robotId' });
    }

    const session = complianceLogService.startSession(robotId);
    res.status(201).json(session);
  } catch (error) {
    console.error('Error starting session:', error);
    res.status(500).json({ error: 'Failed to start session' });
  }
});

/**
 * GET /sessions/:sessionId - Get session details
 */
complianceLogRoutes.get('/sessions/:sessionId', async (req: Request, res: Response) => {
  try {
    const session = complianceLogService.getSession(req.params.sessionId);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json(session);
  } catch (error) {
    console.error('Error fetching session:', error);
    res.status(500).json({ error: 'Failed to fetch session' });
  }
});

/**
 * GET /sessions/robot/:robotId - Get session by robot ID
 */
complianceLogRoutes.get('/sessions/robot/:robotId', async (req: Request, res: Response) => {
  try {
    const session = complianceLogService.getSessionByRobotId(req.params.robotId);

    if (!session) {
      return res.status(404).json({ error: 'No active session for robot' });
    }

    res.json(session);
  } catch (error) {
    console.error('Error fetching session by robot:', error);
    res.status(500).json({ error: 'Failed to fetch session' });
  }
});

/**
 * DELETE /sessions/:sessionId - End a session
 */
complianceLogRoutes.delete('/sessions/:sessionId', async (req: Request, res: Response) => {
  try {
    const session = complianceLogService.endSession(req.params.sessionId);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json(session);
  } catch (error) {
    console.error('Error ending session:', error);
    res.status(500).json({ error: 'Failed to end session' });
  }
});

// ============================================================================
// EXPORT ENDPOINTS
// ============================================================================

/**
 * POST /export - Export compliance logs to JSON
 * Body:
 *   - startDate: string (optional) - ISO date string
 *   - endDate: string (optional) - ISO date string
 *   - eventTypes: string[] (optional) - Filter by event types
 *   - robotIds: string[] (optional) - Filter by robot IDs
 *   - sessionIds: string[] (optional) - Filter by session IDs
 *   - includeDecrypted: boolean (optional) - Include decrypted payloads
 */
complianceLogRoutes.post('/export', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, eventTypes, robotIds, sessionIds, includeDecrypted } = req.body;

    const options: ExportOptions = {
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      eventTypes: eventTypes as ComplianceEventType[] | undefined,
      robotIds: robotIds as string[] | undefined,
      sessionIds: sessionIds as string[] | undefined,
      includeDecrypted: includeDecrypted ?? false,
    };

    // Extract user info for audit trail
    const userId = (req as Request & { user?: { id: string } }).user?.id;

    const result = await logExportService.exportToJson(options, userId);

    // Set headers for file download
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.json(result);
  } catch (error) {
    console.error('Error exporting compliance logs:', error);
    res.status(500).json({ error: 'Failed to export compliance logs' });
  }
});

/**
 * GET /export/history - Get export history
 * Query params:
 *   - limit: number (default: 50)
 */
complianceLogRoutes.get('/export/history', async (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
    const history = await logExportService.getExportHistory(limit);
    res.json({ history });
  } catch (error) {
    console.error('Error fetching export history:', error);
    res.status(500).json({ error: 'Failed to fetch export history' });
  }
});
