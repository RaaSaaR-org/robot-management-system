/**
 * @file RobotMemoryErasureService.test.ts
 * @description GDPR Art. 17 erasure has to reach the FLEET, not stop at the
 *              database: robot memory workspaces hold operator-authored text
 *              that no `userId`-keyed delete can touch (TASK-197).
 * @feature gdpr
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock prisma (the only external boundary) before importing the service.
vi.mock('../../database/index.js', () => ({
  prisma: {
    robot: { findMany: vi.fn() },
  },
}));

import {
  RobotMemoryErasureService,
  ROBOT_MEMORY_TOKEN_ENV,
  type RobotMemoryTarget,
} from '../RobotMemoryErasureService.js';

const TARGETS: RobotMemoryTarget[] = [
  { robotId: 'g1-edu-4', agentUrl: 'http://localhost:41244' },
  { robotId: 'g1-edu-4-sim', agentUrl: 'http://localhost:41245/' },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let logs: string[];

beforeEach(() => {
  logs = [];
  vi.spyOn(console, 'log').mockImplementation((msg: unknown) => {
    logs.push(String(msg));
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('RobotMemoryErasureService', () => {
  it('DELETEs the memory endpoint of every robot with an agent URL', async () => {
    const calls: Array<{ url: string; method?: string }> = [];
    const service = new RobotMemoryErasureService({
      listTargets: async () => TARGETS,
      fetchImpl: (async (input: unknown, init?: RequestInit) => {
        calls.push({ url: String(input), method: init?.method });
        return jsonResponse({ ok: true, removed: 2, errors: [] });
      }) as unknown as typeof fetch,
    });

    const result = await service.eraseFleetMemory();

    expect(calls.map((c) => c.method)).toEqual(['DELETE', 'DELETE']);
    expect(calls.map((c) => c.url)).toEqual([
      'http://localhost:41244/api/v1/robots/g1-edu-4/memory',
      // The trailing slash on the stored URL must not produce a double slash.
      'http://localhost:41245/api/v1/robots/g1-edu-4-sim/memory',
    ]);
    expect(result).toMatchObject({ attempted: 2, succeeded: 2, failed: 0, removed: 4 });
  });

  it('records a robot that only REDACTED, instead of reading it as "nothing was there"', async () => {
    // The workspace where the only personal data was the `Operator` and `Site`
    // labels on `IDENTITY.md`: those are blanked in place, so the agent removes
    // no file at all. With only `removed` carried through, this robot's answer
    // was indistinguishable from an empty workspace — and the redaction, the one
    // part of the wipe that is not a deletion, never reached the GDPR request.
    const service = new RobotMemoryErasureService({
      listTargets: async () => [TARGETS[0]],
      fetchImpl: (async () =>
        jsonResponse({ ok: true, removed: 0, redacted: 1, errors: [] })) as unknown as typeof fetch,
    });

    const result = await service.eraseFleetMemory();

    expect(result).toMatchObject({ attempted: 1, succeeded: 1, failed: 0, removed: 0, redacted: 1 });
    expect(result.outcomes[0]).toMatchObject({ robotId: 'g1-edu-4', ok: true, redacted: 1 });
  });

  it('reads an older agent that does not report redactions as zero, not as a failure', async () => {
    const service = new RobotMemoryErasureService({
      listTargets: async () => [TARGETS[0]],
      fetchImpl: (async () =>
        jsonResponse({ ok: true, removed: 3, errors: [] })) as unknown as typeof fetch,
    });

    const result = await service.eraseFleetMemory();

    expect(result).toMatchObject({ succeeded: 1, removed: 3, redacted: 0 });
  });

  it('presents the agent token, so an off-box robot does not refuse the erasure', async () => {
    // `personalDataGate` in robot-agent/src/api/rest-routes.ts answers
    // `DELETE /memory` for loopback callers only unless the caller presents
    // AGENT_MEMORY_TOKEN. Without this header, a fleet whose agents run on
    // other hosts would report HTTP 401 for every robot.
    const inits: RequestInit[] = [];
    const service = new RobotMemoryErasureService({
      listTargets: async () => [TARGETS[0]],
      agentToken: 'shared-secret',
      fetchImpl: (async (_input: unknown, init?: RequestInit) => {
        inits.push(init ?? {});
        return jsonResponse({ ok: true, removed: 1, errors: [] });
      }) as unknown as typeof fetch,
    });

    await service.eraseFleetMemory();

    expect((inits[0].headers as Record<string, string>).Authorization).toBe('Bearer shared-secret');
  });

  it('takes the agent token from the environment, and sends none when unset', async () => {
    const inits: RequestInit[] = [];
    const fetchImpl = (async (_input: unknown, init?: RequestInit) => {
      inits.push(init ?? {});
      return jsonResponse({ ok: true, removed: 0, errors: [] });
    }) as unknown as typeof fetch;

    vi.stubEnv(ROBOT_MEMORY_TOKEN_ENV, 'from-env');
    await new RobotMemoryErasureService({
      listTargets: async () => [TARGETS[0]],
      fetchImpl,
    }).eraseFleetMemory();
    expect((inits[0].headers as Record<string, string>).Authorization).toBe('Bearer from-env');

    // Unset ⇒ no header at all, which is the single-box dev setup where the
    // agent answers loopback callers without a secret.
    vi.stubEnv(ROBOT_MEMORY_TOKEN_ENV, '');
    await new RobotMemoryErasureService({
      listTargets: async () => [TARGETS[0]],
      fetchImpl,
    }).eraseFleetMemory();
    expect(inits[1].headers).toBeUndefined();
    vi.unstubAllEnvs();
  });

  it('reports an unreachable robot as a failure instead of claiming success', async () => {
    const service = new RobotMemoryErasureService({
      listTargets: async () => [TARGETS[0]],
      fetchImpl: (async () => {
        throw new Error('ECONNREFUSED');
      }) as unknown as typeof fetch,
    });

    const result = await service.eraseFleetMemory();

    expect(result).toMatchObject({ attempted: 1, succeeded: 0, failed: 1, removed: 0 });
    expect(result.outcomes[0]).toMatchObject({
      robotId: 'g1-edu-4',
      ok: false,
      error: 'ECONNREFUSED',
    });
  });

  it('fails loud on a 404 from the wrong-robot guard instead of claiming success', async () => {
    // The agent answers 404 when `:id` is not ITS robot id — a renamed
    // ROBOT_ID, a recycled port, a stale fleet row. The workspace is still on
    // disk and untouched, so reporting the subject's data as erased here is
    // the one answer a data-subject request must never get.
    const service = new RobotMemoryErasureService({
      listTargets: async () => [TARGETS[0]],
      fetchImpl: (async () =>
        jsonResponse(
          { code: 'ROBOT_NOT_FOUND', message: 'This agent serves robot g1-edu-4-sim' },
          404,
        )) as unknown as typeof fetch,
    });

    const result = await service.eraseFleetMemory();

    expect(result).toMatchObject({ attempted: 1, succeeded: 0, failed: 1, removed: 0 });
    expect(result.outcomes[0].ok).toBe(false);
    expect(result.outcomes[0].error).toContain('ROBOT_NOT_FOUND');
    expect(result.outcomes[0].error).toContain('g1-edu-4');
  });

  it('fails on a 404 with no usable body (agent too old to have the route)', async () => {
    const service = new RobotMemoryErasureService({
      listTargets: async () => [TARGETS[0]],
      fetchImpl: (async () =>
        new Response('<html>Cannot DELETE</html>', { status: 404 })) as unknown as typeof fetch,
    });

    const result = await service.eraseFleetMemory();

    expect(result).toMatchObject({ succeeded: 0, failed: 1, removed: 0 });
    expect(result.outcomes[0].error).toContain('404');
  });

  it('fails when the agent erased only part of its workspace', async () => {
    const service = new RobotMemoryErasureService({
      listTargets: async () => [TARGETS[0]],
      fetchImpl: (async () =>
        jsonResponse({ ok: false, removed: 1, errors: ['EPERM: places/AISLE-3.md'] })) as unknown as typeof fetch,
    });

    const result = await service.eraseFleetMemory();

    expect(result.failed).toBe(1);
    expect(result.outcomes[0].error).toContain('AISLE-3');
  });

  it('reports a FAILURE to enumerate the fleet — not a clean, empty fleet', async () => {
    // The probe: `prisma.robot.findMany` rejects. The old result was
    // `{attempted:0, succeeded:0, failed:0, removed:0, outcomes:[]}` — byte-
    // identical to the honest "no robot in this fleet has an agent URL", so an
    // Art. 17 response claimed a complete erasure while the code never found
    // out which robots exist.
    const fetchCalls: string[] = [];
    const service = new RobotMemoryErasureService({
      listTargets: async () => {
        throw new Error('db down');
      },
      fetchImpl: (async (input: unknown) => {
        fetchCalls.push(String(input));
        return jsonResponse({});
      }) as unknown as typeof fetch,
    });

    const result = await service.eraseFleetMemory();

    expect(fetchCalls).toEqual([]); // nothing was erased
    expect(result.listError).toBe('db down');
    expect(result.failed).toBeGreaterThan(0);
    expect(result).toMatchObject({ attempted: 0, succeeded: 0, removed: 0, outcomes: [] });
  });

  it('an actually empty fleet stays distinguishable from a failed enumeration', async () => {
    const service = new RobotMemoryErasureService({
      listTargets: async () => [],
      fetchImpl: (async () => jsonResponse({})) as unknown as typeof fetch,
    });

    const result = await service.eraseFleetMemory();

    expect(result).toMatchObject({
      attempted: 0,
      succeeded: 0,
      failed: 0,
      removed: 0,
      outcomes: [],
    });
    expect(result.listError).toBeUndefined();
  });
});
