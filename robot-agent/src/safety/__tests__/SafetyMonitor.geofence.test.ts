/**
 * @file SafetyMonitor.geofence.test.ts
 * @description `SafetyStopType 'zone_violation'` (TASK-200) — the enum this file
 *   has declared since the safety system was written and nothing implemented.
 * @feature safety
 *
 * Four claims, all of them the task's own words:
 *   1. a KNOWN pose inside a margined keepout triggers `zone_violation`;
 *   2. a null or stale pose does NOT — and does not release one either;
 *   3. recovery is possible for an operator who can see the robot is clear;
 *   4. it goes through the EXISTING protective-stop path (same latch rules, same
 *      event log), not a second one.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SafetyMonitor, type StopActuation } from '../SafetyMonitor.js';
import type { GeofenceStatus, ZoneViolation } from '../types.js';
import type { SimulatedRobotState } from '../../robot/types.js';

const RACK: ZoneViolation = {
  placeId: 'RACK-A',
  placeName: 'Rack A',
  depthM: 0.62,
  poseM: { x: 4.2, y: 1.1 },
};

const VIOLATING: GeofenceStatus = { kind: 'violating', violation: RACK };
const CLEAR: GeofenceStatus = { kind: 'clear' };
const UNKNOWN: GeofenceStatus = { kind: 'unknown', cause: 'no-pose', reason: 'no pose sample' };

function makeMonitor() {
  const state = {
    speed: 1.2,
    status: 'online',
    warnings: [] as string[],
    errors: [] as string[],
    location: { x: 4.2, y: 1.1, zone: 'Warehouse A' },
    batteryLevel: 90,
    updatedAt: new Date().toISOString(),
  } as unknown as SimulatedRobotState;

  const monitor = new SafetyMonitor(
    () => state,
    (updater) => updater(state),
    () => undefined,
  );
  return { monitor, state };
}

describe('SafetyMonitor geofence (zone_violation)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('a KNOWN pose inside a keepout takes a protective stop', () => {
    const { monitor, state } = makeMonitor();

    monitor.updateGeofence(VIOLATING);

    const estop = monitor.getEStopState();
    expect(estop.status).toBe('triggered');
    // The EXISTING protective-stop path: system-triggered, auto-resettable,
    // category 2 — not a new kind of stop with its own rules.
    expect(estop.triggeredBy).toBe('system');
    expect(estop.requiresManualReset).toBe(false);
    expect(estop.reason).toContain('Keepout violated');
    expect(estop.reason).toContain('Rack A');

    // …and the motion side of the same call really happened.
    expect(state.speed).toBe(0);
    expect(state.warnings.some((w) => w.includes('Keepout violated'))).toBe(true);
  });

  it('logs it as `zone_violation`, not as a generic protective stop', () => {
    const { monitor } = makeMonitor();
    monitor.updateGeofence(VIOLATING);

    const [event] = monitor.getSafetyEvents();
    expect(event?.type).toBe('zone_violation');
    expect(event?.stopCategory).toBe(2);
    expect(event?.context.location).toMatchObject({ x: 4.2, y: 1.1 });
  });

  it('does not re-trigger while standing in the SAME keepout', () => {
    const { monitor } = makeMonitor();
    for (let i = 0; i < 10; i++) monitor.updateGeofence(VIOLATING);
    expect(monitor.getSafetyEvents()).toHaveLength(1);
  });

  it('DOES re-trigger for a different keepout, so the reason names the right fence', () => {
    const { monitor } = makeMonitor();
    monitor.updateGeofence(VIOLATING);
    monitor.updateGeofence({
      kind: 'violating',
      violation: { ...RACK, placeId: 'DOCK-EDGE', placeName: 'Dock 1 Edge' },
    });
    expect(monitor.getEStopState().reason).toContain('Dock 1 Edge');
    expect(monitor.getSafetyEvents()).toHaveLength(2);
  });

  it('an UNKNOWN geofence never triggers a stop', () => {
    const { monitor } = makeMonitor();
    for (let i = 0; i < 5; i++) monitor.updateGeofence(UNKNOWN);
    expect(monitor.getEStopState().status).toBe('armed');
    expect(monitor.getSafetyEvents()).toHaveLength(0);
    expect(monitor.getZoneViolation()).toBeNull();
  });

  it('an UNKNOWN geofence does not RELEASE a stop either', () => {
    const { monitor } = makeMonitor();
    monitor.updateGeofence(VIOLATING);

    // The sidecar drops the pose poll, or the drift budget runs out. Losing
    // sight of the robot is not evidence that it left the rack.
    monitor.updateGeofence(UNKNOWN);
    monitor.updateGeofence(UNKNOWN);

    expect(monitor.getEStopState().status).toBe('triggered');
    expect(monitor.getZoneViolation()?.placeId).toBe('RACK-A');
  });

  it('releases on positive evidence of clearance', () => {
    const { monitor, state } = makeMonitor();
    monitor.updateGeofence(VIOLATING);
    expect(monitor.getEStopState().status).toBe('triggered');

    monitor.updateGeofence(CLEAR);

    expect(monitor.getEStopState().status).toBe('armed');
    expect(monitor.getZoneViolation()).toBeNull();
    expect(state.warnings.some((w) => w.includes('Keepout violated'))).toBe(false);
  });

  it('is recoverable by an operator reset, and re-entering stops again', () => {
    const { monitor, state } = makeMonitor();
    monitor.updateGeofence(VIOLATING);

    // A reset needs the server: `canReset()` refuses while disconnected, which
    // is pre-existing behaviour and not what this test is about.
    monitor.updateServerHeartbeat();
    expect(monitor.resetEmergencyStop()).toBe(true);
    expect(monitor.getEStopState().status).toBe('armed');
    expect(state.warnings.some((w) => w.includes('Keepout violated'))).toBe(false);
    expect(monitor.getZoneViolation()).toBeNull();

    // The reset means "I have looked at the robot", not "that fence no longer
    // applies": walking back in is a fresh violation.
    monitor.updateGeofence(VIOLATING);
    expect(monitor.getEStopState().status).toBe('triggered');
  });

  it('never releases an EMERGENCY stop that cascaded over it', () => {
    const { monitor } = makeMonitor();
    monitor.updateGeofence(VIOLATING);
    monitor.triggerEmergencyStop('local', 'operator hit the E-Stop');

    monitor.updateGeofence(CLEAR);

    const estop = monitor.getEStopState();
    expect(estop.status).toBe('triggered');
    expect(estop.reason).toBe('operator hit the E-Stop');
    expect(estop.stopCategory).toBe(0);
  });

  it('does not release a protective stop somebody ELSE latched', () => {
    const { monitor } = makeMonitor();
    monitor.triggerProtectiveStop('protective_stop', 'Fall risk: body tilt 31.0°');

    // The geofence has nothing latched, so a clear verdict must be a no-op.
    monitor.updateGeofence(CLEAR);

    expect(monitor.getEStopState().status).toBe('triggered');
    expect(monitor.getEStopState().reason).toContain('Fall risk');
  });

  it('surfaces the stop in getStatus() alongside systemHealthy=false', () => {
    const { monitor } = makeMonitor();
    monitor.updateGeofence(VIOLATING);

    const status = monitor.getStatus();
    expect(status.systemHealthy).toBe(false);
    expect(status.warnings.some((w) => w.includes('Keepout violated'))).toBe(true);
  });
});

// ============================================================================
// The stop has to ACTUATE, not merely be recorded (TASK-200 review, finding 1)
// ============================================================================

describe('SafetyMonitor stop actuation', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('a keepout violation ACTUATES — it does not just write a warning', () => {
    // The bug: `updateGeofence` → `triggerProtectiveStop` mutated
    // `SimulatedRobotState` and wrote a compliance record, and commanded
    // nothing. Nothing subscribed to `onSafetyEvent`, so a plan that was
    // driving kept driving.
    const { monitor } = makeMonitor();
    const actuated: StopActuation[] = [];
    monitor.setStopActuator((stop) => {
      actuated.push(stop);
    });

    monitor.updateGeofence(VIOLATING);

    expect(actuated).toHaveLength(1);
    expect(actuated[0]?.type).toBe('zone_violation');
    expect(actuated[0]?.category).toBe(2);
    expect(actuated[0]?.reason).toContain('Rack A');
  });

  it('actuates an emergency stop with the cause that is happening NOW', () => {
    const { monitor } = makeMonitor();
    const actuated: StopActuation[] = [];
    monitor.setStopActuator((stop) => {
      actuated.push(stop);
    });

    monitor.triggerEmergencyStop('local', 'operator hit the E-Stop');
    // A protective stop cascading over a latched E-Stop leaves the RECORD to
    // the E-Stop — but the actuator must hear about the stop being taken, not
    // about the one that owns the record.
    monitor.updateGeofence(VIOLATING);

    expect(actuated.map((a) => a.type)).toEqual(['emergency_stop', 'zone_violation']);
    expect(actuated[0]?.category).toBe(0);
    expect(actuated[1]?.reason).toContain('Keepout violated');
  });

  it('a failing actuator still leaves the latch and the event log intact', () => {
    const { monitor } = makeMonitor();
    monitor.setStopActuator(() => {
      throw new Error('sidecar exploded');
    });

    monitor.updateGeofence(VIOLATING);

    expect(monitor.getEStopState().status).toBe('triggered');
    expect(monitor.getSafetyEvents()).toHaveLength(1);
  });

  it('an actuator that itself takes a stop does not recurse', () => {
    const { monitor } = makeMonitor();
    let calls = 0;
    monitor.setStopActuator(() => {
      calls++;
      // An abort path that trips another check is a real shape (a teleop
      // takeover that fails a comms watchdog); it must not blow the stack
      // during a safety stop.
      monitor.triggerProtectiveStop('system_failure', 'cascade');
    });

    monitor.updateGeofence(VIOLATING);

    expect(calls).toBe(1);
  });

  it('actuates a LATER stop even after an async actuator', async () => {
    // The re-entrancy guard covers the synchronous call only. Swallowing the
    // second of two genuine stops would be the same class of bug as not
    // actuating the first.
    const { monitor } = makeMonitor();
    const actuated: StopActuation[] = [];
    monitor.setStopActuator(async (stop) => {
      actuated.push(stop);
      await Promise.resolve();
    });

    monitor.updateGeofence(VIOLATING);
    monitor.updateGeofence({
      kind: 'violating',
      violation: { ...RACK, placeId: 'DOCK-EDGE', placeName: 'Dock 1 Edge' },
    });
    await Promise.resolve();

    expect(actuated.map((a) => a.reason)).toEqual([
      expect.stringContaining('Rack A'),
      expect.stringContaining('Dock 1 Edge'),
    ]);
  });

  it('an unknown or repeated verdict actuates nothing', () => {
    const { monitor } = makeMonitor();
    const actuated: StopActuation[] = [];
    monitor.setStopActuator((stop) => {
      actuated.push(stop);
    });

    monitor.updateGeofence(UNKNOWN);
    monitor.updateGeofence(VIOLATING);
    for (let i = 0; i < 5; i++) monitor.updateGeofence(VIOLATING);

    expect(actuated).toHaveLength(1);
  });
});
