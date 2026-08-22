/**
 * @file hardware-send-action.test.ts
 * @description `POST /action` used to be a bare `await fetch(...)` — no
 *              `res.ok` check, no body read. `fetch` rejects only on a network
 *              failure, so the two answers that matter were both invisible:
 *              g1_sidecar.py's 403 `G1_READ_ONLY` (and read-only is the
 *              DEFAULT), and sim_node.py's 400 for an unknown joint, which
 *              rejects the whole pose. A VR operator got an on-screen robot
 *              that moved and a physical one that never received a command,
 *              with nothing anywhere saying why.
 * @feature hardware
 * @status test
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { HardwareClient, HardwareActionError } from '../HardwareClient.js';
import { getJointConfig } from '../../robot/joint-configs/index.js';
import { config } from '../../config/config.js';

/**
 * A client that believes a sidecar is there. `sendAction` returns early when it
 * is not, and `sidecarAvailable` is only set by a successful `/health` poll —
 * so the boot is stubbed rather than reached around.
 */
async function connectedClient(actionResponse: {
  ok: boolean;
  status: number;
  body: unknown;
}): Promise<{ client: HardwareClient; fetchMock: ReturnType<typeof vi.fn> }> {
  const fetchMock = vi.fn(async (url: string) => {
    const path = String(url);
    if (path.endsWith('/health')) {
      return { ok: true, json: async () => ({ status: 'ok', connected: true }) };
    }
    if (path.endsWith('/action')) {
      return {
        ok: actionResponse.ok,
        status: actionResponse.status,
        json: async () => actionResponse.body,
      };
    }
    return { ok: true, status: 200, json: async () => ({ connected: true, joints: [] }) };
  });
  vi.stubGlobal('fetch', fetchMock);
  const client = new HardwareClient();
  await client.init();
  client.stopPolling();
  return { client, fetchMock: fetchMock as unknown as ReturnType<typeof vi.fn> };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('HardwareClient.sendAction — a refusal is an exception, not a silence', () => {
  it('throws the sidecar’s own words on a 403 read-only refusal', async () => {
    const { client } = await connectedClient({
      ok: false,
      status: 403,
      body: { ok: false, error: 'G1_READ_ONLY — command path disabled (stage 1: telemetry only)' },
    });

    await expect(client.sendAction({ left_elbow_joint: 0.4 })).rejects.toThrow(
      'G1_READ_ONLY — command path disabled (stage 1: telemetry only)',
    );
  });

  it('carries the HTTP status, so a refusal can be told from a dead sidecar', async () => {
    const { client } = await connectedClient({
      ok: false,
      status: 403,
      body: { ok: false, error: 'G1_READ_ONLY' },
    });

    const err = await client.sendAction({ a: 1 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HardwareActionError);
    expect((err as HardwareActionError).status).toBe(403);
  });

  it('throws on the sim’s 400 for an unknown joint — it rejects the WHOLE pose', async () => {
    const { client } = await connectedClient({
      ok: false,
      status: 400,
      body: { ok: false, error: "unknown joint 'elbow' -- not a G1 body or Dex3 joint" },
    });

    await expect(client.sendAction({ elbow: 0.4 })).rejects.toThrow("unknown joint 'elbow'");
  });

  it('throws on a 200 that carries ok:false — g1_sidecar returns the refusal as a body field', async () => {
    const { client } = await connectedClient({
      ok: true,
      status: 200,
      body: { ok: false, error: 'G1_READ_ONLY — command path disabled' },
    });

    await expect(client.sendAction({ a: 1 })).rejects.toThrow('G1_READ_ONLY');
  });

  it('falls back to the status when the sidecar sends no error text', async () => {
    const { client } = await connectedClient({ ok: false, status: 500, body: {} });

    await expect(client.sendAction({ a: 1 })).rejects.toThrow('HTTP 500');
  });

  it('survives a body that is not JSON at all', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).endsWith('/health')) {
          return { ok: true, json: async () => ({ status: 'ok', connected: true }) };
        }
        return { ok: false, status: 502, json: async () => { throw new Error('not json'); } };
      }),
    );
    const client = new HardwareClient();
    await client.init();
    client.stopPolling();

    await expect(client.sendAction({ a: 1 })).rejects.toThrow('HTTP 502');
  });

  it('returns the parsed body when the pose is accepted', async () => {
    const { client } = await connectedClient({
      ok: true,
      status: 200,
      body: { ok: true, applied: 43 },
    });

    await expect(client.sendAction({ a: 1 })).resolves.toEqual({ ok: true, applied: 43 });
  });

  it('returns null — never a throw — when there is no sidecar to send to', async () => {
    // A pure in-process sim: nothing was sent, which is not the same as
    // "sent and accepted", hence null rather than a body.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('connection refused'); }));
    const client = new HardwareClient();
    await client.init();
    client.stopPolling();

    await expect(client.sendAction({ a: 1 })).resolves.toBeNull();
  });
});

describe('HardwareClient.sendActionVector — inherits the throw', () => {
  it('propagates a refusal so a closed loop ends instead of running blind', async () => {
    const { client } = await connectedClient({
      ok: false,
      status: 403,
      body: { ok: false, error: 'G1_READ_ONLY' },
    });

    // A vector in the active embodiment's own joint order, so nothing is
    // dropped before it reaches sendAction. The one caller, SkillExecutor,
    // already catches this and ends the rollout — which is correct: a closed
    // loop whose actions are being rejected is not running.
    const order = getJointConfig(config.robotType).map((j) => j.name);
    expect(order.length).toBeGreaterThan(0);
    await expect(client.sendActionVector(order.map(() => 0))).rejects.toThrow('G1_READ_ONLY');
  });
});
