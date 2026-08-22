/**
 * @file camera-stream-route.test.ts
 * @description Contract for `GET /api/v1/robots/:id/camera/:name/stream` — the
 *              live MJPEG proxy that puts the robot's own view into the VR
 *              scene. Runs over real HTTP against a stand-in sidecar, because
 *              the things worth checking here are all transport behaviour:
 *              the personal-data gate, an honest error before the multipart
 *              header goes out, and hanging up on the sidecar when the viewer
 *              leaves.
 * @feature robots
 * @status test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import cors from 'cors';
import http, { type Server } from 'http';
import type { AddressInfo } from 'net';

/** Set before the routes are built; read through the mocked `getSidecarUrl`. */
let sidecarBase = '';

vi.mock('../../hardware/HardwareClient.js', () => ({
  hardwareClient: {
    getCachedPose: () => null,
    getOdometryFrame: () => null,
  },
  getSidecarUrl: () => sidecarBase,
}));
vi.mock('../../agent-mode/agent-mode-controller.js', () => ({
  agentModeController: new Proxy({}, { get: () => vi.fn() }),
}));
vi.mock('../../agent-mode/identity.js', () => ({
  getIdentityStore: () => ({ load: vi.fn() }),
}));
vi.mock('../../vla/skill-executor.js', () => ({
  SkillExecutor: class {
    run = vi.fn();
    abort(): void {}
    isAborted(): boolean {
      return false;
    }
  },
  skillExecutorRegistry: {
    register: (): void => {},
    unregister: (): void => {},
    abort: (): boolean => false,
    abortAll: (): number => 0,
  },
}));

import { createRestRoutes, MEMORY_TOKEN_ENV } from '../rest-routes.js';
import type { RobotStateManager } from '../../robot/state.js';

/** What the stand-in sidecar did, so the tests can assert on its side too. */
interface SidecarLog {
  paths: string[];
  /** Resolves once the sidecar notices the downstream reader has gone away. */
  closed: Promise<void>;
  frames: number;
}

describe('camera stream route', () => {
  let agent: Server;
  let sidecar: Server;
  let base: string;
  let log: SidecarLog;

  beforeEach(async () => {
    let markClosed = (): void => {};
    log = {
      paths: [],
      frames: 0,
      closed: new Promise<void>((resolve) => {
        markClosed = resolve;
      }),
    };

    // A sidecar that behaves like sim_node.py: unknown camera → 503 BEFORE the
    // 200, known camera → an endless multipart body.
    sidecar = http.createServer((req, res) => {
      log.paths.push(req.url ?? '');
      if (!req.url?.includes('/cameras/head_camera/')) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'no camera' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'multipart/x-mixed-replace; boundary=FRAME' });
      const timer = setInterval(() => {
        log.frames += 1;
        res.write('--FRAME\r\nContent-Type: image/jpeg\r\n\r\nJPEGBYTES\r\n');
      }, 10);
      res.on('close', () => {
        clearInterval(timer);
        markClosed();
      });
    });
    await new Promise<void>((resolve) => sidecar.listen(0, resolve));
    sidecarBase = `http://127.0.0.1:${(sidecar.address() as AddressInfo).port}`;

    const app = express();
    app.use(cors());
    app.use(express.json());
    app.use(
      '/api/v1',
      createRestRoutes({
        getRobotInterface: () => ({ id: 'robot-1', status: 'idle' }),
        updateServerHeartbeat: (): void => {},
      } as unknown as RobotStateManager),
    );
    await new Promise<void>((resolve) => {
      agent = app.listen(0, () => resolve());
    });
    base = `http://127.0.0.1:${(agent.address() as AddressInfo).port}/api/v1`;
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await new Promise<void>((resolve) => agent.close(() => resolve()));
    await new Promise<void>((resolve) => sidecar.close(() => resolve()));
  });

  const stream = (path: string, init?: RequestInit) => fetch(`${base}${path}`, init);

  it('streams the sidecar multipart body through, unchanged', async () => {
    const controller = new AbortController();
    const res = await stream('/robots/robot-1/camera/head_camera/stream', { signal: controller.signal });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('multipart/x-mixed-replace; boundary=FRAME');
    expect(log.paths[0]).toBe('/cameras/head_camera/stream');

    const reader = res.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain('--FRAME');
    controller.abort();
  });

  it('hangs up on the sidecar when the viewer goes away', async () => {
    const controller = new AbortController();
    const res = await stream('/robots/robot-1/camera/head_camera/stream', { signal: controller.signal });
    const reader = res.body!.getReader();
    await reader.read();

    // The point of the test: a viewer that leaves must stop the RENDERING, not
    // just its own download. Every frame the sidecar makes after this costs the
    // simulation a render on its physics thread, for nobody.
    controller.abort();
    await expect(log.closed).resolves.toBeUndefined();
    const atHangup = log.frames;
    await new Promise((r) => setTimeout(r, 60));
    expect(log.frames).toBe(atHangup);
  });

  it('turns a sidecar refusal into a status, not a broken stream', async () => {
    const res = await stream('/robots/robot-1/camera/nosuchcam/stream');
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: 'CAMERA_UNAVAILABLE' });
  });

  it('answers 502 when the sidecar is not there at all', async () => {
    await new Promise<void>((resolve) => sidecar.close(() => resolve()));
    const res = await stream('/robots/robot-1/camera/head_camera/stream');
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ code: 'CAMERA_UNAVAILABLE' });
  });

  it('rejects a camera name that would not stay inside the sidecar path', async () => {
    const res = await stream('/robots/robot-1/camera/..%2F..%2Fstate/stream');
    expect(res.status).toBe(400);
    expect(log.paths).toHaveLength(0);
  });

  it('is 404 for a robot this agent does not serve', async () => {
    expect((await stream('/robots/other/camera/head_camera/stream')).status).toBe(404);
  });

  it('sits behind the personal-data gate: a live room view is personal data', async () => {
    vi.stubEnv(MEMORY_TOKEN_ENV, 'shared-secret');

    const noToken = await stream('/robots/robot-1/camera/head_camera/stream');
    expect(noToken.status).toBe(401);

    const wrongToken = await stream('/robots/robot-1/camera/head_camera/stream', {
      headers: { Authorization: 'Bearer nope' },
    });
    expect(wrongToken.status).toBe(401);

    const controller = new AbortController();
    const ok = await stream('/robots/robot-1/camera/head_camera/stream', {
      headers: { Authorization: 'Bearer shared-secret' },
      signal: controller.signal,
    });
    expect(ok.status).toBe(200);
    controller.abort();
  });

  it('refuses a cross-origin browser, which is how a page on another site would ask', async () => {
    const res = await stream('/robots/robot-1/camera/head_camera/stream', {
      headers: { Origin: 'http://evil.example' },
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'CROSS_ORIGIN_FORBIDDEN' });
  });
});
