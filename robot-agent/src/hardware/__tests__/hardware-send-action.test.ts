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
import { G1_APPLE_STATE_JOINT_NAMES } from '../../vla/action-contracts.js';

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

describe('HardwareClient.sendJointTargets — the name-keyed path (TASK-229)', () => {
  it('posts the dict verbatim, consulting no joint order at all', async () => {
    // The point of the method. A 31-dim apple-pick action is not in the G1
    // EDU's 43-joint body order and never was: mapped by index, action[0]
    // (left shoulder pitch) landed on `left_hip_pitch_joint` and the arms
    // drove the legs of a standing humanoid. `action-contracts.ts` builds the
    // dict by name; this method must not touch it on the way out.
    const { client, fetchMock } = await connectedClient({
      ok: true,
      status: 200,
      body: { ok: true },
    });

    const targets = {
      left_shoulder_pitch_joint: 0.25,
      left_hand_middle_0_joint: -0.69452,
      waist_yaw_joint: -0.12,
    };
    await client.sendJointTargets(targets);

    const call = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/action'));
    expect(call).toBeDefined();
    expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual(targets);
  });

  it('propagates a refusal, like every other write on this client', async () => {
    const { client } = await connectedClient({
      ok: false,
      status: 403,
      body: { ok: false, error: 'G1_READ_ONLY' },
    });
    await expect(client.sendJointTargets({ waist_yaw_joint: 0 })).rejects.toThrow('G1_READ_ONLY');
  });
});

describe('HardwareClient.getStateNow — the observation order (TASK-229)', () => {
  /** A sidecar reporting a distinct value per joint, so a transposition shows. */
  async function clientReportingPose(pose: Record<string, number>): Promise<HardwareClient> {
    const fetchMock = vi.fn(async (url: string) => {
      const path = String(url);
      if (path.endsWith('/health')) {
        return { ok: true, status: 200, json: async () => ({ status: 'ok', connected: true }) };
      }
      if (path.endsWith('/state/fast')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            joints: Object.entries(pose).map(([name, position]) => ({ name, position })),
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({ connected: true, joints: [] }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new HardwareClient();
    await client.init();
    client.stopPolling();
    return client;
  }

  const originalRobotType = config.robotType;
  afterEach(() => {
    config.robotType = originalRobotType;
  });

  it('gives a G1 EDU the policy’s state contract, not its own joint order', async () => {
    // The observation was wrong in exactly four of 43 slots — 32..35, the left
    // hand's index/middle pair — because `dex3HandJoints()` builds both hands
    // index-first while the Dex3-1 SDK enumerates the LEFT hand middle-first.
    // Everything else agreed, so the policy saw a perfect body and a left hand
    // whose two fingers were labelled as each other, throughout every grasp.
    config.robotType = 'g1_edu';
    const names = G1_APPLE_STATE_JOINT_NAMES;
    const pose = Object.fromEntries(names.map((n, i) => [n, i]));
    const client = await clientReportingPose(pose);

    const state = await client.getStateNow();
    expect(state).toHaveLength(43);
    // Identity iff the order used is the contract order.
    expect(state).toEqual(names.map((_, i) => i));
    expect(state[32]).toBe(names.indexOf('left_hand_middle_0_joint'));
    expect(state[34]).toBe(names.indexOf('left_hand_index_0_joint'));
    // And the right hand, which never disagreed, is still index-first.
    expect(names[39]).toBe('right_hand_index_0_joint');
  });

  it('leaves every other embodiment reading in its own joint order', async () => {
    config.robotType = 'so101';
    const order = getJointConfig('so101').map((j) => j.name);
    const client = await clientReportingPose(Object.fromEntries(order.map((n, i) => [n, i * 2])));

    await expect(client.getStateNow()).resolves.toEqual(order.map((_, i) => i * 2));
  });
});
