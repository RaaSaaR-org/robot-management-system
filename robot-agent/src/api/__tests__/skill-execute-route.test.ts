/**
 * @file skill-execute-route.test.ts
 * @description Tests the TASK-179 rolloutStrategy plumbing through the REST
 * skill-execute route: body field → SkillExecutor.run(opts), validation of
 * unknown strategies, and rollout metadata in the response. The SkillExecutor
 * module is mocked; the route is driven over real HTTP on an ephemeral port.
 * @feature vla
 * @status test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';

const { runMock } = vi.hoisted(() => ({ runMock: vi.fn() }));

vi.mock('../../vla/skill-executor.js', () => ({
  SkillExecutor: class {
    run = runMock;
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

import { createRestRoutes } from '../rest-routes.js';
import type { RobotStateManager } from '../../robot/state.js';

function makeStateStub(): RobotStateManager {
  return {
    getRobotInterface: () => ({ id: 'robot-1', status: 'idle' }),
    getVLAModelVersion: () => null,
    // Every REST call feeds the SafetyMonitor's server-liveness heartbeat.
    updateServerHeartbeat: (): void => {},
  } as unknown as RobotStateManager;
}

describe('POST /robots/:id/skills/execute — rolloutStrategy plumbing', () => {
  let server: Server;
  let base: string;

  beforeEach(async () => {
    runMock.mockReset();
    runMock.mockResolvedValue({
      status: 'completed',
      mode: 'sim',
      steps: 3,
      durationMs: 42,
      rollout: { strategy: 'sentry', notes: ['sentry: sim mode — sidecar dataset recording skipped (no-op)'] },
    });
    const app = express();
    app.use(express.json());
    app.use(createRestRoutes(makeStateStub()));
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  async function executeSkill(body: Record<string, unknown>): Promise<Response> {
    return fetch(`${base}/robots/robot-1/skills/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('forwards rolloutStrategy and robotId into SkillExecutor.run(opts)', async () => {
    const res = await executeSkill({
      skillId: 'skill-1',
      taskPrompt: 'wave',
      rolloutStrategy: 'sentry',
    });

    expect(res.status).toBe(200);
    expect(runMock).toHaveBeenCalledTimes(1);
    expect(runMock).toHaveBeenCalledWith(
      expect.objectContaining({
        skillId: 'skill-1',
        rolloutStrategy: 'sentry',
        robotId: 'robot-1',
      }),
    );

    const json = (await res.json()) as { status: string; output: { rollout?: { strategy: string } } };
    expect(json.status).toBe('completed');
    expect(json.output.rollout?.strategy).toBe('sentry');
  });

  it("defaults to 'default' when rolloutStrategy is omitted", async () => {
    const res = await executeSkill({ skillId: 'skill-2', taskPrompt: 'wave' });

    expect(res.status).toBe(200);
    expect(runMock).toHaveBeenCalledWith(
      expect.objectContaining({ skillId: 'skill-2', rolloutStrategy: 'default' }),
    );
  });

  it('rejects an unknown rolloutStrategy with 400 without running the skill', async () => {
    const res = await executeSkill({
      skillId: 'skill-3',
      taskPrompt: 'wave',
      rolloutStrategy: 'yolo',
    });

    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toMatch(/Invalid rolloutStrategy 'yolo'/);
    expect(runMock).not.toHaveBeenCalled();
  });
});
