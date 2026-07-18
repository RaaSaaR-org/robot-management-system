/**
 * @file voice.routes.ts
 * @description Proxy routes for the robot voice service (TASK-181 sidecar).
 *              The browser talks only to this server; these routes forward to
 *              the Python voice service (:8768, say/status/events) and the G1
 *              audio adapter (:8766, volume) running next to the robot agent.
 *              Nothing here is persisted — voice traffic is live-only.
 */

import { Router, type Request, type Response } from 'express';
import http from 'http';
import { robotManager } from '../services/RobotManager.js';
import { HttpClient, HttpClientError, HTTP_TIMEOUTS } from '../services/HttpClient.js';

export const voiceRoutes = Router();

const VOICE_SERVICE_PORT = 8768;
const VOICE_ADAPTER_PORT = 8766;

interface VoiceTargets {
  /** Voice service base URL (pipeline control: say, status, events) */
  serviceUrl: string;
  /** G1 audio adapter base URL (speaker volume) */
  adapterUrl: string;
}

/**
 * Resolve the voice service / adapter URLs for a robot. Both sidecars run on
 * the same host as the robot agent (like the camera sidecar on :8765), so we
 * derive the host from the registered agent URL. Env overrides for
 * non-standard deployments: VOICE_SERVICE_URL, VOICE_ADAPTER_URL.
 */
async function resolveVoiceTargets(robotId: string): Promise<VoiceTargets | null> {
  const registered = await robotManager.getRegisteredRobot(robotId);
  if (!registered) return null;
  const agentHost = new URL(registered.baseUrl).hostname;
  return {
    serviceUrl: process.env.VOICE_SERVICE_URL || `http://${agentHost}:${VOICE_SERVICE_PORT}`,
    adapterUrl: process.env.VOICE_ADAPTER_URL || `http://${agentHost}:${VOICE_ADAPTER_PORT}`,
  };
}

function respondProxyError(res: Response, error: unknown, action: string): void {
  if (error instanceof HttpClientError && error.statusCode) {
    // Upstream answered with an error (e.g. 400 missing text) — pass it through.
    return void res.status(error.statusCode).json({ error: error.message });
  }
  if (error instanceof HttpClientError) {
    return void res.status(502).json({ error: 'Voice service unreachable' });
  }
  console.error(`[Voice] ${action} error:`, error);
  res.status(500).json({ error: `Failed to ${action}` });
}

/**
 * GET /:id/voice/health — Aggregated availability of both voice sidecars.
 * Always answers 200; `available` is the frontend's degradation signal.
 */
voiceRoutes.get('/:id/voice/health', async (req: Request, res: Response) => {
  try {
    const targets = await resolveVoiceTargets(req.params.id);
    if (!targets) return res.status(404).json({ error: 'Robot not found' });

    const service = new HttpClient(targets.serviceUrl, HTTP_TIMEOUTS.SHORT);
    const adapter = new HttpClient(targets.adapterUrl, HTTP_TIMEOUTS.SHORT);
    const [serviceHealth, adapterHealth] = await Promise.all([
      service.get<Record<string, unknown>>('/health').catch(() => null),
      adapter.get<Record<string, unknown>>('/health').catch(() => null),
    ]);

    res.json({
      available: serviceHealth !== null,
      service: serviceHealth,
      adapter: adapterHealth,
    });
  } catch (error) {
    respondProxyError(res, error, 'get voice health');
  }
});

/**
 * GET /:id/voice/status — Pipeline state, session, last transcript/reply, latency.
 */
voiceRoutes.get('/:id/voice/status', async (req: Request, res: Response) => {
  try {
    const targets = await resolveVoiceTargets(req.params.id);
    if (!targets) return res.status(404).json({ error: 'Robot not found' });
    const client = new HttpClient(targets.serviceUrl, HTTP_TIMEOUTS.SHORT);
    res.json(await client.get('/status'));
  } catch (error) {
    respondProxyError(res, error, 'get voice status');
  }
});

/**
 * POST /:id/voice/say — Speak typed text through the robot speaker.
 * Body: {text: string, language?: 'de'|'en'}. Upstream answers 202 {accepted}.
 */
voiceRoutes.post('/:id/voice/say', async (req: Request, res: Response) => {
  try {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!text) {
      return res.status(400).json({ error: 'text is required' });
    }
    if (text.length > 500) {
      return res.status(400).json({ error: 'text must be at most 500 characters' });
    }
    const language = req.body?.language;
    if (language !== undefined && language !== 'de' && language !== 'en') {
      return res.status(400).json({ error: "language must be 'de' or 'en'" });
    }

    const targets = await resolveVoiceTargets(req.params.id);
    if (!targets) return res.status(404).json({ error: 'Robot not found' });
    // TTS synthesis is queued upstream (202), but leave headroom over SHORT.
    const client = new HttpClient(targets.serviceUrl, HTTP_TIMEOUTS.MEDIUM);
    res.status(202).json(await client.post('/say', { text, language }));
  } catch (error) {
    respondProxyError(res, error, 'send say');
  }
});

/**
 * POST /:id/voice/listen/toggle — Pause/resume the mic pipeline. Returns {paused}.
 */
voiceRoutes.post('/:id/voice/listen/toggle', async (req: Request, res: Response) => {
  try {
    const targets = await resolveVoiceTargets(req.params.id);
    if (!targets) return res.status(404).json({ error: 'Robot not found' });
    const client = new HttpClient(targets.serviceUrl, HTTP_TIMEOUTS.SHORT);
    res.json(await client.post('/listen/toggle'));
  } catch (error) {
    respondProxyError(res, error, 'toggle listening');
  }
});

/**
 * POST /:id/voice/session/reset — Fresh A2A conversation context. Returns {contextId}.
 */
voiceRoutes.post('/:id/voice/session/reset', async (req: Request, res: Response) => {
  try {
    const targets = await resolveVoiceTargets(req.params.id);
    if (!targets) return res.status(404).json({ error: 'Robot not found' });
    const client = new HttpClient(targets.serviceUrl, HTTP_TIMEOUTS.SHORT);
    res.json(await client.post('/session/reset'));
  } catch (error) {
    respondProxyError(res, error, 'reset voice session');
  }
});

/**
 * GET /:id/voice/volume — Robot speaker volume from the audio adapter. {volume: 0..100}
 */
voiceRoutes.get('/:id/voice/volume', async (req: Request, res: Response) => {
  try {
    const targets = await resolveVoiceTargets(req.params.id);
    if (!targets) return res.status(404).json({ error: 'Robot not found' });
    const client = new HttpClient(targets.adapterUrl, HTTP_TIMEOUTS.SHORT);
    res.json(await client.get('/volume'));
  } catch (error) {
    respondProxyError(res, error, 'get volume');
  }
});

/**
 * POST /:id/voice/volume — Set robot speaker volume. Body: {volume: 0..100}
 */
voiceRoutes.post('/:id/voice/volume', async (req: Request, res: Response) => {
  try {
    const volume = req.body?.volume;
    if (!Number.isInteger(volume) || volume < 0 || volume > 100) {
      return res.status(400).json({ error: 'volume must be an integer 0..100' });
    }
    const targets = await resolveVoiceTargets(req.params.id);
    if (!targets) return res.status(404).json({ error: 'Robot not found' });
    const client = new HttpClient(targets.adapterUrl, HTTP_TIMEOUTS.SHORT);
    res.json(await client.post('/volume', { volume }));
  } catch (error) {
    respondProxyError(res, error, 'set volume');
  }
});

/**
 * GET /:id/voice/events — SSE passthrough of the voice pipeline event stream
 * (state / transcript / reply / tts / error events). Same piping pattern as
 * the MJPEG camera proxy: raw http, upstream destroyed when the client leaves.
 */
voiceRoutes.get('/:id/voice/events', async (req: Request, res: Response) => {
  try {
    const targets = await resolveVoiceTargets(req.params.id);
    if (!targets) return res.status(404).json({ error: 'Robot not found' });

    const upstream = http.get(`${targets.serviceUrl}/events`, (stream) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.flushHeaders();
      stream.pipe(res);
      stream.on('end', () => res.end());
    });
    upstream.setTimeout(0);
    upstream.on('error', () => {
      if (!res.headersSent) {
        res.status(502).json({ error: 'Voice service unreachable' });
      } else {
        res.end();
      }
    });
    req.on('close', () => upstream.destroy());
  } catch (error) {
    if (!res.headersSent) {
      respondProxyError(res, error, 'stream voice events');
    }
  }
});
