/**
 * @file teleoperation.routes.ts
 * @description REST API endpoints for teleoperation data collection
 * @feature datacollection
 */

import { Router, Request, Response } from 'express';
import { teleoperationService, EpisodeActionError } from '../services/TeleoperationService.js';
import type { AuthenticatedRequest } from '../middleware/auth.middleware.js';
import type {
  EpisodeActionContext,
  EpisodeSource,
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
import { sendFailure } from '../utils/routeErrors.js';
import { parseIntegerParam } from '../utils/pagination.js';

export const teleoperationRoutes = Router();

// ============================================================================
// EPISODE CONTROL HELPERS (TASK-408)
// ============================================================================

const EPISODE_SOURCES: readonly EpisodeSource[] = ['vr', 'desktop', 'hotkey'];

/**
 * The body every episode action takes — `{expectedTake?, clientId?, source?}` —
 * plus who is asking. A wrong-typed field is a 400, never silently dropped: a
 * client that sends `expectedTake: "3"` would otherwise lose its guard without
 * being told.
 */
function episodeContext(
  req: Request
): { ok: true; ctx: EpisodeActionContext } | { ok: false; error: string } {
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'body must be an object' };
  }
  const { expectedTake, clientId, source } = body;
  if (
    expectedTake !== undefined &&
    expectedTake !== null &&
    !(typeof expectedTake === 'number' && Number.isInteger(expectedTake) && expectedTake >= 0)
  ) {
    return { ok: false, error: 'expectedTake must be a non-negative integer or null' };
  }
  if (clientId !== undefined && !(typeof clientId === 'string' && clientId.length > 0 && clientId.length <= 128)) {
    return { ok: false, error: 'clientId must be a string of 1-128 characters' };
  }
  if (source !== undefined && !(typeof source === 'string' && (EPISODE_SOURCES as readonly string[]).includes(source))) {
    return { ok: false, error: `source must be one of: ${EPISODE_SOURCES.join(', ')}` };
  }
  const user = (req as AuthenticatedRequest).user;
  return {
    ok: true,
    ctx: {
      ...(expectedTake !== undefined ? { expectedTake: expectedTake as number | null } : {}),
      ...(typeof clientId === 'string' ? { clientId } : {}),
      source: (source as EpisodeSource | undefined) ?? 'desktop',
      user: { userId: user?.id ?? null, displayName: user?.name || user?.email || null },
    },
  };
}

/** A refused episode action answers with its code and the live state to re-sync from. */
async function sendEpisodeFailure(
  res: Response,
  sessionId: string,
  error: unknown,
  fallback: string
): Promise<void> {
  if (error instanceof EpisodeActionError) {
    const live = error.live ?? (await teleoperationService.getLiveState(sessionId).catch(() => null));
    res.status(error.status).json({ code: error.code, error: error.message, live });
    return;
  }
  // "not found" is this repo's own sentence, so that one is echoed;
  // every other failure answers with the fallback, unread.
  if (error instanceof Error && error.message.includes('not found')) {
    res.status(404).json({ error: error.message });
    return;
  }
  sendFailure(res, error, fallback, 400);
}

/** A camera name as the sidecar serves it and as it ends up in a file path. */
const CAMERA_NAME = /^[A-Za-z0-9_-]+$/;
const MAX_SESSION_CAMERAS = 4;

/**
 * The create body's optional camera list (TASK-441): absent, or 1-4 unique
 * names. An empty list is refused rather than stored — to the recorder `[]`
 * means "joints only", which is never what a session form means.
 */
function cameraListError(cameras: unknown): string | null {
  if (cameras === undefined) return null;
  if (
    !Array.isArray(cameras) ||
    cameras.length < 1 ||
    cameras.length > MAX_SESSION_CAMERAS ||
    !cameras.every((c) => typeof c === 'string' && CAMERA_NAME.test(c))
  ) {
    return `cameras must be a list of 1-${MAX_SESSION_CAMERAS} camera names (letters, digits, _ and -)`;
  }
  if (new Set(cameras).size !== cameras.length) {
    return 'cameras must not name a camera twice';
  }
  return null;
}

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
    const camerasError = cameraListError(dto.cameras);
    if (camerasError) {
      return res.status(400).json({ error: camerasError });
    }

    const session = await teleoperationService.createSession(dto);

    res.status(201).json({
      session,
      message: 'Teleoperation session created successfully',
    });
  } catch (error) {
    console.error('[TeleoperationRoutes] Error creating session:', error);
    sendFailure(res, error, 'Failed to create session', 400);
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
      page: parseIntegerParam(query.page, 'page', { min: 1 }),
      limit: parseIntegerParam(query.limit, 'limit', { min: 1 }),
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
    sendFailure(res, error, 'Failed to list sessions');
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
    sendFailure(res, error, 'Failed to update session', 400);
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
    sendFailure(res, error, 'Failed to start session', 400);
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
    sendFailure(res, error, 'Failed to pause session', 400);
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
    sendFailure(res, error, 'Failed to resume session', 400);
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
    sendFailure(res, error, 'Failed to end session', 400);
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
    sendFailure(res, error, 'Failed to record frame', 400);
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
    sendFailure(res, error, 'Failed to record frames', 400);
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
    const limit = parseIntegerParam(query.limit, 'limit', { min: 1 });

    const frames = await teleoperationService.getFrames(id, startIndex, limit);

    res.json({
      sessionId: id,
      frameCount: frames.length,
      frames,
    });
  } catch (error) {
    console.error('[TeleoperationRoutes] Error getting frames:', error);
    sendFailure(res, error, 'Failed to get frames');
  }
});

// ============================================================================
// GET /api/teleoperation/sessions/:id/live - The session's one live state (TASK-408)
// ============================================================================

teleoperationRoutes.get('/sessions/:id/live', async (req: Request, res: Response) => {
  try {
    res.json(await teleoperationService.getLiveState(req.params.id));
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      return res.status(404).json({ error: error.message });
    }
    sendFailure(res, error, 'Failed to read the live state');
  }
});

// ============================================================================
// POST /api/teleoperation/sessions/:id/episodes/start | stop | next | discard-last
//   body {expectedTake?: number|null, clientId?, source?: 'vr'|'desktop'|'hotkey'}
//   409 {code, error, live} when the session's state or the client's view refuses it
// ============================================================================

teleoperationRoutes.post('/sessions/:id/episodes/start', async (req: Request, res: Response) => {
  const parsed = episodeContext(req);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  try {
    const { live } = await teleoperationService.startEpisode(req.params.id, parsed.ctx);
    res.json({ live });
  } catch (error) {
    console.error('[TeleoperationRoutes] Error starting take:', error);
    await sendEpisodeFailure(res, req.params.id, error, 'Failed to start the take');
  }
});

teleoperationRoutes.post('/sessions/:id/episodes/stop', async (req: Request, res: Response) => {
  const parsed = episodeContext(req);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  try {
    const { live, quickCheck } = await teleoperationService.stopEpisode(req.params.id, parsed.ctx);
    res.json({ live, quickCheck });
  } catch (error) {
    console.error('[TeleoperationRoutes] Error stopping take:', error);
    await sendEpisodeFailure(res, req.params.id, error, 'Failed to stop the take');
  }
});

teleoperationRoutes.post('/sessions/:id/episodes/next', async (req: Request, res: Response) => {
  const parsed = episodeContext(req);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  try {
    const result = await teleoperationService.nextEpisode(req.params.id, parsed.ctx);
    res.json({
      ...result,
      message: `Recording episode ${result.episodeIndex}`,
    });
  } catch (error) {
    console.error('[TeleoperationRoutes] Error advancing episode:', error);
    await sendEpisodeFailure(res, req.params.id, error, 'Failed to advance episode');
  }
});

teleoperationRoutes.post('/sessions/:id/episodes/discard-last', async (req: Request, res: Response) => {
  const parsed = episodeContext(req);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  try {
    const { live, take } = await teleoperationService.discardLast(req.params.id, parsed.ctx);
    res.json({ live, take });
  } catch (error) {
    console.error('[TeleoperationRoutes] Error discarding the last take:', error);
    await sendEpisodeFailure(res, req.params.id, error, 'Failed to discard the last take');
  }
});

// ============================================================================
// GET /api/teleoperation/sessions/:id/episodes/:take/thumbnail - image/jpeg (TASK-408)
// ============================================================================

teleoperationRoutes.get('/sessions/:id/episodes/:take/thumbnail', async (req: Request, res: Response) => {
  const raw = req.params.take ?? '';
  if (!/^\d+$/.test(raw)) {
    return res.status(400).json({ error: 'take must be a non-negative integer' });
  }
  try {
    const jpeg = await teleoperationService.episodeThumbnail(req.params.id, Number.parseInt(raw, 10));
    if (!jpeg) {
      return res.status(404).json({ code: 'no_thumbnail', error: `take ${raw} has no thumbnail` });
    }
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.type('image/jpeg').send(jpeg);
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      return res.status(404).json({ error: error.message });
    }
    sendFailure(res, error, 'Failed to read the thumbnail');
  }
});

// ============================================================================
// GET /api/teleoperation/sessions/:id/episodes - List episode summaries
// ============================================================================

teleoperationRoutes.get('/sessions/:id/episodes', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const flag = String(req.query.includeDiscarded ?? '');
    const episodes = await teleoperationService.listEpisodes(id, {
      includeDiscarded: flag === '1' || flag === 'true',
    });

    res.json({ sessionId: id, episodes });
  } catch (error) {
    console.error('[TeleoperationRoutes] Error listing episodes:', error);
    // "not found" is this repo's own sentence, so that one is echoed;
    // every other failure answers with the fallback, unread.
    if (error instanceof Error && error.message.includes('not found')) {
      return res.status(404).json({ error: error.message });
    }
    sendFailure(res, error, 'Failed to list episodes', 500);
  }
});

// ============================================================================
// DELETE /api/teleoperation/sessions/:id/episodes/:episodeIndex - Discard episode
// ============================================================================

teleoperationRoutes.delete(
  '/sessions/:id/episodes/:episodeIndex',
  async (req: Request, res: Response) => {
    try {
      const { id, episodeIndex } = req.params;
      // Strict: parseInt reads "2.7" as 2 and would discard a DIFFERENT take.
      const parsedIndex = /^\d+$/.test(episodeIndex ?? '') ? Number.parseInt(episodeIndex, 10) : Number.NaN;

      if (Number.isNaN(parsedIndex) || parsedIndex < 0) {
        return res.status(400).json({ error: 'Invalid episode index' });
      }

      const parsed = episodeContext(req);
      if (!parsed.ok) return res.status(400).json({ error: parsed.error });
      const result = await teleoperationService.discardEpisode(id, parsedIndex, parsed.ctx);

      res.json({
        ...result,
        message: result.restarted
          ? `Restarted take ${parsedIndex} (${result.deletedFrames} frames dropped)`
          : `Discarded episode ${parsedIndex} (${result.deletedFrames} frames)`,
      });
    } catch (error) {
      console.error('[TeleoperationRoutes] Error discarding episode:', error);
      // 404 unknown_take / 502 recorder_unavailable carry the live state;
      // "not found" is echoed; every other failure answers with the fallback.
      await sendEpisodeFailure(res, req.params.id, error, 'Failed to discard episode');
    }
  }
);

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
    sendFailure(res, error, 'Failed to annotate session', 400);
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
    sendFailure(res, error, 'Failed to export session', 400);
  }
});
