/**
 * @file readiness-route.test.ts
 * @description TASK-405 over real HTTP: `GET /robots/:id/readiness` assembles
 *              sidecar, mode, arm path, hands, lease, cameras and telemetry
 *              honesty into one snapshot with the single ordered reason; it is
 *              read-only and refuses another robot's id.
 * @feature readiness
 * @status test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { createReadinessRoutes, type ReadinessDeps } from '../readiness-routes.js';
import { UNKNOWN_ARM_STATUS, parseArmStatus, type SidecarArmStatus } from '../../hardware/arm-status.js';
import { UNKNOWN_LOCO_CAPABILITY, type LocoCapability } from '../../hardware/base-mode.js';
import type { BaseModeReading, LastKnownSensors, SidecarHealth } from '../../hardware/HardwareClient.js';
import type { LeaseObservation } from '../../control-lease/control-lease.js';
import type { TeleopArmView } from '../../teleop/arm-registry.js';
import type { CameraListResult } from '../../hardware/camera-list.js';

const NO_LEASE: LeaseObservation = {
  enforced: false, state: 'none', generation: null, userId: null, displayName: null,
  sessionId: null, expiresInMs: null, bound: 0,
};

/** Everything the route reads, as plain mutable state. */
function world() {
  return {
    reachable: true,
    connected: true,
    arm: { ...UNKNOWN_ARM_STATUS, sim: true } as SidecarArmStatus,
    health: null as SidecarHealth | null,
    healthAt: null as number | null,
    loco: { ...UNKNOWN_LOCO_CAPABILITY } as LocoCapability,
    base: null as BaseModeReading | null,
    lastKnown: { stale: false, atMs: null, imu: null, battery: null, odometry: null, base: null } as LastKnownSensors,
    view: {
      writeMode: null, armed: false, arming: false, armWeight: 0, estopLatched: false, hands: null,
      teleopMode: null, claims: 0, lastError: null,
    } as TeleopArmView,
    lease: { ...NO_LEASE } as LeaseObservation,
    estop: false,
    simulatedGroups: ['joints', 'position', 'imu', 'battery'] as string[],
    cameras: { kind: 'ok', cameras: ['head_camera'], source: 'mujoco' } as CameraListResult,
    cameraCalls: 0,
    refreshCalls: 0,
  };
}

let w: ReturnType<typeof world>;
let server: Server;
let base: string;

function deps(): ReadinessDeps {
  return {
    robot: {
      getRobotInterface: () => ({ id: 'robot-1' }),
      isEStopTriggered: () => w.estop,
      getTelemetry: () => ({ simulated: w.simulatedGroups }),
    } as unknown as ReadinessDeps['robot'],
    hardware: {
      isSidecarReachable: () => w.reachable,
      isConnected: () => w.connected,
      getArmStatus: () => w.arm,
      refreshArmStatus: vi.fn(async () => {
        w.refreshCalls += 1;
        return w.arm;
      }),
      lastHealth: () => w.health,
      get lastHealthAt() {
        return w.healthAt;
      },
      getLocoCapability: () => w.loco,
      getBaseState: () => w.base,
      getLastKnownSensors: () => w.lastKnown,
      getSidecarBootId: () => 'boot-1',
    },
    arms: { view: () => w.view },
    leases: { observe: () => w.lease },
    cameras: async () => {
      w.cameraCalls += 1;
      return w.cameras;
    },
    sidecarUrl: () => 'http://localhost:8777',
    now: () => Date.now(),
  };
}

async function get(id = 'robot-1'): Promise<{ status: number; body: Record<string, any> }> {
  const res = await fetch(`${base}/api/v1/robots/${id}/readiness`);
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

beforeEach(async () => {
  w = world();
  const app = express();
  app.use(express.json());
  app.use('/api/v1', createReadinessRoutes(deps()));
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('GET /robots/:id/readiness (TASK-405)', () => {
  it('a sim sidecar nobody drives: Ready (simulation)', async () => {
    w.health = {
      ok: true, connected: true, bootId: 'boot-1', sim: true, scene: 'room', lowstateAgeS: 0,
      arm: w.arm, loco: w.loco,
    };
    w.healthAt = Date.parse('2026-10-17T10:00:00Z');
    const { status, body } = await get();
    expect(status).toBe(200);
    expect(body).toMatchObject({
      robotId: 'robot-1',
      simulated: true,
      sidecar: {
        reachable: true, connected: true, url: 'http://localhost:8777', lowstateAgeS: 0,
        writeMode: null, readOnly: false, bootId: 'boot-1', sim: true, stale: false,
        lastHealthAt: '2026-10-17T10:00:00.000Z',
      },
      base: null,
      hands: null,
      lease: { enforced: false, state: 'none', holder: null, bound: 0 },
      camera: { source: 'mujoco', cameras: ['head_camera'], detail: null },
      telemetrySynthetic: true,
      reason: { code: 'not_engaged', severity: 'ok' },
    });
    expect(body.reason.text).toMatch(/^Ready \(simulation\)/);
    expect(typeof body.at).toBe('string');
    expect(w.refreshCalls).toBe(1);
  });

  it('refuses another robot', async () => {
    const { status, body } = await get('robot-2');
    expect(status).toBe(404);
    expect(body.code).toBe('ROBOT_NOT_FOUND');
  });

  it('a lost sidecar: unreachable reason, last base kept and flagged stale, cameras say why, no /health read', async () => {
    w.reachable = false;
    w.connected = false;
    w.lastKnown = {
      stale: true, atMs: Date.now() - 5000, imu: { rpy: [0, 0, 0] }, battery: null, odometry: null,
      base: { fsmId: 801, mode: 'balance', ageS: 5.1, error: null },
    };
    const { body } = await get();
    expect(body.sidecar).toMatchObject({ reachable: false, connected: false, stale: true });
    expect(body.base).toMatchObject({ mode: 'balance', stale: true });
    expect(body.camera).toEqual({ source: null, cameras: [], detail: 'cannot reach the hardware sidecar' });
    expect(body.reason).toEqual({
      code: 'sidecar_unreachable', severity: 'block',
      text: "Can't reach the robot sidecar (8777). Start the robot side.",
    });
    expect(w.refreshCalls).toBe(0);
    expect(w.cameraCalls).toBe(0);
  });

  it('a real arm_sdk robot standing: says Switch to Balance, with the full arm and hand picture', async () => {
    w.arm = parseArmStatus({
      write_mode: 'arm_sdk', armed: false, arm_state: 'disarmed', arm_weight: 0, estop_latched: false,
      deadman: 'ok', last_disarm_reason: 'left_balance', fsm: { id: 500, age_s: 0.1 },
      lowstate_age_s: 0.004,
      hand_health: {
        left: { present: true, age_s: 0.01, error: [0, 0], motor_faults: [], power_v: 24 },
        right: { present: true, age_s: 0.01, error: [0, 0], motor_faults: [], power_v: 24 },
      },
    });
    w.loco = { gate: 'fsm', moveEnabled: false, idsVerified: true, ids: { limp: 0, stand: 4, balance: 801, balanceReported: [500] } };
    w.base = { fsmId: 4, mode: 'stand', ageS: 0.2, error: null };
    w.lease = { ...NO_LEASE, enforced: true, state: 'held', generation: 3, userId: 'u1', displayName: 'Ada', bound: 1 };
    w.view = { ...w.view, writeMode: 'arm_sdk', claims: 1 };
    w.simulatedGroups = ['joints'];
    const { body } = await get();
    expect(body.simulated).toBe(false);
    expect(body.sidecar).toMatchObject({ writeMode: 'arm_sdk', sim: false, lowstateAgeS: 0.004 });
    expect(body.base).toEqual({ gate: 'fsm', mode: 'stand', fsmId: 4, ageS: 0.2, error: null, stale: false });
    expect(body.arms).toMatchObject({
      armState: 'disarmed', armed: false, deadman: 'ok', lastDisarmReason: 'left_balance', claims: 1,
      estopLatched: false, sidecarEstopLatched: false,
    });
    expect(body.hands.right.present).toBe(true);
    expect(body.lease).toEqual({ enforced: true, state: 'held', holder: { userId: 'u1', displayName: 'Ada' }, bound: 1 });
    expect(body.telemetrySynthetic).toBe(false);
    expect(body.reason).toEqual({ code: 'mode_not_balance', severity: 'block', text: 'The robot is standing. Switch to Balance.' });

    // In balance it is the drop that the operator must hear about.
    w.base = { fsmId: 801, mode: 'balance', ageS: 0.2, error: null };
    expect((await get()).body.reason.code).toBe('disarmed_reason');
    expect((await get()).body.reason.text).toBe('Arms dropped: left balance. Squeeze the grip again.');
  });

  it('the agent\'s own E-stop is reported and wins over the mode', async () => {
    w.arm = parseArmStatus({ write_mode: 'arm_sdk' });
    w.estop = true;
    const { body } = await get();
    expect(body.arms.estopLatched).toBe(true);
    expect(body.reason.code).toBe('estop_latched');
  });

  it('without a base block, the arm path\'s fresh FSM reading names the mode through the resolved ids', async () => {
    w.arm = parseArmStatus({ write_mode: 'arm_sdk', fsm: { id: 801, age_s: 0.1 } });
    w.loco = { gate: 'fsm', moveEnabled: false, idsVerified: true, ids: { limp: 0, stand: 4, balance: 801, balanceReported: [] } };
    const { body } = await get();
    expect(body.base).toBeNull();
    expect(body.reason.code).toBe('not_engaged');
    expect(body.reason.text).toBe('Ready. Squeeze a grip to drive that arm.');
  });

  it('a stale base reading is unknown, not balance', async () => {
    w.arm = parseArmStatus({ write_mode: 'arm_sdk' });
    w.base = { fsmId: 801, mode: 'balance', ageS: 9.4, error: null };
    const { body } = await get();
    expect(body.reason).toEqual({ code: 'mode_unknown', severity: 'block', text: 'The robot mode is unknown (reading 9 s old).' });
  });

  it('asks the sidecar for its cameras at most every 10 s', async () => {
    await get();
    await get();
    expect(w.cameraCalls).toBe(1);
  });

  it('is read-only: nothing but GET is routed', async () => {
    const res = await fetch(`${base}/api/v1/robots/robot-1/readiness`, { method: 'POST' });
    expect(res.status).toBe(404);
  });
});
