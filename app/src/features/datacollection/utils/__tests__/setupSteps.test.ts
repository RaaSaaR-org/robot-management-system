/**
 * @file setupSteps.test.ts
 * @description The Set up checklist model (TASK-427): the step order for VR
 *              and non-VR sessions, the current step, waits behind a failed
 *              step, the one readiness reason landing in exactly one step and
 *              one systems cell, a missing hand as a warning, and the cells
 *              built from the same input.
 * @feature datacollection
 */

import { describe, it, expect } from 'vitest';
import { READINESS_FIXTURES, readinessFor } from '@/mocks/readinessDemoHandlers';
import type { RobotReadiness } from '@/features/robots/api/readinessApi';
import { buildPreflight } from '../preflight';
import { buildSetupModel, leaseWorkDone, reasonCell, reasonStep, stepOrder, type SetupModelInput } from '../setupSteps';

const ROBOT = 'demo-g1-001';

function preflight(online = true, agentConnected = true, sessionType: SetupModelInput['sessionType'] = 'vr_quest') {
  return buildPreflight({
    robot: { name: 'G1-EDU-4', online },
    agentConnected,
    cameras: { loading: false, names: ['head_camera'] },
    sessionType,
    secureContext: true,
    vrSupported: false,
    gamepadConnected: false,
  });
}

function input(over: Partial<SetupModelInput> = {}): SetupModelInput {
  return {
    sessionType: 'vr_quest',
    robotName: 'G1-EDU-4',
    readiness: READINESS_FIXTURES.following,
    preflight: preflight(),
    mode: { measured: 'balance', gateOn: true },
    lease: { enabled: true, bound: false, holder: 'Anna', pageInputs: false },
    operator: { present: true, name: 'Anna', inVr: true },
    ...over,
  };
}

/** A snapshot with a different reason code (the rows stay those of the base). */
function withReason(base: RobotReadiness, code: string, text = `reason ${code}`): RobotReadiness {
  return { ...base, reason: { code, severity: 'block', text, source: 'agent' } };
}

describe('step order', () => {
  it('runs a VR session through the bring-up order', () => {
    expect(stepOrder('vr_quest', false, true)).toEqual(['robot', 'arm_control', 'stance', 'quest', 'operator']);
    expect(stepOrder('vr_vision_pro', true, true)).toEqual(['robot', 'arm_control', 'stance', 'quest', 'operator']);
  });

  it('gives a gamepad session an input step, and control only when the page drives with leases on', () => {
    expect(stepOrder('gamepad', true, true)).toEqual(['robot', 'input', 'control']);
    expect(stepOrder('gamepad', true, false)).toEqual(['robot', 'input']);
    expect(stepOrder('bilateral_aloha', false, true)).toEqual(['robot', 'input']);
  });

  it('numbers the steps and gives each its Details rows', () => {
    const m = buildSetupModel(input());
    expect(m.steps.map((s) => `${s.n}:${s.id}`)).toEqual(['1:robot', '2:arm_control', '3:stance', '4:quest', '5:operator']);
    expect(m.steps.find((s) => s.id === 'stance')!.rows).toEqual(['mode']);
    expect(m.steps.find((s) => s.id === 'arm_control')!.rows).toEqual(['sidecar', 'control']);
  });
});

describe('current, done and waits', () => {
  it('is all done on a following robot with the operator in VR, and folds to one line', () => {
    const m = buildSetupModel(input({ readiness: { ...READINESS_FIXTURES.following, quest: null } }));
    expect(m.steps.every((s) => s.state === 'done')).toBe(true);
    expect(m.current).toBeNull();
    expect(m.allDone).toBe(true);
    expect(m.foldedSummary).toBe('Robot ready, arm control on, balancing, Anna in VR');
  });

  it('makes the first step that is not done current — the mockup state: read-only, limp, no Quest forwarded', () => {
    const m = buildSetupModel(input({
      readiness: readinessFor(ROBOT, 'read_only_ready'),
      mode: { measured: 'limp', gateOn: true },
      lease: { enabled: true, bound: false, holder: null, pageInputs: false },
      operator: { present: false, name: null, inVr: false },
    }));
    expect(m.steps.map((s) => s.state)).toEqual(['done', 'current', 'open', 'open', 'open']);
    expect(m.current).toBe('arm_control');
    expect(m.doneCount).toBe(1);
    const s = Object.fromEntries(m.steps.map((x) => [x.id, x]));
    expect(s.robot.summary).toBe('Running, robot state live');
    expect(s.arm_control.summary).toBe('Nobody has control');
    expect(s.arm_control.tone).toBe('warn');
    expect(s.stance.summary).toBe('Limp');
    expect(s.quest.summary).toBe('Quest connected, not forwarded');
    expect(s.operator.summary).toBe('Waiting for the headset');
    expect(s.operator.tone).toBe('idle');
  });

  it('an offline robot is the current step and every later step waits for it, without the error text', () => {
    const m = buildSetupModel(input({
      readiness: READINESS_FIXTURES.agent_unreachable,
      preflight: preflight(false),
      operator: { present: false, name: null, inVr: false },
    }));
    expect(m.steps[0].state).toBe('current');
    expect(m.steps[0].summary).toBe('G1-EDU-4 is offline');
    expect(m.steps[0].reason?.text).toBe('Robot agent is not answering.');
    for (const s of m.steps.slice(1)) {
      if (s.state === 'done') continue;
      expect(s.state).toBe('waits');
      expect(s.summary).toBe('Waits for step 1');
      expect(s.reason).toBeNull();
    }
  });

  it('a stopped robot side is the next thing to do, not a failure: later steps stay open', () => {
    const m = buildSetupModel(input({ readiness: READINESS_FIXTURES.bringup_stopped, operator: { present: false, name: null, inVr: false } }));
    expect(m.steps[0]).toMatchObject({ state: 'current', summary: 'Robot side stopped', tone: 'warn' });
    expect(m.steps.filter((s) => s.state === 'waits')).toHaveLength(0);
  });

  it('a failed robot side (the LAN is down) is red, and the operator step waits for it', () => {
    const m = buildSetupModel(input({
      readiness: READINESS_FIXTURES['bringup_failed:link'],
      operator: { present: false, name: null, inVr: false },
    }));
    expect(m.steps[0].state).toBe('current');
    expect(m.steps[0].tone).toBe('fail');
    expect(m.steps.find((s) => s.id === 'operator')!.summary).toBe('Waits for step 1');
  });

  it('reads measured state, not clicks: a robot already balancing has step 3 done before step 2', () => {
    const m = buildSetupModel(input({
      readiness: readinessFor(ROBOT, 'read_only_ready'),
      mode: { measured: 'balance', gateOn: true },
      operator: { present: false, name: null, inVr: false },
    }));
    expect(m.steps.find((s) => s.id === 'stance')!.state).toBe('done');
    expect(m.current).toBe('arm_control');
  });

  it('an unknown mode is attention (amber), never a fault', () => {
    const m = buildSetupModel(input({ mode: { measured: 'unknown', gateOn: true } }));
    const stance = m.steps.find((s) => s.id === 'stance')!;
    expect(stance.summary).toBe('Unknown');
    expect(stance.tone).toBe('warn');
    expect(stance.state).not.toBe('fault');
  });
});

describe('the one readiness reason', () => {
  it('mode_not_balance lands in step 3 and the Mode cell, and nowhere else', () => {
    const r = READINESS_FIXTURES.mode_not_balance;
    const m = buildSetupModel(input({ readiness: r, mode: { measured: 'stand', gateOn: true } }));
    const owners = m.steps.filter((s) => s.reason !== null).map((s) => s.id);
    expect(owners).toEqual(['stance']);
    expect(m.steps.find((s) => s.id === 'stance')!.reason!.text).toBe('The robot is standing. Switch it to Balance.');
    expect(m.cells.filter((c) => c.reason !== null).map((c) => c.id)).toEqual(['mode']);
  });

  const CODES: Array<[string, string, string]> = [
    // code, owning step (VR), owning cell (VR)
    ['sidecar_unreachable', 'robot', 'robot'],
    ['no_lowstate', 'robot', 'robot'],
    ['read_only', 'arm_control', 'arm_control'],
    ['estop_latched', 'operator', 'arms'],
    ['mode_unknown', 'stance', 'mode'],
    ['mode_not_balance', 'stance', 'mode'],
    ['lease_none', 'operator', 'control'],
    ['lease_duplicate', 'operator', 'control'],
    ['disarmed_reason', 'operator', 'arms'],
    ['arming', 'operator', 'arms'],
    ['deadman_hold', 'operator', 'arms'],
    ['not_engaged', 'operator', 'arms'],
    ['agent_unreachable', 'robot', 'robot'],
    ['supervisor_unreachable', 'robot', 'robot'],
    ['bringup_stopped', 'robot', 'robot'],
    ['bringup_failed:link', 'robot', 'robot'],
    ['bringup_foreign:bridge', 'robot', 'robot'],
    ['hand_missing', 'robot', 'hands'],
    ['hand_fault', 'robot', 'hands'],
  ];

  it.each(CODES)('%s lands in exactly one step (%s) and exactly one cell (%s)', (code, step, cellId) => {
    const r = withReason(READINESS_FIXTURES.following, code);
    expect(reasonStep(r, stepOrder('vr_quest', false, true))).toBe(step);
    expect(reasonCell(r, true)).toBe(cellId);
    const m = buildSetupModel(input({ readiness: r, operator: { present: false, name: null, inVr: false } }));
    expect(m.steps.filter((s) => s.reason !== null).map((s) => s.id)).toEqual([step]);
    expect(m.cells.filter((c) => c.reason !== null).map((c) => c.id)).toEqual([cellId]);
  });

  it('a non-VR session gives the lease reason to its control step, everything else to the robot', () => {
    const order = stepOrder('gamepad', true, true);
    expect(reasonStep(withReason(READINESS_FIXTURES.following, 'lease_none'), order)).toBe('control');
    expect(reasonStep(withReason(READINESS_FIXTURES.following, 'mode_not_balance'), order)).toBe('robot');
    expect(reasonStep(withReason(READINESS_FIXTURES.following, 'read_only'), order)).toBe('robot');
  });

  it('shows no reason while the robot follows', () => {
    const m = buildSetupModel(input());
    expect(m.steps.every((s) => s.reason === null)).toBe(true);
    expect(m.cells.every((c) => c.reason === null)).toBe(true);
  });
});

describe('hands', () => {
  it('a missing hand is a non-blocking warning on a done step 1', () => {
    const r = READINESS_FIXTURES.following;
    const missing: RobotReadiness = {
      ...r,
      agent: {
        ...r.agent,
        readiness: {
          ...r.agent.readiness!,
          hands: { left: r.agent.readiness!.hands!.left, right: { present: false, ageS: 41, error: [0, 0], motorFaults: [], powerV: null } },
        },
      },
    };
    const m = buildSetupModel(input({ readiness: missing }));
    const robot = m.steps[0];
    expect(robot.state).toBe('done');
    expect(robot.summary).toBe('Running; right hand missing');
    expect(robot.tone).toBe('warn');
    expect(robot.warning).toBe('right hand missing');
    expect(m.cells.find((c) => c.id === 'hands')).toMatchObject({ value: 'Right lost', status: 'fail' });
  });
});

describe('systems cells', () => {
  it('a VR session has the seven cells, from the same input as the steps', () => {
    const m = buildSetupModel(input());
    expect(m.cells.map((c) => [c.id, c.value, c.status])).toEqual([
      ['robot', 'Running', 'ok'],
      ['control', 'Anna', 'ok'],
      ['arm_control', 'On', 'ok'],
      ['mode', 'Balance', 'ok'],
      ['headset', 'In VR', 'ok'],
      ['arms', 'Following', 'ok'],
      ['hands', 'Both ok', 'ok'],
    ]);
  });

  it('agrees with the steps: read-only, limp, nobody in control', () => {
    const m = buildSetupModel(input({
      readiness: readinessFor(ROBOT, 'read_only_ready'),
      mode: { measured: 'limp', gateOn: true },
      lease: { enabled: true, bound: false, holder: null, pageInputs: false },
      operator: { present: true, name: 'Anna', inVr: false },
    }));
    const cells = Object.fromEntries(m.cells.map((c) => [c.id, c]));
    expect(cells.arm_control).toMatchObject({ value: 'Read-only', status: 'warn', reason: { code: 'read_only' } });
    expect(cells.mode).toMatchObject({ value: 'Limp', status: 'warn' });
    expect(cells.control).toMatchObject({ value: 'Nobody', status: 'warn' });
    expect(cells.headset).toMatchObject({ value: 'Not in VR', status: 'warn' });
    expect(m.steps.find((s) => s.id === 'operator')!.summary).toBe('Anna is in the session, not in VR yet');
  });

  it('a gamepad session has Robot side, Control and Input', () => {
    const m = buildSetupModel(input({
      sessionType: 'gamepad',
      preflight: preflight(true, true, 'gamepad'),
      lease: { enabled: true, bound: true, holder: null, pageInputs: true },
    }));
    expect(m.steps.map((s) => s.id)).toEqual(['robot', 'input', 'control']);
    expect(m.steps.find((s) => s.id === 'input')).toMatchObject({ state: 'current', summary: 'No gamepad found' });
    expect(m.steps.find((s) => s.id === 'control')).toMatchObject({ state: 'done', summary: 'You have control' });
    expect(m.cells.map((c) => c.id)).toEqual(['robot', 'control', 'input']);
    expect(m.cells.find((c) => c.id === 'control')!.value).toBe('You');
  });
});

describe('the lease hand-over is due', () => {
  it('once arm control is on and the robot balances, whoever is in the session', () => {
    expect(leaseWorkDone(readinessFor(ROBOT, 'mode_not_balance'), { measured: 'balance', gateOn: true })).toBe(true);
  });

  it('not while the robot only stands or is limp, nor before a readiness snapshot', () => {
    expect(leaseWorkDone(readinessFor(ROBOT, 'mode_not_balance'), { measured: 'stand', gateOn: true })).toBe(false);
    expect(leaseWorkDone(readinessFor(ROBOT, 'mode_not_balance'), { measured: 'limp', gateOn: true })).toBe(false);
    expect(leaseWorkDone(null, { measured: 'balance', gateOn: true })).toBe(false);
  });

  it('not while the sidecar is read-only, even with the robot balancing (step 2 still needs control)', () => {
    expect(leaseWorkDone(readinessFor(ROBOT, 'read_only_ready'), { measured: 'balance', gateOn: true })).toBe(false);
  });

  it('agrees with steps 2 and 3 of the model', () => {
    for (const name of ['following', 'mode_not_balance', 'read_only_ready'] as const) {
      for (const measured of ['limp', 'stand', 'balance'] as const) {
        const readiness = readinessFor(ROBOT, name);
        const mode = { measured, gateOn: true };
        const m = buildSetupModel(input({ readiness, mode }));
        const done = (id: string) => m.steps.find((s) => s.id === id)!.state === 'done';
        expect(leaseWorkDone(readiness, mode)).toBe(done('arm_control') && done('stance'));
      }
    }
  });
});
