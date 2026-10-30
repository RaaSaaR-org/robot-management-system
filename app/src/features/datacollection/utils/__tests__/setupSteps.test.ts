/**
 * @file setupSteps.test.ts
 * @description The Set up checklist model (TASK-427): the step order for VR
 *              and non-VR sessions, the current step, waits behind a failed
 *              step, the one readiness reason landing in exactly one step and
 *              one systems cell, a missing hand as a warning, and the cells
 *              built from the same input. TASK-430: step 1's robot-side buttons
 *              — Start when stopped, Restart when the robot side runs stale
 *              code, Stop under Details while it runs, none of them while it
 *              stops. TASK-431: a stop is step 3's blocker (steps 4 and 5 wait
 *              for it), or step 1's without a step 3; a read-only sidecar is
 *              never "Arm control on", sim or not.
 * @feature datacollection
 */

import { describe, it, expect } from 'vitest';
import { READINESS_FIXTURES, readinessFor } from '@/mocks/readinessDemoHandlers';
import type { RobotReadiness } from '@/features/robots/api/readinessApi';
import { buildPreflight } from '../preflight';
import { armControlOn, buildSetupModel, leaseWorkDone, reasonCell, reasonStep, robotSideButtons, stepOrder, type SetupModelInput } from '../setupSteps';
import { robotStop } from '../robotStop';
import type { BringupStep } from '@/features/robots/api/readinessApi';

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
    ['estop_latched', 'stance', 'arms'],
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

describe('step 1\'s robot-side buttons (TASK-430)', () => {
  const STALE = { startedAt: '2026-10-29T18:05:00.000Z', codeAt: '2026-10-30T00:44:00.000Z' };
  const robotStep = (m: ReturnType<typeof buildSetupModel>) => m.steps.find((s) => s.id === 'robot')!;
  /** The stale-code fixture with its sidecar step changed. */
  const staleSidecar = (change: Partial<BringupStep>): RobotReadiness => {
    const base = readinessFor(ROBOT, 'sidecar_stale_code');
    return { ...base, bringup: { ...base.bringup!, steps: base.bringup!.steps.map((s) => (s.id === 'sidecar' ? { ...s, ...change } : s)) } };
  };
  const overall = (name: Parameters<typeof readinessFor>[1], o: NonNullable<RobotReadiness['bringup']>['overall']): RobotReadiness => {
    const base = readinessFor(ROBOT, name);
    return { ...base, bringup: { ...base.bringup!, overall: o } };
  };

  it('stale code: step 1 fails with the stale row, owns the reason, and leads with Restart; no Stop under Details', () => {
    const m = buildSetupModel(input({ readiness: readinessFor(ROBOT, 'sidecar_stale_code'), operator: { present: false, name: null, inVr: false } }));
    const robot = robotStep(m);
    expect(m.current).toBe('robot');
    expect(robot.state).toBe('current');
    expect(robot.tone).toBe('fail');
    expect(robot.summary).toMatch(/^Sidecar: runs code from before /);
    expect(robot.reason).toMatchObject({ code: 'agent_outdated', text: 'The sidecar runs older code than NeoDEM. Restart the robot side.' });
    expect(m.robotSide).toEqual({ lead: 'restart', stop: false });
    // Every later VR step waits for it, and the reason is stated once.
    expect(m.steps.filter((s) => s.id !== 'robot' && s.id !== 'stance').every((s) => s.state === 'waits' && s.waitsFor === 1)).toBe(true);
    expect(m.steps.filter((s) => s.reason !== null)).toHaveLength(1);
  });

  it('stopped: Start is the lead and there is nothing to stop', () => {
    expect(buildSetupModel(input({ readiness: readinessFor(ROBOT, 'bringup_stopped') })).robotSide).toEqual({ lead: 'start', stop: false });
    // A failed robot side (error) starts again too.
    expect(robotSideButtons(readinessFor(ROBOT, 'bringup_failed:link'))).toEqual({ lead: 'start', stop: true });
  });

  it('running ok: nothing lit in step 1, and Stop waits under Details', () => {
    for (const name of ['following', 'read_only_ready', 'mode_not_balance'] as const) {
      expect(robotSideButtons(readinessFor(ROBOT, name)), name).toEqual({ lead: null, stop: true });
    }
    expect(buildSetupModel(input()).robotSide).toEqual({ lead: null, stop: true });
  });

  it('stopping (a restart in flight): no lead, and step 1 says it is stopping', () => {
    const m = buildSetupModel(input({ readiness: overall('bringup_stopped', 'stopping') }));
    expect(m.robotSide.lead).toBeNull();
    expect(robotStep(m).summary).toBe('Stopping the robot side…');
    // Stale code while still starting: no Restart until it runs.
    expect(robotSideButtons(overall('sidecar_stale_code', 'starting')).lead).toBeNull();
  });

  it('degraded with stale code still leads with Restart', () => {
    expect(robotSideButtons(overall('sidecar_stale_code', 'degraded'))).toEqual({ lead: 'restart', stop: false });
  });

  it('no Restart for a process the supervisor never signals: foreign or adopted', () => {
    const foreign = staleSidecar({
      state: 'foreign', owned: false, checks: {},
      foreign: { pid: 31337, cmdline: ['python3', 'g1_sidecar.py'], since: STALE.startedAt, port: 8767, staleCode: STALE },
    });
    expect(robotSideButtons(foreign).lead).toBeNull();
    const adopted = staleSidecar({ owned: false });
    expect(robotSideButtons(adopted)).toEqual({ lead: null, stop: true });
  });

  it('an owned agent without a readiness route (older code) is cured by a restart as well', () => {
    const base = readinessFor(ROBOT, 'read_only_ready');
    const outdated: RobotReadiness = {
      ...base,
      agent: { reachable: true, error: 'HTTP 404 (no readiness route)', readiness: null, outdated: true },
      reason: { code: 'agent_outdated', severity: 'block', text: 'The robot agent runs older code than NeoDEM. Restart the robot side.', source: 'server' },
    };
    expect(robotSideButtons(outdated).lead).toBe('restart');
    const m = buildSetupModel(input({ readiness: outdated }));
    expect(robotStep(m).summary).toBe('Agent: older code than NeoDEM');
    expect(robotStep(m).reason?.code).toBe('agent_outdated');
  });

  it('no robot side reported (no supervisor): nothing to start, restart or stop', () => {
    expect(robotSideButtons({ ...READINESS_FIXTURES.following, bringup: null })).toEqual({ lead: null, stop: false });
    expect(robotSideButtons(null)).toEqual({ lead: null, stop: false });
  });
});

// ---------------------------------------------------------------------------
// TASK-431 — a stop is the blocker of the step it blocks
// ---------------------------------------------------------------------------
describe('a stop in Set up (TASK-431)', () => {
  const latched = robotStop({
    agentLatched: true, sidecarLatched: false, status: 'protective_stop',
    warnings: ['Emergency stop activated: Platform E-Stop: Emergency stop triggered for G1-EDU-4 (real)'],
  })!;
  const unlatched = robotStop({ agentLatched: false, sidecarLatched: false, status: 'protective_stop', warnings: [] })!;
  const up = (over: Partial<SetupModelInput> = {}) => input({
    readiness: readinessFor(ROBOT, 'estop_latched'),
    mode: { measured: 'limp', gateOn: true },
    operator: { present: false, name: null, inVr: false },
    ...over,
  });

  it('a latched E-stop fails step 3, which is current and owns the stop line; steps 4 and 5 wait for it', () => {
    const m = buildSetupModel(up({ stop: latched }));
    const s = Object.fromEntries(m.steps.map((x) => [x.id, x]));
    expect(m.current).toBe('stance');
    expect(m.stopStep).toBe('stance');
    expect(s.stance).toMatchObject({ state: 'current', summary: 'E-stop latched', tone: 'fail' });
    expect(s.stance.reason).toEqual({ code: 'estop_latched', text: 'E-stop is latched.', severity: 'block' });
    expect(s.quest).toMatchObject({ state: 'waits', summary: 'Waits for step 3', reason: null });
    expect(s.operator).toMatchObject({ state: 'waits', summary: 'Waits for step 3', reason: null });
    // The readiness line "E-stop is latched. Reset it…" is not said a second time anywhere.
    expect(m.steps.filter((x) => x.reason !== null).map((x) => x.id)).toEqual(['stance']);
    expect(m.allDone).toBe(false);
  });

  it('with step 2 still open, step 3 is a fault that keeps its stop line, and step 2 stays current', () => {
    const m = buildSetupModel(up({ readiness: readinessFor(ROBOT, 'read_only_ready'), stop: latched }));
    const s = Object.fromEntries(m.steps.map((x) => [x.id, x]));
    expect(m.current).toBe('arm_control');
    expect(s.stance).toMatchObject({ state: 'fault', summary: 'E-stop latched' });
    expect(s.stance.reason?.code).toBe('estop_latched');
    expect(s.arm_control.reason?.code).toBe('read_only');
  });

  it('a protective stop with no latch blocks step 3 as well, under its own name', () => {
    const m = buildSetupModel(up({ readiness: readinessFor(ROBOT, 'protective_stop_unlatched'), stop: unlatched }));
    const stance = m.steps.find((x) => x.id === 'stance')!;
    expect(stance).toMatchObject({ state: 'current', summary: 'Protective stop', tone: 'fail' });
    expect(stance.reason).toEqual({ code: 'protective_stop', text: 'Protective stop.', severity: 'block' });
    expect(m.stopStep).toBe('stance');
  });

  it('without a stop, step 3 is the bring-up track again', () => {
    const m = buildSetupModel(up({ readiness: readinessFor(ROBOT, 'estop_reset_limp'), stop: null }));
    const stance = m.steps.find((x) => x.id === 'stance')!;
    expect(stance).toMatchObject({ state: 'current', summary: 'Limp' });
    expect(stance.reason?.code).toBe('mode_not_balance');
    expect(m.stopStep).toBeNull();
    expect(m.steps.find((x) => x.id === 'quest')!.state).not.toBe('waits');
  });

  it('a non-VR session has no step 3: the stop blocks a running step 1', () => {
    const m = buildSetupModel(up({
      sessionType: 'gamepad',
      preflight: preflight(true, true, 'gamepad'),
      lease: { enabled: true, bound: false, holder: null, pageInputs: true },
      stop: latched,
    }));
    expect(m.stopStep).toBe('robot');
    expect(m.steps[0]).toMatchObject({ id: 'robot', state: 'current', summary: 'E-stop latched', tone: 'fail' });
    expect(m.steps[0].reason?.code).toBe('estop_latched');
  });

  it('a non-VR robot side that is not up leads with its own problem, not the stop', () => {
    const m = buildSetupModel(up({
      sessionType: 'gamepad',
      preflight: preflight(true, true, 'gamepad'),
      readiness: READINESS_FIXTURES.bringup_stopped,
      stop: unlatched,
    }));
    expect(m.stopStep).toBeNull();
    expect(m.steps[0].summary).toBe('Robot side stopped');
  });
});

describe('arm control on (TASK-431)', () => {
  const withSidecar = (sidecar: Partial<NonNullable<RobotReadiness['agent']['readiness']>['sidecar']>): RobotReadiness => {
    const base = READINESS_FIXTURES.following;
    const ar = base.agent.readiness!;
    return { ...base, agent: { ...base.agent, readiness: { ...ar, sidecar: { ...ar.sidecar, ...sidecar } } } };
  };

  it('the legacy MuJoCo sim sidecar (sim, no write mode) has no read-only gate: on', () => {
    expect(armControlOn(withSidecar({ sim: true, writeMode: null, readOnly: false }))).toBe(true);
  });

  it('the supervisor sim (the real g1_sidecar.py, read-only) is not on, and step 2 asks for control', () => {
    const r = withSidecar({ sim: true, writeMode: 'read_only', readOnly: true });
    expect(armControlOn(r)).toBe(false);
    const m = buildSetupModel(input({ readiness: r, lease: { enabled: true, bound: false, holder: null, pageInputs: false } }));
    const arm = m.steps.find((x) => x.id === 'arm_control')!;
    expect(arm.state).toBe('current');
    expect(arm.summary).toBe('Nobody has control');
    expect(m.cells.find((c) => c.id === 'arm_control')).toMatchObject({ value: 'Read-only', status: 'warn' });
  });

  it('a sim sidecar that says read_only without the readOnly flag is still not on', () => {
    expect(armControlOn(withSidecar({ sim: true, writeMode: 'read_only', readOnly: false }))).toBe(false);
  });

  it('the supervisor sim switched to arm control is on', () => {
    expect(armControlOn(withSidecar({ sim: true, writeMode: 'arm_sdk', readOnly: false }))).toBe(true);
  });

  it('a real sidecar: arm_sdk is on, read_only and an unknown write mode are not', () => {
    expect(armControlOn(withSidecar({ sim: false, writeMode: 'arm_sdk', readOnly: false }))).toBe(true);
    expect(armControlOn(withSidecar({ sim: false, writeMode: 'read_only', readOnly: true }))).toBe(false);
    expect(armControlOn(withSidecar({ sim: false, writeMode: null, readOnly: false }))).toBe(false);
  });

  it('the hand-over is not due on the read-only supervisor sim, even balancing', () => {
    const r = withSidecar({ sim: true, writeMode: 'read_only', readOnly: true });
    expect(leaseWorkDone(r, { measured: 'balance', gateOn: true })).toBe(false);
  });
});
