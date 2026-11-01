/**
 * @file camera.test.ts
 * @description The camera step against real TCP listeners: the head camera alone
 * (unchanged wording), head plus wrist cameras, and a wrist that is down — which
 * warns and never stops the start (TASK-446).
 * @feature supervisor
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:net';
import type { Server } from 'node:net';
import { cleanupHarness, freePort, makeHarness, startAndWait, step } from './helpers.js';
import type { Harness } from './helpers.js';

const realKill = process.kill.bind(process);
let h: Harness | undefined;
const servers: Server[] = [];

afterEach(async () => {
  cleanupHarness(h, realKill);
  h = undefined;
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

/** A listener that accepts and closes: all the camera step asks is that it answers. */
async function listener(): Promise<number> {
  const srv = createServer((sock) => sock.destroy());
  servers.push(srv);
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  return (srv.address() as { port: number }).port;
}

async function cameraStep(cams: { pc2Camera?: string; wristCameras?: Record<string, string> }) {
  h = await makeHarness({ profile: (doc) => Object.assign(doc, cams) });
  return step(await startAndWait(h), 'camera');
}

describe('camera step', () => {
  it('head camera only: the same output as before wrist cameras existed', async () => {
    const head = await listener();
    expect(await cameraStep({ pc2Camera: `127.0.0.1:${head}` })).toMatchObject({
      state: 'ok', code: null, checks: { tcp: true }, detail: `PC2 camera answers at 127.0.0.1:${head}`,
    });
    expect(Object.keys(step(h!.sup.status(), 'camera').checks)).toEqual(['tcp']);
  });

  it('head camera down, no wrists: the same warning as before', async () => {
    const dead = await freePort();
    expect(await cameraStep({ pc2Camera: `127.0.0.1:${dead}` })).toMatchObject({
      state: 'warn', code: 'camera_unreachable', checks: { tcp: false },
      detail: `PC2 camera at 127.0.0.1:${dead} does not answer — the head camera will be missing ` +
        '(g1-head-cam.service on PC2). The robot side starts without it.',
    });
  });

  it('head and both wrists up: ok, one check per wrist', async () => {
    const [head, left, right] = [await listener(), await listener(), await listener()];
    const s = await cameraStep({
      pc2Camera: `127.0.0.1:${head}`,
      wristCameras: { left: `127.0.0.1:${left}`, right: `127.0.0.1:${right}` },
    });
    expect(s).toMatchObject({ state: 'ok', code: null, checks: { tcp: true, leftWrist: true, rightWrist: true } });
    expect(s.detail).toBe(
      `PC2 camera answers at 127.0.0.1:${head}. Left wrist camera 127.0.0.1:${left} answers. ` +
      `Right wrist camera 127.0.0.1:${right} answers.`,
    );
  });

  it('one wrist down: a warning naming it, and the start goes on', async () => {
    const [head, left, dead] = [await listener(), await listener(), await freePort()];
    const s = await cameraStep({
      pc2Camera: `127.0.0.1:${head}`,
      wristCameras: { left: `127.0.0.1:${left}`, right: `127.0.0.1:${dead}` },
    });
    expect(s).toMatchObject({
      state: 'warn', code: 'wrist_camera_unreachable', checks: { tcp: true, leftWrist: true, rightWrist: false },
    });
    expect(s.detail).toContain(
      `Right wrist camera 127.0.0.1:${dead} not answering — takes in a Head + wrists session will not start.`,
    );
    const st = h!.sup.status();
    expect(st.overall).toBe('ready');
    expect(step(st, 'agent').state).toBe('ok');
  });

  it('no camera at all: idle, as before', async () => {
    expect(await cameraStep({})).toMatchObject({ state: 'idle', detail: 'no PC2 camera in this profile', checks: {} });
  });
});
