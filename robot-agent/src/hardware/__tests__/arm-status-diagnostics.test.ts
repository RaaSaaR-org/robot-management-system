/**
 * @file arm-status-diagnostics.test.ts
 * @description TASK-405: `parseArmStatus` keeps the diagnostic fields a
 *              TASK-398-era arm_sdk sidecar and a TASK-404 sidecar send, and
 *              reports `null` for each one an older sidecar leaves out.
 * @feature hardware
 * @status test
 */

import { describe, it, expect } from 'vitest';
import { parseArmStatus, parseHandHealth, sameArmStatus, UNKNOWN_ARM_STATUS } from '../arm-status.js';

/** `/health` of an arm_sdk sidecar as `g1_arm_sdk.py` `_snapshot_locked` + `write_status()` build it today. */
const TASK_398_HEALTH = {
  status: 'ok',
  connected: true,
  read_only: false,
  boot_id: 'b-1',
  write_mode: 'arm_sdk',
  armed: false,
  arm_state: 'disarmed',
  arm_weight: 0,
  estop_latched: false,
  hands: { left: true, right: true },
  teleop_mode: 'arms+hands',
  lease_generation: 7,
  deadman: 'ok',
  last_disarm_reason: 'tracking_error',
  ignored_joints: { left_wrist_yaw_joint: 'nan' },
  track_err_rad: 0.412,
  track_err_joint: 'left_elbow_joint',
  fsm: { id: 801, age_s: 0.05 },
  dds_domain: 42,
  dds_iface: 'lo',
  loco: { gate: 'fsm' },
  base: { mode: 'balance', fsm_id: 801, age_s: 0.05 },
};

/** The same, plus what TASK-404 adds. */
const TASK_404_HEALTH = {
  ...TASK_398_HEALTH,
  lowstate_age_s: 0.004,
  hand_health: {
    left: { present: true, age_s: 0.01, error: [0, 0], motor_faults: [], power_v: 24.3 },
    right: {
      present: true,
      age_s: 0.02,
      error: [512, 0],
      motor_faults: [{ motor: 1, joint: 'right_hand_thumb_1_joint', code: '0x200', bits: ['overcurrent'] }],
      power_v: 24.1,
    },
  },
};

/** A sidecar from before the arm-only contract: none of the diagnostics. */
const OLD_HEALTH = { status: 'ok', connected: true, read_only: true };

describe('parseArmStatus — TASK-405 diagnostics', () => {
  it('keeps every field of a TASK-398-era /health', () => {
    const s = parseArmStatus(TASK_398_HEALTH);
    expect(s).toMatchObject({
      writeMode: 'arm_sdk',
      armState: 'disarmed',
      deadman: 'ok',
      lastDisarmReason: 'tracking_error',
      trackErrRad: 0.412,
      trackErrJoint: 'left_elbow_joint',
      fsm: { id: 801, ageS: 0.05 },
      leaseGeneration: 7,
      ignoredJoints: { left_wrist_yaw_joint: 'nan' },
      ddsDomain: 42,
    });
    // That sidecar predates TASK-404.
    expect(s.lowstateAgeS).toBeNull();
    expect(s.handHealth).toBeNull();
  });

  it('keeps hand_health and lowstate_age_s of a TASK-404 /health', () => {
    const s = parseArmStatus(TASK_404_HEALTH);
    expect(s.lowstateAgeS).toBe(0.004);
    expect(s.handHealth).toEqual({
      left: { present: true, ageS: 0.01, error: [0, 0], motorFaults: [], powerV: 24.3 },
      right: {
        present: true,
        ageS: 0.02,
        error: [512, 0],
        motorFaults: [{ motor: 1, joint: 'right_hand_thumb_1_joint', code: '0x200', bits: ['overcurrent'] }],
        powerV: 24.1,
      },
    });
    expect(s.deadman).toBe('ok');
  });

  it('returns null for each diagnostic an old sidecar does not send', () => {
    const s = parseArmStatus(OLD_HEALTH);
    for (const key of [
      'armState', 'deadman', 'lastDisarmReason', 'trackErrRad', 'trackErrJoint', 'fsm',
      'leaseGeneration', 'ignoredJoints', 'ddsDomain', 'lowstateAgeS', 'handHealth',
    ] as const) {
      expect(s[key], key).toBeNull();
    }
    expect(s.readOnly).toBe(true);
  });

  it('does not guess unknown values', () => {
    const s = parseArmStatus({ arm_state: 'flying', deadman: 'maybe', track_err_rad: 'big', fsm: { id: 'x' } });
    expect(s.armState).toBeNull();
    expect(s.deadman).toBeNull();
    expect(s.trackErrRad).toBeNull();
    expect(s.fsm).toEqual({ id: null, ageS: null });
  });

  it('reads a hand block with missing pieces as unknown, never healthy', () => {
    expect(parseHandHealth({})).toEqual({ present: null, ageS: null, error: null, motorFaults: [], powerV: null });
    expect(parseHandHealth({ present: false, age_s: null })).toMatchObject({ present: false, ageS: null });
    expect(parseHandHealth({ motor_faults: [{ motor: 2, code: 512 }] }).motorFaults)
      .toEqual([{ motor: 2, joint: 'motor_2', code: '0x200', bits: [] }]);
  });

  it('change detection hears a new disarm reason or hand fault, not a ticking age', () => {
    const a = parseArmStatus(TASK_404_HEALTH);
    const older = parseArmStatus({ ...TASK_404_HEALTH, lowstate_age_s: 0.5 });
    expect(sameArmStatus(a, older)).toBe(true);
    expect(sameArmStatus(a, { ...a, lastDisarmReason: 'deadman' })).toBe(false);
    expect(sameArmStatus(a, { ...a, deadman: 'hold' })).toBe(false);
    expect(sameArmStatus(a, parseArmStatus({ ...TASK_404_HEALTH, hand_health: null }))).toBe(false);
    expect(sameArmStatus({ ...UNKNOWN_ARM_STATUS }, { ...UNKNOWN_ARM_STATUS })).toBe(true);
  });
});
