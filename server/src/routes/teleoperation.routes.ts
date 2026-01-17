/**
 * @file teleoperation.routes.ts
 * @description REST API endpoints for teleoperation data collection
 * @feature datacollection
 */

import { Router, Request, Response } from 'express';
import { teleoperationService } from '../services/TeleoperationService.js';
import type {
  CreateSessionDto,
  RecordFrameDto,
  BatchRecordFramesDto,
  UpdateSessionDto,
  AnnotateSessionDto,
  ExportSessionDto,
  SessionListQuery,
  TeleoperationType,
  TeleoperationStatus,
} from '../types/teleoperation.types.js';

export const teleoperationRoutes = Router();

// ============================================================================
// POST /api/teleoperation/sessions - Create new session
// ============================================================================

teleoperationRoutes.post('/sessions', async (req: Request, res: Response) => {
  try {
    const dto = req.body as CreateSessionDto;

    // Validate required fields
    if (!dto.operatorId) {
      return res.status(400).json({ error: 'operatorId is required' });
    }
    if (!dto.robotId) {
      return res.status(400).json({ error: 'robotId is required' });
    }
    if (!dto.type) {
      return res.status(400).json({ error: 'type is required' });
    }

    const validTypes = [
      'vr_quest',
      'vr_vision_pro',
      'bilateral_aloha',
      'kinesthetic',
      'keyboard_mouse',
      'gamepad',
    ];
    if (!validTypes.includes(dto.type)) {
      return res.status(400).json({
        error: `Invalid type. Must be one of: ${validTypes.join(', ')}`,
      });
    }

    const session = await teleoperationService.createSession(dto);

    res.status(201).json({
      session,
      message: 'Teleoperation session created successfully',
    });
  } catch (error) {
    console.error('[TeleoperationRoutes] Error creating session:', error);
    const message = error instanceof Error ? error.message : 'Failed to create session';
    res.status(400).json({ error: message });
  }
});

// ============================================================================
// GET /api/teleoperation/sessions - List sessions
// ============================================================================

teleoperationRoutes.get('/sessions', async (req: Request, res: Response) => {
  try {
    const query = req.query as Record<string, string | undefined>;

    const params: SessionListQuery = {
      operatorId: query.operatorId,
      robotId: query.robotId,
      page: query.page ? parseInt(query.page, 10) : undefined,
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
    };

    // Parse type parameter
    if (query.type) {
      params.type = query.type.includes(',')
        ? (query.type.split(',') as TeleoperationType[])
        : (query.type as TeleoperationType);
    }

    // Parse status parameter
    if (query.status) {
      params.status = query.status.includes(',')
        ? (query.status.split(',') as TeleoperationStatus[])
        : (query.status as TeleoperationStatus);
    }

    // Parse date parameters
    if (query.startDate) {
      params.startDate = new Date(query.startDate);
    }
    if (query.endDate) {
      params.endDate = new Date(query.endDate);
    }

    const result = await teleoperationService.listSessions(params);

    res.json({
      sessions: result.sessions,
      pagination: result.pagination,
    });
  } catch (error) {
    console.error('[TeleoperationRoutes] Error listing sessions:', error);
    res.status(500).json({ error: 'Failed to list sessions' });
  }
});

// ============================================================================
// GET /api/teleoperation/sessions/:id - Get session details
// ============================================================================

teleoperationRoutes.get('/sessions/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const session = await teleoperationService.getSession(id);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json({ session });
  } catch (error) {
    console.error('[TeleoperationRoutes] Error getting session:', error);
    res.status(500).json({ error: 'Failed to get session' });
  }
});

// ============================================================================
// PUT /api/teleoperation/sessions/:id - Update session metadata
// ============================================================================

teleoperationRoutes.put('/sessions/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const dto = req.body as UpdateSessionDto;

    const session = await teleoperationService.updateSession(id, dto);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json({
      session,
      message: 'Session updated successfully',
    });
  } catch (error) {
    console.error('[TeleoperationRoutes] Error updating session:', error);
    const message = error instanceof Error ? error.message : 'Failed to update session';
    res.status(400).json({ error: message });
  }
});

// ============================================================================
// DELETE /api/teleoperation/sessions/:id - Delete session
// ============================================================================

teleoperationRoutes.delete('/sessions/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const deleted = await teleoperationService.deleteSession(id);
    if (!deleted) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json({ message: 'Session deleted successfully' });
  } catch (error) {
    console.error('[TeleoperationRoutes] Error deleting session:', error);
    res.status(500).json({ error: 'Failed to delete session' });
  }
});

// ============================================================================
// POST /api/teleoperation/sessions/:id/start - Start recording
// ============================================================================

teleoperationRoutes.post('/sessions/:id/start', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const session = await teleoperationService.startSession(id);

    res.json({
      session,
      message: 'Recording started',
    });
  } catch (error) {
    console.error('[TeleoperationRoutes] Error starting session:', error);
    const message = error instanceof Error ? error.message : 'Failed to start session';
    res.status(400).json({ error: message });
  }
});

// ============================================================================
// POST /api/teleoperation/sessions/:id/pause - Pause recording
// ============================================================================

teleoperationRoutes.post('/sessions/:id/pause', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const session = await teleoperationService.pauseSession(id);

    res.json({
      session,
      message: 'Recording paused',
    });
  } catch (error) {
    console.error('[TeleoperationRoutes] Error pausing session:', error);
    const message = error instanceof Error ? error.message : 'Failed to pause session';
    res.status(400).json({ error: message });
  }
});

// ============================================================================
// POST /api/teleoperation/sessions/:id/resume - Resume recording
// ============================================================================

teleoperationRoutes.post('/sessions/:id/resume', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const session = await teleoperationService.resumeSession(id);

    res.json({
      session,
      message: 'Recording resumed',
    });
  } catch (error) {
    console.error('[TeleoperationRoutes] Error resuming session:', error);
    const message = error instanceof Error ? error.message : 'Failed to resume session';
    res.status(400).json({ error: message });
  }
});

// ============================================================================
// POST /api/teleoperation/sessions/:id/end - End recording
// ============================================================================

teleoperationRoutes.post('/sessions/:id/end', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const session = await teleoperationService.endSession(id);

    res.json({
      session,
      message: 'Recording ended',
    });
  } catch (error) {
    console.error('[TeleoperationRoutes] Error ending session:', error);
    const message = error instanceof Error ? error.message : 'Failed to end session';
    res.status(400).json({ error: message });
  }
});

// ============================================================================
// POST /api/teleoperation/sessions/:id/frame - Record single frame
// ============================================================================

teleoperationRoutes.post('/sessions/:id/frame', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const dto = req.body as RecordFrameDto;

    // Validate required fields
    if (dto.timestamp === undefined || dto.timestamp === null) {
      return res.status(400).json({ error: 'timestamp is required' });
    }
    if (!Array.isArray(dto.jointPositions) || dto.jointPositions.length === 0) {
      return res.status(400).json({ error: 'jointPositions is required' });
    }
    if (!Array.isArray(dto.action) || dto.action.length === 0) {
      return res.status(400).json({ error: 'action is required' });
    }

    const frame = await teleoperationService.recordFrame(id, dto);

    res.status(201).json({
      frame,
      message: 'Frame recorded',
    });
  } catch (error) {
    console.error('[TeleoperationRoutes] Error recording frame:', error);
    const message = error instanceof Error ? error.message : 'Failed to record frame';
    res.status(400).json({ error: message });
  }
});

// ============================================================================
// POST /api/teleoperation/sessions/:id/frames - Record batch of frames
// ============================================================================

teleoperationRoutes.post('/sessions/:id/frames', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const dto = req.body as BatchRecordFramesDto;

    if (!Array.isArray(dto.frames)) {
      return res.status(400).json({ error: 'frames array is required' });
    }

    const result = await teleoperationService.recordFramesBatch(id, dto);

    res.status(201).json({
      ...result,
      message: `Recorded ${result.recorded} frames`,
    });
  } catch (error) {
    console.error('[TeleoperationRoutes] Error recording frames batch:', error);
    const message = error instanceof Error ? error.message : 'Failed to record frames';
    res.status(400).json({ error: message });
  }
});

// ============================================================================
// GET /api/teleoperation/sessions/:id/frames - Get frames
// ============================================================================

teleoperationRoutes.get('/sessions/:id/frames', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const query = req.query as Record<string, string | undefined>;

    const startIndex = query.startIndex ? parseInt(query.startIndex, 10) : undefined;
    const limit = query.limit ? parseInt(query.limit, 10) : undefined;

    const frames = await teleoperationService.getFrames(id, startIndex, limit);

    res.json({
      sessionId: id,
      frameCount: frames.length,
      frames,
    });
  } catch (error) {
    console.error('[TeleoperationRoutes] Error getting frames:', error);
    res.status(500).json({ error: 'Failed to get frames' });
  }
});

// ============================================================================
// POST /api/teleoperation/sessions/:id/annotate - Add language instruction
// ============================================================================

teleoperationRoutes.post('/sessions/:id/annotate', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const dto = req.body as AnnotateSessionDto;

    if (!dto.languageInstr) {
      return res.status(400).json({ error: 'languageInstr is required' });
    }

    const session = await teleoperationService.annotateSession(id, dto);

    res.json({
      session,
      message: 'Session annotated successfully',
    });
  } catch (error) {
    console.error('[TeleoperationRoutes] Error annotating session:', error);
    const message = error instanceof Error ? error.message : 'Failed to annotate session';
    res.status(400).json({ error: message });
  }
});

// ============================================================================
// POST /api/teleoperation/sessions/:id/export - Export to LeRobot format
// ============================================================================

teleoperationRoutes.post('/sessions/:id/export', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const dto = req.body as ExportSessionDto | undefined;

    const result = await teleoperationService.exportToLeRobot(id, dto ?? {});

    res.json({
      ...result,
      message: 'Session exported to LeRobot format',
    });
  } catch (error) {
    console.error('[TeleoperationRoutes] Error exporting session:', error);
    const message = error instanceof Error ? error.message : 'Failed to export session';
    res.status(400).json({ error: message });
  }
});
