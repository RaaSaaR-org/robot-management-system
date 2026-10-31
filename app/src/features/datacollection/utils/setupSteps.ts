/**
 * @file setupSteps.ts
 * @description The Set up checklist of the session page (TASK-427) as a pure
 *              model: the steps in bring-up order, which one is current, which
 *              wait on a failed one, which step owns the robot's one readiness
 *              reason, and the systems cells the Record console folds them
 *              into (TASK-428). Built from what the page already reads — the
 *              readiness snapshot, the preflight items, the measured base
 *              mode, the control lease and the operator's presence — so the
 *              steps and the cells can never disagree. No React.
 *              TASK-430: step 1's robot-side buttons — Start, or Restart when
 *              the robot side runs stale code, and Stop under Details while it
 *              runs — from the same rules the buttons use.
 *              TASK-431: a stop (a latched E-stop, or a protective stop with no
 *              latch) is the blocker of step 3, which it blocks: the robot is
 *              damped and must stand up again; steps 4 and 5 wait for it. A
 *              sidecar that reports read-only is never "Arm control on", sim
 *              or not.
 *              TASK-437: only the legacy MuJoCo facade skips step 3 for want of
 *              a locomotion FSM; a supervisor sim mid-restart is not balancing.
 *              TASK-442: a session with a camera list gets a Cameras cell, its
 *              camera set as the value; a chosen wrist camera the robot does
 *              not serve turns it red and owns a blocking reason.
 * @feature datacollection
 */

import type { RobotReadiness } from '../../robots/api/readinessApi';
import type { BaseModeName } from '../../robots/api/baseModeApi';
import {
  questSummary,
  readinessRows,
  reasonRow,
  robotSideActions,
  type ReadinessRowModel,
  type RowId,
  type RowStatus,
} from '../../robots/components/readiness/readinessRows';
import type { TeleoperationType } from '../types/datacollection.types';
import type { PreflightItem } from './preflight';
import { cameraCountLabel, cameraSetLabel } from './cameras';
import type { RobotStop } from './robotStop';

export type SetupStepId = 'robot' | 'arm_control' | 'stance' | 'quest' | 'operator' | 'input' | 'control';

/** `current`: the first step that is not done. `fault`: a later step that failed. `waits`: behind a failed step. */
export type SetupStepState = 'done' | 'current' | 'open' | 'waits' | 'fault';

/** The summary's colour: ok mint, warn amber, fail red, idle grey with a hollow dot. */
export type SetupTone = 'ok' | 'warn' | 'fail' | 'idle';

export interface SetupReason {
  code: string;
  text: string;
  severity: 'block' | 'warn' | 'ok';
}

export interface SetupStep {
  id: SetupStepId;
  /** 1-based position, as the node shows it. */
  n: number;
  title: string;
  state: SetupStepState;
  /** One short line, always visible on the row. Never the reason sentence. */
  summary: string;
  tone: SetupTone;
  /** The readiness reason this step owns, shown once in its body. */
  reason: SetupReason | null;
  /** A non-blocking note on a done step ("right hand missing"). */
  warning: string | null;
  /** The readiness rows its Details disclosure shows. */
  rows: RowId[];
  /** The step number this one waits for, when `waits`. */
  waitsFor: number | null;
}

export type SystemsCellId = 'robot' | 'control' | 'arm_control' | 'mode' | 'headset' | 'arms' | 'hands' | 'input' | 'cameras';
export type SystemsCellStatus = 'ok' | 'warn' | 'fail' | 'idle';

export interface SystemsCell {
  id: SystemsCellId;
  label: string;
  value: string;
  status: SystemsCellStatus;
  /** The readiness reason this cell owns (the same one a step owns). */
  reason: SetupReason | null;
  /** The full value, when `value` is a short form of it (the Cameras cell). */
  title?: string;
}

export interface SetupModelInput {
  sessionType: TeleoperationType;
  robotName: string;
  /** The merged readiness snapshot, or null while none has arrived. */
  readiness: RobotReadiness | null;
  /** The page port the Quest reaches (default 1420). */
  questPort?: number;
  /** `buildPreflight()` for this session. */
  preflight: PreflightItem[];
  /** The measured base mode (`useRobotBaseMode`), and whether this sidecar can change it. */
  mode: { measured: BaseModeName | null; gateOn: boolean };
  /** The page's control lease. `pageInputs`: the page drives with its own input (gamepad, simulated VR). */
  lease: { enabled: boolean; bound: boolean; holder: string | null; pageInputs: boolean };
  /** The session's operator in the headset, from presence and the relayed state. */
  operator: { present: boolean; name: string | null; inVr: boolean };
  /** What holds the robot stopped (`robotStop()`), or null (TASK-431). */
  stop?: RobotStop | null;
  /** The cameras the session records (`session.cameras`); null or absent is head only, no Cameras cell (TASK-442). */
  sessionCameras?: string[] | null;
}

export interface SetupModel {
  steps: SetupStep[];
  /** The first step that is not done; null when every step is. */
  current: SetupStepId | null;
  doneCount: number;
  allDone: boolean;
  /** Every step done, as one line ("Robot ready, arm control on, balancing, Anna in VR"). */
  foldedSummary: string;
  cells: SystemsCell[];
  /** Step 1's robot-side buttons (TASK-430). */
  robotSide: RobotSideButtons;
  /** The step that shows the stop and its Reset E-stop, or null (TASK-431). */
  stopStep: SetupStepId | null;
}

/**
 * Step 1's robot-side buttons (TASK-430). `lead`: the one it leads with, lit
 * while the step is open — Start on a stopped robot side, Restart on one that
 * runs stale code. `stop`: Details offers Stop (secondary), while the robot
 * side can be stopped and a restart is not the remedy.
 */
export interface RobotSideButtons {
  lead: 'start' | 'restart' | null;
  stop: boolean;
}

/** Step 1's buttons from one readiness snapshot. */
export function robotSideButtons(readiness: RobotReadiness | null): RobotSideButtons {
  const a = robotSideActions(readiness);
  return { lead: a.restart ? 'restart' : a.start ? 'start' : null, stop: a.stop && !a.restart };
}

const VR_TYPES: TeleoperationType[] = ['vr_quest', 'vr_vision_pro'];

export const STEP_TITLES: Record<SetupStepId, string> = {
  robot: 'Start the robot side',
  arm_control: 'Switch to arm control',
  stance: 'Stand up and balance',
  quest: 'Connect the Quest',
  operator: 'Operator enters VR',
  input: 'Connect the input',
  control: 'Take control',
};

/** Readiness rows each step shows under Details (the epic's step table). */
const STEP_ROWS: Record<SetupStepId, RowId[]> = {
  robot: ['preflight', 'link', 'bridge', 'sidecar', 'agent', 'hand_left', 'hand_right'],
  arm_control: ['sidecar', 'control'],
  stance: ['mode'],
  quest: ['quest'],
  operator: ['arms'],
  input: [],
  control: ['control'],
};

/** Steps whose failure makes this one wait. Bring-up order, not every earlier step. */
const PREREQUISITES: Record<SetupStepId, SetupStepId[]> = {
  robot: [],
  arm_control: ['robot'],
  stance: ['robot'],
  // TASK-431: a stop fails step 3, and the Quest waits for it as well.
  quest: ['robot', 'stance'],
  operator: ['robot', 'arm_control', 'stance', 'quest'],
  input: [],
  control: ['robot'],
};

const MODE_WORDS: Record<BaseModeName, string> = {
  limp: 'Limp',
  stand: 'Stand',
  balance: 'Balance',
  zero_torque: 'Zero torque',
  other: 'Other',
  unknown: 'Unknown',
};

/** The measured mode in one word, as the step summary and the Mode cell show it. */
export function modeWord(mode: BaseModeName | null): string {
  return mode ? MODE_WORDS[mode] : 'Not measured';
}

/** The step order for a session type. `control` only when the page drives with its own input. */
export function stepOrder(sessionType: TeleoperationType, pageInputs: boolean, leaseEnabled: boolean): SetupStepId[] {
  if (VR_TYPES.includes(sessionType)) return ['robot', 'arm_control', 'stance', 'quest', 'operator'];
  return ['robot', 'input', ...(pageInputs && leaseEnabled ? (['control'] as const) : [])];
}

/** Which step owns the robot's one readiness reason, or null when none shows it. */
export function reasonStep(
  readiness: RobotReadiness | null,
  steps: SetupStepId[],
): SetupStepId | null {
  if (!readiness || readiness.reason.severity === 'ok') return null;
  const code = readiness.reason.code;
  const row = reasonRow(readiness);
  const has = (id: SetupStepId) => steps.includes(id);
  let owner: SetupStepId | null;
  if (code === 'read_only') owner = has('arm_control') ? 'arm_control' : 'robot';
  // TASK-431: a latch blocks standing up, not the operator's hands.
  else if (code === 'estop_latched') owner = has('stance') ? 'stance' : 'robot';
  else if (row === 'control') owner = has('operator') ? 'operator' : has('control') ? 'control' : 'robot';
  else if (row === 'mode') owner = has('stance') ? 'stance' : 'robot';
  else if (row === 'arms') owner = has('operator') ? 'operator' : 'robot';
  else if (row === 'quest') owner = has('quest') ? 'quest' : 'robot';
  else owner = 'robot';
  return owner;
}

/** Which systems cell owns the robot's one readiness reason. */
export function reasonCell(readiness: RobotReadiness | null, vr: boolean): SystemsCellId | null {
  if (!readiness || readiness.reason.severity === 'ok') return null;
  const row = reasonRow(readiness);
  if (!vr) return row === 'control' ? 'control' : 'robot';
  if (readiness.reason.code === 'read_only') return 'arm_control';
  switch (row) {
    case 'control': return 'control';
    case 'mode': return 'mode';
    case 'arms': return 'arms';
    case 'hand_left':
    case 'hand_right': return 'hands';
    case 'quest': return 'headset';
    default: return 'robot';
  }
}

function rowOf(rows: ReadinessRowModel[], id: RowId): ReadinessRowModel | null {
  return rows.find((r) => r.id === id) ?? null;
}

/** A supervisor row (link, bridge) is up when ok or warning. */
function up(row: ReadinessRowModel | null): boolean {
  return row === null || row.status === 'ok' || row.status === 'warn';
}

/** An agent-side row (sidecar, agent) is up unless it fails, starts, or is stopped. */
function notDown(row: ReadinessRowModel | null): boolean {
  return row === null || !(['fail', 'pending', 'idle'] as RowStatus[]).includes(row.status);
}

function handWarning(rows: ReadinessRowModel[]): string | null {
  const notes: string[] = [];
  for (const id of ['hand_right', 'hand_left'] as const) {
    const r = rowOf(rows, id);
    if (r?.status !== 'fail') continue;
    const side = id === 'hand_left' ? 'left' : 'right';
    notes.push(r.value.startsWith('missing') ? `${side} hand missing` : `${side} hand fault`);
  }
  return notes.length ? notes.join(', ') : null;
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The Quest report in a few words, for the step 4 summary. */
function questWords(readiness: RobotReadiness | null, port: number): { text: string; tone: SetupTone; forwarded: boolean } {
  if (!readiness?.quest) {
    return { text: readiness?.bringup ? 'No Quest report' : 'No robot PC report', tone: 'idle', forwarded: false };
  }
  const s = questSummary(readiness.quest, port);
  switch (s.phase) {
    case 'forwarded': return { text: 'Quest connected', tone: 'ok', forwarded: true };
    case 'connected': return { text: 'Quest connected, not forwarded', tone: 'warn', forwarded: false };
    case 'unauthorized': return { text: 'Allow USB debugging in the headset', tone: 'warn', forwarded: false };
    case 'offline': return { text: 'Quest offline to adb', tone: 'warn', forwarded: false };
    case 'no_adb': return { text: 'No adb on the robot PC', tone: 'warn', forwarded: false };
    default: return { text: 'No Quest on USB', tone: 'idle', forwarded: false };
  }
}

interface Facts {
  done: boolean;
  failed: boolean;
  summary: string;
  tone: SetupTone;
  warning?: string | null;
  /** The stop (TASK-431) is what keeps this step from done. */
  stopped?: boolean;
}

/** The mode the agent's readiness measured, when the base-mode poll has none. */
function readinessMode(readiness: RobotReadiness | null): BaseModeName | null {
  const mode = readiness?.agent.readiness?.base?.mode ?? null;
  return mode && mode in MODE_WORDS ? (mode as BaseModeName) : null;
}

/**
 * The sidecar writes the arms: arm_sdk. The legacy MuJoCo sim facade (`sim`
 * and no write mode) has no read-only gate, so it counts as on, as the agent's
 * `explainNotFollowing` treats it. A sidecar that reports read-only never
 * does, sim or not (TASK-431): the supervisor sim runs the real g1_sidecar.py,
 * read-only until the robot side switches to arm control.
 */
export function armControlOn(readiness: RobotReadiness | null): boolean | null {
  const sc = readiness?.agent.readiness?.sidecar ?? null;
  if (sc && sc.reachable) {
    if (sc.readOnly || sc.writeMode === 'read_only') return false;
    if (sc.writeMode === 'arm_sdk') return true;
    return sc.sim && sc.writeMode === null;
  }
  const mode = readiness?.bringup?.sidecarMode ?? null;
  if (mode) return mode === 'arm_sdk';
  return null;
}

/**
 * The legacy MuJoCo sim facade (`sim_node.py`): a sim sidecar with no write
 * mode that no supervisor runs. It has no locomotion FSM, so step 3 has
 * nothing to stand up. The supervisor sim runs the real `g1_sidecar.py`, whose
 * FSM reads once it answers: while the arm-control switch restarts it, the
 * missing reading is "not measured", never "balancing" — or the page handed
 * its lease over to a limp robot the moment arm control came on (TASK-437).
 */
function noLocomotionFsm(readiness: RobotReadiness | null): boolean {
  const sc = readiness?.agent.readiness?.sidecar ?? null;
  return !!sc && sc.sim && sc.writeMode === null && !readiness?.bringup;
}

/** Step 3's facts: the measured mode, and done once it balances (or the sim has nothing to stand up). */
function stanceFacts(
  readiness: RobotReadiness | null,
  rows: ReadinessRowModel[],
  mode: SetupModelInput['mode'],
): Facts {
  const measured = mode.measured ?? readinessMode(readiness);
  const modeRow = rowOf(rows, 'mode');
  // The MuJoCo sim has no locomotion FSM: nothing to stand up.
  if (modeRow?.status === 'idle' && !mode.gateOn && noLocomotionFsm(readiness)) {
    return { done: true, failed: false, summary: capital(modeRow.value), tone: 'ok' };
  }
  const done = measured === 'balance';
  // An unknown mode is attention, never a fault (brand §0.5).
  return { done, failed: false, summary: modeWord(measured), tone: done ? 'ok' : measured ? 'warn' : 'idle' };
}

/**
 * The page's lease has done its work (TASK-427): arm control is on and the
 * robot balances, so steps 2 and 3 are done and the operator is the only one
 * who still needs control. This is when the page hands its lease over. It is
 * read off the robot, never off the headset: the headset reports its operator
 * as in VR only after it holds the lease, so a hand-over waiting for that
 * would never come while the page keeps it.
 */
export function leaseWorkDone(
  readiness: RobotReadiness | null,
  mode: SetupModelInput['mode'],
  questPort = 1420,
): boolean {
  if (!readiness || !armControlOn(readiness)) return false;
  return stanceFacts(readiness, readinessRows(readiness, questPort), mode).done;
}

export function buildSetupModel(input: SetupModelInput): SetupModel {
  const { readiness, preflight, lease, operator } = input;
  const vr = VR_TYPES.includes(input.sessionType);
  const port = input.questPort ?? 1420;
  const rows = readiness ? readinessRows(readiness, port) : [];
  const order = stepOrder(input.sessionType, lease.pageInputs, lease.enabled);
  const item = (id: PreflightItem['id']) => preflight.find((p) => p.id === id) ?? null;
  const robotItem = item('robot');
  const recorderItem = item('recorder');
  const stop = input.stop ?? null;
  // A latched readiness reason only repeats the stop, which says it with its cause.
  const owner = stop && readiness?.reason.code === 'estop_latched' ? null : reasonStep(readiness, order);
  const bringup = readiness?.bringup ?? null;
  const holderText = lease.bound ? 'You have control' : lease.holder ? `${lease.holder} has control` : 'Nobody has control';

  const facts = (id: SetupStepId): Facts => {
    switch (id) {
      case 'robot': {
        const offline = robotItem?.level === 'blocking';
        const link = rowOf(rows, 'link');
        const bridge = rowOf(rows, 'bridge');
        const sidecar = rowOf(rows, 'sidecar');
        const agent = rowOf(rows, 'agent');
        const pre = rowOf(rows, 'preflight');
        const live = recorderItem?.level === 'ok';
        const done = !offline && robotItem?.level === 'ok' && live
          && up(pre) && up(link) && up(bridge) && notDown(sidecar) && notDown(agent);
        const failing = [pre, link, bridge, sidecar, agent].find((r) => r?.status === 'fail') ?? null;
        const failed = offline || failing !== null;
        const warning = handWarning(rows);
        // Without a step 3 (a non-VR session), a stop blocks a running robot side.
        if (done && stop && !order.includes('stance')) {
          return { done: false, failed: true, summary: stop.short, tone: 'fail', warning, stopped: true };
        }
        if (done) {
          return { done, failed: false, summary: warning ? `Running; ${warning}` : 'Running, robot state live', tone: warning ? 'warn' : 'ok', warning };
        }
        if (offline) return { done, failed, summary: `${input.robotName} is offline`, tone: 'fail' };
        if (failing) return { done, failed, summary: `${failing.label}: ${failing.value}`, tone: 'fail' };
        if (bringup?.overall === 'stopped') return { done, failed, summary: 'Robot side stopped', tone: 'warn' };
        if (bringup?.overall === 'stopping') return { done, failed, summary: 'Stopping the robot side…', tone: 'warn' };
        if (bringup?.overall === 'starting' || [link, bridge, sidecar, agent].some((r) => r?.status === 'pending')) {
          return { done, failed, summary: 'Starting the robot side…', tone: 'warn' };
        }
        if (!live) return { done, failed, summary: 'No live robot state yet', tone: 'warn' };
        return { done, failed, summary: 'Robot side not ready', tone: 'warn' };
      }
      case 'arm_control': {
        const on = armControlOn(readiness);
        const sidecar = rowOf(rows, 'sidecar');
        if (on) return { done: true, failed: false, summary: 'Arm control on', tone: 'ok' };
        return { done: false, failed: sidecar?.status === 'fail', summary: holderText, tone: lease.bound ? 'ok' : 'warn' };
      }
      case 'stance':
        // The robot was damped by the stop: nothing stands up until it is reset.
        if (stop) return { done: false, failed: true, summary: stop.short, tone: 'fail', stopped: true };
        return stanceFacts(readiness, rows, input.mode);
      case 'quest': {
        const q = questWords(readiness, port);
        const done = q.forwarded || operator.present;
        return { done, failed: false, summary: done && !q.forwarded ? 'Operator already in the session' : q.text, tone: done ? 'ok' : q.tone };
      }
      case 'operator': {
        const name = operator.name ?? 'The operator';
        const holds = !lease.enabled || (lease.holder !== null && !lease.bound);
        const done = operator.present && operator.inVr && holds;
        if (done) return { done, failed: false, summary: `${name} is in VR`, tone: 'ok' };
        if (!operator.present) return { done, failed: false, summary: 'Waiting for the headset', tone: 'idle' };
        if (!operator.inVr) return { done, failed: false, summary: `${name} is in the session, not in VR yet`, tone: 'warn' };
        return { done, failed: false, summary: `${name} is in VR, without control`, tone: 'warn' };
      }
      case 'input': {
        const it = item('input');
        const done = it?.level === 'ok';
        return { done, failed: false, summary: it?.detail.replace(/\.$/, '') ?? 'Input not checked', tone: done ? 'ok' : it?.level === 'checking' ? 'idle' : 'warn' };
      }
      case 'control': {
        if (lease.bound) return { done: true, failed: false, summary: 'You have control', tone: 'ok' };
        return { done: false, failed: false, summary: holderText, tone: 'warn' };
      }
    }
  };

  const raw = order.map((id) => ({ id, ...facts(id) }));
  const byId = new Map(raw.map((r) => [r.id, r]));
  const current = raw.find((r) => !r.done)?.id ?? null;
  const reason: SetupReason | null = readiness && owner
    ? { code: readiness.reason.code, text: readiness.reason.text, severity: readiness.reason.severity }
    : null;
  // The stop's own line, in the step it blocks (only while it blocks one).
  const stopStep: SetupStepId | null = raw.find((r) => r.stopped)?.id ?? null;
  const stopReason: SetupReason | null = stop ? { code: stop.code, text: stop.title, severity: 'block' } : null;

  // A failed step: its own facts, or a blocking reason it owns that is not just the next thing to do.
  const failed = (id: SetupStepId): boolean => {
    const f = byId.get(id);
    return !!f && !f.done && f.failed;
  };
  const waitsOn = (id: SetupStepId, seen = new Set<SetupStepId>()): SetupStepId | null => {
    for (const p of PREREQUISITES[id]) {
      if (!byId.has(p) || seen.has(p)) continue;
      if (failed(p)) return p;
      seen.add(p);
      const deeper = waitsOn(p, seen);
      if (deeper) return deeper;
    }
    return null;
  };

  const steps: SetupStep[] = raw.map((r, i) => {
    const n = i + 1;
    const blocker = r.done || r.id === current ? null : waitsOn(r.id);
    const state: SetupStepState = r.done
      ? 'done'
      : r.id === current
        ? 'current'
        : blocker
          ? 'waits'
          : r.failed
            ? 'fault'
            : 'open';
    const waitsFor = blocker ? order.indexOf(blocker) + 1 : null;
    return {
      id: r.id,
      n,
      title: STEP_TITLES[r.id],
      state,
      summary: state === 'waits' ? `Waits for step ${waitsFor}` : r.summary,
      tone: state === 'waits' ? 'idle' : r.tone,
      // A waiting step never repeats the upstream error. The stop outranks the
      // readiness reason in the step it blocks.
      reason: state === 'waits' ? null : stopStep === r.id ? stopReason : owner === r.id ? reason : null,
      warning: r.warning ?? null,
      rows: STEP_ROWS[r.id].filter((row) => rows.some((x) => x.id === row)),
      waitsFor,
    };
  });

  const doneCount = steps.filter((s) => s.state === 'done').length;
  const allDone = steps.length > 0 && doneCount === steps.length;
  return {
    steps,
    current,
    doneCount,
    allDone,
    foldedSummary: foldedLine(steps, input),
    cells: buildCells(input, rows, readiness, vr, byId as Map<SetupStepId, Facts & { id: SetupStepId }>),
    robotSide: robotSideButtons(readiness),
    stopStep,
  };
}

/** "Robot ready, arm control on, balancing, Anna in VR". */
function foldedLine(steps: SetupStep[], input: SetupModelInput): string {
  const parts = steps.map((s) => {
    switch (s.id) {
      case 'robot': return 'Robot ready';
      case 'arm_control': return 'arm control on';
      case 'stance': return input.mode.measured === 'balance' ? 'balancing' : s.summary.toLowerCase();
      case 'quest': return null;
      case 'operator': return `${input.operator.name ?? 'the operator'} in VR`;
      case 'input': return s.summary.toLowerCase();
      case 'control': return 'you have control';
    }
  });
  return parts.filter(Boolean).join(', ');
}

function buildCells(
  input: SetupModelInput,
  rows: ReadinessRowModel[],
  readiness: RobotReadiness | null,
  vr: boolean,
  facts: Map<SetupStepId, Facts & { id: SetupStepId }>,
): SystemsCell[] {
  const owner = reasonCell(readiness, vr);
  const reason: SetupReason | null = readiness && owner
    ? { code: readiness.reason.code, text: readiness.reason.text, severity: readiness.reason.severity }
    : null;
  const cell = (id: SystemsCellId, label: string, value: string, status: SystemsCellStatus): SystemsCell =>
    ({ id, label, value, status, reason: owner === id ? reason : null });
  const { lease, operator } = input;

  const robot = facts.get('robot')!;
  const robotCell = cell('robot', 'Robot side', robot.done ? 'Running' : robot.summary, robot.done ? 'ok' : robot.failed ? 'fail' : 'warn');
  const controlCell = cell(
    'control',
    'Control',
    lease.bound ? 'You' : lease.holder ?? (lease.enabled ? 'Nobody' : 'Leases off'),
    lease.bound || lease.holder ? 'ok' : lease.enabled ? 'warn' : 'idle',
  );

  const cams = camerasCell(input);
  const withCameras = (cells: SystemsCell[]): SystemsCell[] => (cams ? [...cells, cams] : cells);

  if (!vr) {
    const inp = facts.get('input')!;
    return withCameras([robotCell, controlCell, cell('input', 'Input', inp.summary, inp.tone)]);
  }

  const arm = armControlOn(readiness);
  const measured = input.mode.measured ?? readinessMode(readiness);
  const modeRow = rowOf(rows, 'mode');
  const modeCell = modeRow?.status === 'idle' && !input.mode.gateOn
    ? cell('mode', 'Mode', capital(modeRow.value), 'idle')
    : cell('mode', 'Mode', modeWord(measured), measured === 'balance' ? 'ok' : measured ? 'warn' : 'idle');

  const headset = operator.present
    ? operator.inVr ? cell('headset', 'Headset', 'In VR', 'ok') : cell('headset', 'Headset', 'Not in VR', 'warn')
    : cell('headset', 'Headset', 'No headset', 'idle');

  const a = readiness?.agent.readiness?.arms ?? null;
  const armsRow = rowOf(rows, 'arms');
  const arms = !a
    ? cell('arms', 'Arms', '—', 'idle')
    : a.estopLatched || a.sidecarEstopLatched
      ? cell('arms', 'Arms', 'E-stop latched', 'fail')
      : a.armed && a.deadman !== 'hold'
        ? cell('arms', 'Arms', 'Following', 'ok')
        : cell('arms', 'Arms', a.arming ? 'Arming' : a.deadman === 'hold' ? 'Dead-man held' : 'Not armed', armsRow?.status === 'fail' ? 'fail' : 'warn');

  const hand = (id: 'hand_left' | 'hand_right') => rowOf(rows, id);
  const lost = (['hand_right', 'hand_left'] as const).filter((id) => hand(id)?.status === 'fail');
  const reported = hand('hand_left')?.status === 'ok' || hand('hand_right')?.status === 'ok';
  const hands = lost.length > 0
    ? cell('hands', 'Hands', lost.map((id) => `${id === 'hand_left' ? 'Left' : 'Right'} ${hand(id)!.value.startsWith('missing') ? 'lost' : 'fault'}`).join(', '), 'fail')
    : reported
      ? cell('hands', 'Hands', 'Both ok', 'ok')
      : cell('hands', 'Hands', 'Not reported', 'idle');

  return withCameras([
    robotCell,
    controlCell,
    cell('arm_control', 'Arm control', arm ? 'On' : arm === false ? 'Read-only' : '—', arm ? 'ok' : arm === false ? 'warn' : 'idle'),
    modeCell,
    headset,
    arms,
    hands,
  ]);
}

const CAMERA_STATUS: Record<PreflightItem['level'], SystemsCellStatus> = {
  ok: 'ok', warning: 'warn', blocking: 'fail', checking: 'idle', unknown: 'idle',
};

/**
 * The session's camera set (TASK-442), only for a session with a camera list.
 * Its dot follows the wrist cameras when the session records any, else the
 * camera check; a wrist the robot does not serve owns a blocking reason.
 */
function camerasCell(input: SetupModelInput): SystemsCell | null {
  const list = input.sessionCameras;
  if (!list || list.length === 0) return null;
  const wrists = input.preflight.find((p) => p.id === 'wrist_cameras') ?? null;
  const check = wrists ?? input.preflight.find((p) => p.id === 'camera') ?? null;
  const blocked = wrists?.level === 'blocking';
  return {
    id: 'cameras',
    label: 'Cameras',
    // Eight cells share one row from 1440 px: the cell says how many, its title which.
    value: blocked ? wrists.detail : cameraCountLabel(list),
    ...(blocked ? {} : { title: cameraSetLabel(list) }),
    status: check ? CAMERA_STATUS[check.level] : 'idle',
    reason: blocked ? { code: 'wrist_camera_offline', text: wrists.action ?? wrists.detail, severity: 'block' } : null,
  };
}
