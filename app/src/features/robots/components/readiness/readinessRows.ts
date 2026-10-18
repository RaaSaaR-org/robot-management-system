/**
 * @file readinessRows.ts
 * @description The readiness checklist as data (TASK-411): one row per thing
 *              that has to be up for the arms to follow — link, bridge,
 *              sidecar, agent, robot mode, arms, each hand, camera, control,
 *              Quest — derived from the merged `RobotReadiness`, plus which row
 *              the one reason line is about. Pure, so the panel and its tests
 *              read the same verdicts.
 * @feature robots
 */

import type {
  AgentReadiness,
  BringupStep,
  BringupStepId,
  HandHealth,
  QuestDevice,
  QuestReport,
  RobotReadiness,
} from '../../api/readinessApi';
import { staleCodeOf } from '../../api/readinessApi';

export type RowId =
  | 'preflight'
  | 'link'
  | 'bridge'
  | 'sidecar'
  | 'agent'
  | 'mode'
  | 'arms'
  | 'hand_left'
  | 'hand_right'
  | 'camera'
  | 'control'
  | 'quest';

export type RowStatus = 'ok' | 'warn' | 'fail' | 'pending' | 'idle' | 'unknown';

export interface ReadinessRowModel {
  id: RowId;
  label: string;
  status: RowStatus;
  /** One short value, always visible. */
  value: string;
  /** The longer explanation, on hover or expand. */
  detail: string | null;
  /** True when the row comes from the supervisor (hidden without one). */
  bringup: boolean;
  /** The supervisor step behind the row, for foreign processes and spinners. */
  step: BringupStep | null;
}

const STEP_STATUS: Record<BringupStep['state'], RowStatus> = {
  idle: 'idle',
  running: 'pending',
  ok: 'ok',
  warn: 'warn',
  failed: 'fail',
  foreign: 'fail',
};

/** A row needs the operator's attention (the compact variant shows only these). */
export function isFailing(row: ReadinessRowModel): boolean {
  return row.status === 'fail' || row.status === 'warn' || row.status === 'pending';
}

function stepOf(readiness: RobotReadiness, id: BringupStepId): BringupStep | null {
  return readiness.bringup?.steps.find((s) => s.id === id) ?? null;
}

function yes(v: unknown): boolean {
  return v === true;
}

function seconds(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  return v < 10 ? `${v.toFixed(2)} s` : `${Math.round(v)} s`;
}

/** `left_elbow_joint` → `left_elbow`. */
function shortJoint(name: string): string {
  return name.replace(/_joint$/, '');
}

/** Each fault as `thumb_1 0x200`. */
export function handFaultText(hand: HandHealth): string {
  return hand.motorFaults.map((f) => `${shortJoint(f.joint)} ${f.code}`).join(', ');
}

function stepFallbackDetail(step: BringupStep): string | null {
  if (step.state === 'foreign' && step.foreign) {
    return `pid ${step.foreign.pid ?? '?'} holds port ${step.foreign.port}`;
  }
  return step.detail;
}

/** "2026-10-17 17:21" in local time. */
export function shortDateTime(iso: string | null | undefined): string {
  if (!iso) return 'an unknown time';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * A process that runs older code than this checkout (TASK-419) fails its row,
 * whatever else it reports: the day must not run on yesterday's code.
 */
function markStale(row: ReadinessRowModel): ReadinessRowModel {
  const stale = staleCodeOf(row.step);
  if (!stale) return row;
  return {
    ...row,
    status: 'fail',
    value: `runs code from before ${shortDateTime(stale.codeAt)}`,
    detail: row.step?.state === 'foreign'
      ? `Started ${shortDateTime(stale.startedAt)}, before the code it should run changed. Stop it, then press Start.`
      : `Started ${shortDateTime(stale.startedAt)}, before the code it runs changed. Stop and Start the robot side.`,
  };
}

function linkRow(r: RobotReadiness): ReadinessRowModel | null {
  const step = stepOf(r, 'link');
  if (!r.bringup || !step) return null;
  const sim = r.bringup.robot === 'sim';
  const c = step.checks;
  let value: string;
  if (sim) {
    value = step.state === 'ok' ? 'simulator up' : step.state === 'idle' ? 'stopped' : step.state;
  } else if (step.state === 'idle') {
    value = 'stopped';
  } else {
    const parts = [
      `carrier ${'carrier' in c ? (yes(c.carrier) ? 'up' : 'down') : '—'}`,
      `IP ${'hostIp' in c ? (yes(c.hostIp) ? 'set' : 'missing') : '—'}`,
      `ping ${'ping' in c ? (yes(c.ping) ? 'ok' : 'no answer') : '—'}`,
    ];
    value = parts.join(' · ');
  }
  return {
    id: 'link',
    label: sim ? 'Simulator' : 'Robot LAN',
    status: STEP_STATUS[step.state],
    value,
    detail: stepFallbackDetail(step),
    bringup: true,
    step,
  };
}

function preflightRow(r: RobotReadiness): ReadinessRowModel | null {
  const step = stepOf(r, 'preflight');
  if (!r.bringup || !step) return null;
  // Only worth a row when it says something.
  if (step.state === 'ok' || step.state === 'idle') return null;
  return {
    id: 'preflight',
    label: 'Preflight',
    status: STEP_STATUS[step.state],
    value: step.code ?? step.state,
    detail: stepFallbackDetail(step),
    bringup: true,
    step,
  };
}

function bridgeRow(r: RobotReadiness): ReadinessRowModel | null {
  const step = stepOf(r, 'bridge');
  if (!r.bringup || !step) return null;
  const c = step.checks;
  let value: string;
  if (step.state === 'idle') value = 'stopped';
  else if ('lowstate' in c) {
    const dex = [yes(c.dex3Left) ? 'L' : null, yes(c.dex3Right) ? 'R' : null].filter(Boolean).join('+');
    value = `lowstate ${yes(c.lowstate) ? 'seen' : 'missing'} · Dex3 ${dex || 'not seen'}`;
  } else value = step.state;
  return {
    id: 'bridge',
    label: 'State bridge',
    status: STEP_STATUS[step.state],
    value,
    detail: stepFallbackDetail(step),
    bringup: true,
    step,
  };
}

function sidecarRow(r: RobotReadiness, a: AgentReadiness | null): ReadinessRowModel {
  const step = stepOf(r, 'sidecar');
  const sc = a?.sidecar;
  // The supervisor's own step wins while it is not ok: it knows the process.
  if (step && step.state !== 'ok' && step.state !== 'warn') {
    return {
      id: 'sidecar',
      label: 'Sidecar',
      status: STEP_STATUS[step.state],
      value: step.state === 'idle' ? 'stopped' : step.code ?? step.state,
      detail: stepFallbackDetail(step),
      bringup: false,
      step,
    };
  }
  if (!sc) {
    return {
      id: 'sidecar',
      label: 'Sidecar',
      status: step ? STEP_STATUS[step.state] : 'unknown',
      value: step ? r.bringup?.sidecarMode?.replace('_', '-') ?? step.state : 'unknown',
      detail: step?.detail ?? 'the agent sent no readiness report',
      bringup: false,
      step,
    };
  }
  const mode = sc.writeMode ? sc.writeMode.replace('_', '-') : sc.sim ? 'sim' : 'no write mode';
  const status: RowStatus = !sc.reachable || !sc.connected ? 'fail' : sc.readOnly && !sc.sim ? 'warn' : 'ok';
  const value = !sc.reachable
    ? 'not reachable'
    : `${mode} · lowstate ${seconds(sc.lowstateAgeS)}${sc.connected ? '' : ' (no robot state)'}`;
  return {
    id: 'sidecar',
    label: 'Sidecar',
    status,
    value,
    detail: [sc.url ? `sidecar ${sc.url}` : null, sc.stale ? 'values are from before the sidecar went away' : null, step?.detail ?? null]
      .filter(Boolean)
      .join(' — ') || null,
    bringup: false,
    step,
  };
}

function agentRow(r: RobotReadiness, a: AgentReadiness | null): ReadinessRowModel {
  const step = stepOf(r, 'agent');
  // A foreign agent may well answer (an old one does): its row is the process.
  const foreign = step?.state === 'foreign';
  if (step && (foreign || ((step.state === 'running' || step.state === 'failed' || step.state === 'idle') && !r.agent.reachable))) {
    return {
      id: 'agent',
      label: 'Agent',
      status: STEP_STATUS[step.state],
      value: step.state === 'idle' ? 'stopped' : step.code ?? step.state,
      detail: stepFallbackDetail(step),
      bringup: false,
      step,
    };
  }
  if (!r.agent.reachable) {
    return {
      id: 'agent', label: 'Agent', status: 'fail', value: 'not answering', detail: r.agent.error, bringup: false, step,
    };
  }
  if (!a && r.agent.outdated) {
    return {
      id: 'agent',
      label: 'Agent',
      status: 'fail',
      value: 'older code than NeoDEM',
      detail: 'The agent answers, but has no readiness route: it runs code from before this NeoDEM. Stop and Start the robot side.',
      bringup: false,
      step,
    };
  }
  if (!a) {
    return {
      id: 'agent', label: 'Agent', status: 'warn', value: 'no readiness report', detail: r.agent.error, bringup: false, step,
    };
  }
  return {
    id: 'agent',
    label: 'Agent',
    status: a.telemetrySynthetic ? 'warn' : 'ok',
    value: a.telemetrySynthetic ? 'reachable · battery/IMU simulated' : 'reachable',
    detail: a.telemetrySynthetic
      ? 'The agent fills battery and IMU with simulated values — they are not the robot\'s.'
      : step?.detail ?? null,
    bringup: false,
    step,
  };
}

const MODE_WORDS: Record<string, string> = {
  limp: 'limp',
  stand: 'stand',
  balance: 'balance',
  zero_torque: 'zero torque',
  other: 'other',
  unknown: 'unknown',
};

function modeRow(a: AgentReadiness | null): ReadinessRowModel {
  const base = a?.base ?? null;
  if (!a) return { id: 'mode', label: 'Robot mode', status: 'unknown', value: '—', detail: null, bringup: false, step: null };
  if (!base) {
    return {
      id: 'mode',
      label: 'Robot mode',
      status: a.sidecar.sim ? 'idle' : 'unknown',
      value: a.sidecar.sim ? 'not measured (sim)' : 'no reading',
      detail: a.sidecar.sim ? 'The MuJoCo sim has no locomotion FSM to read.' : null,
      bringup: false,
      step: null,
    };
  }
  const words = MODE_WORDS[base.mode] ?? base.mode;
  const status: RowStatus = base.mode === 'balance' && !base.stale ? 'ok' : base.mode === 'unknown' ? 'fail' : 'warn';
  return {
    id: 'mode',
    label: 'Robot mode',
    status,
    value: `${words}${base.fsmId !== null && base.mode === 'other' ? ` (${base.fsmId})` : ''} · measured ${seconds(base.ageS)} ago`,
    detail: base.error ?? (base.stale ? 'the reading is stale' : null),
    bringup: false,
    step: null,
  };
}

const DISARM_WORDS: Record<string, string> = {
  tracking_error: 'tracking error',
  left_balance: 'left balance',
  deadman: 'dead-man',
  stale_state: 'stale state',
  fsm_stale: 'stale mode reading',
  estop: 'E-stop',
};

function armsRow(a: AgentReadiness | null): ReadinessRowModel {
  if (!a) return { id: 'arms', label: 'Arms', status: 'unknown', value: '—', detail: null, bringup: false, step: null };
  const arms = a.arms;
  const parts: string[] = [];
  parts.push(arms.armed ? `armed ${Math.round(arms.armWeight * 100)}%` : arms.arming ? 'arming' : 'not armed');
  if (arms.deadman) parts.push(`dead-man ${arms.deadman}`);
  if (arms.estopLatched || arms.sidecarEstopLatched) parts.push('E-stop latched');
  const details: string[] = [];
  if (arms.lastDisarmReason) {
    details.push(`last disarm: ${DISARM_WORDS[arms.lastDisarmReason] ?? arms.lastDisarmReason.replace(/_/g, ' ')}`);
  }
  if (arms.trackErrRad !== null) {
    details.push(`tracking error ${arms.trackErrRad.toFixed(2)} rad${arms.trackErrJoint ? ` on ${shortJoint(arms.trackErrJoint)}` : ''}`);
  }
  if (arms.lastError) details.push(arms.lastError);
  const status: RowStatus = arms.estopLatched || arms.sidecarEstopLatched
    ? 'fail'
    : arms.armed && arms.deadman !== 'hold'
      ? 'ok'
      : 'warn';
  return {
    id: 'arms',
    label: 'Arms',
    status,
    value: [...parts, ...(arms.lastDisarmReason ? [details[0]] : [])].join(' · '),
    detail: details.join(' — ') || null,
    bringup: false,
    step: null,
  };
}

function handRow(a: AgentReadiness | null, side: 'left' | 'right'): ReadinessRowModel {
  const id: RowId = side === 'left' ? 'hand_left' : 'hand_right';
  const label = side === 'left' ? 'Left hand' : 'Right hand';
  const hand = a?.hands?.[side] ?? null;
  if (!hand) {
    return {
      id, label, status: 'unknown', value: a ? 'not reported' : '—',
      detail: a ? 'the sidecar does not report Dex3 hand health' : null, bringup: false, step: null,
    };
  }
  if (hand.present === false) {
    return {
      id, label, status: 'fail', value: `missing · last ${seconds(hand.ageS)} ago`,
      detail: 'No hand state within the sidecar\'s freshness window: cable or hand power.', bringup: false, step: null,
    };
  }
  if (hand.motorFaults.length > 0) {
    return {
      id, label, status: 'fail', value: handFaultText(hand),
      detail: hand.motorFaults.map((f) => `${shortJoint(f.joint)} ${f.code}${f.bits.length ? ` (${f.bits.join(', ')})` : ''}`).join('; '),
      bringup: false, step: null,
    };
  }
  return {
    id, label,
    status: hand.present ? 'ok' : 'unknown',
    value: `${hand.present ? 'present' : 'unknown'} · ${seconds(hand.ageS)}${hand.powerV !== null && hand.powerV > 0 ? ` · ${hand.powerV.toFixed(1)} V` : ''}`,
    detail: null, bringup: false, step: null,
  };
}

function cameraRow(r: RobotReadiness, a: AgentReadiness | null): ReadinessRowModel {
  const step = stepOf(r, 'camera');
  const cam = a?.camera ?? null;
  if (!cam) {
    return {
      id: 'camera', label: 'Head camera', status: step ? STEP_STATUS[step.state] : 'unknown',
      value: step?.state === 'idle' ? 'stopped' : '—', detail: step?.detail ?? null, bringup: false, step,
    };
  }
  const has = cam.cameras.length > 0 || cam.source !== null;
  return {
    id: 'camera',
    label: 'Head camera',
    status: has ? (step?.state === 'warn' ? 'warn' : 'ok') : 'warn',
    value: has ? `${cam.source ?? 'source unknown'} · ${cam.cameras.length} camera${cam.cameras.length === 1 ? '' : 's'}` : 'no camera',
    detail: cam.detail ?? step?.detail ?? null,
    bringup: false,
    step,
  };
}

function controlRow(a: AgentReadiness | null): ReadinessRowModel {
  if (!a) return { id: 'control', label: 'Control', status: 'unknown', value: '—', detail: null, bringup: false, step: null };
  const l = a.lease;
  const holder = l.holder?.displayName ?? l.holder?.userId ?? null;
  if (l.bound > 1) {
    return {
      id: 'control', label: 'Control', status: 'warn',
      value: `${holder ?? 'held'} · ${l.bound} sockets bound`,
      detail: 'More than one control socket is bound to the lease — close the other tab or headset.',
      bringup: false, step: null,
    };
  }
  if (l.state === 'held') {
    return { id: 'control', label: 'Control', status: 'ok', value: holder ?? 'held', detail: null, bringup: false, step: null };
  }
  return {
    id: 'control',
    label: 'Control',
    status: l.enforced ? 'warn' : 'idle',
    value: l.enforced ? 'nobody has control' : 'leases off',
    detail: l.enforced ? 'Take control in the Teleop tab or the VR window.' : 'Control leases are not required on this robot.',
    bringup: false,
    step: null,
  };
}

export type QuestPhase = 'no_adb' | 'none' | 'unauthorized' | 'offline' | 'connected' | 'forwarded';

export interface QuestSummary {
  phase: QuestPhase;
  /** The headset Connect and Open act on (state `device`), else the first one listed. */
  device: QuestDevice | null;
  /** The page port is reversed on that headset. */
  forwarded: boolean;
  /** One line: "Quest 3 (serial 2G0Y…) connected", "No headset on USB", … */
  text: string;
  /** What to do next; null when nothing. */
  hint: string | null;
}

/** The serial shortened for one line: `2G0YC5ZG8X0123` → `2G0Y…0123`. */
export function shortSerial(serial: string): string {
  return serial.length > 10 ? `${serial.slice(0, 4)}…${serial.slice(-4)}` : serial;
}

/** The Quest report in the words the operator reads (TASK-412). Pure. */
export function questSummary(q: QuestReport, port = 1420): QuestSummary {
  const ready = q.devices.filter((d) => d.state === 'device');
  const device = ready.find((d) => /quest/i.test(d.model ?? '')) ?? ready[0] ?? q.devices[0] ?? null;
  const name = device?.model ?? 'Headset';
  const forwarded = device?.state === 'device' && q.reversed.some((r) => r.remote === `tcp:${port}`);
  if (!q.adb) return { phase: 'no_adb', device: null, forwarded: false, text: 'adb not found on the robot PC', hint: q.hint };
  if (!device) return { phase: 'none', device: null, forwarded: false, text: 'No headset on USB', hint: q.hint };
  if (device.state === 'unauthorized') {
    return { phase: 'unauthorized', device, forwarded: false, text: 'Put on the headset and allow USB debugging', hint: q.hint };
  }
  if (device.state === 'offline') {
    return { phase: 'offline', device, forwarded: false, text: `${name} is offline to adb — replug the cable`, hint: q.hint };
  }
  const base = `${name} (serial ${shortSerial(device.serial)}) connected`;
  return forwarded
    ? { phase: 'forwarded', device, forwarded, text: `${base} · port ${port} forwarded`, hint: null }
    : { phase: 'connected', device, forwarded, text: base, hint: `Press Connect to forward port ${port}.` };
}

const QUEST_ROW_STATUS: Record<QuestPhase, RowStatus> = {
  no_adb: 'unknown',
  none: 'idle',
  unauthorized: 'warn',
  offline: 'warn',
  connected: 'idle',
  forwarded: 'ok',
};

/** The Quest row, from the supervisor's report. Display-only: it never changes the reason. */
function questRow(r: RobotReadiness, port: number): ReadinessRowModel | null {
  const q = r.quest;
  if (!q) {
    // A supervisor that answered but sent no Quest report: either it predates
    // TASK-412, or its last `/quest` read failed or timed out (adb hiccup). The
    // two look the same from here, so the row claims neither.
    if (!r.bringup) return null;
    return {
      id: 'quest', label: 'Quest', status: 'unknown', value: 'no report from the supervisor',
      detail: 'Its last Quest read failed or timed out, or this supervisor has no Quest support.',
      bringup: true, step: null,
    };
  }
  const s = questSummary(q, port);
  return {
    id: 'quest',
    label: 'Quest',
    status: QUEST_ROW_STATUS[s.phase],
    value: s.phase === 'connected' ? `${s.text} · port ${port} not forwarded` : s.text,
    detail: s.hint,
    bringup: true,
    step: null,
  };
}

/** The checklist, in display order. Supervisor rows are absent without a supervisor. */
export function readinessRows(r: RobotReadiness, questPort = 1420): ReadinessRowModel[] {
  const a = r.agent.readiness;
  const rows: Array<ReadinessRowModel | null> = [
    preflightRow(r),
    linkRow(r),
    ...[bridgeRow(r), sidecarRow(r, a), agentRow(r, a)].map((row) => (row ? markStale(row) : null)),
    modeRow(a),
    armsRow(a),
    handRow(a, 'left'),
    handRow(a, 'right'),
    cameraRow(r, a),
    controlRow(a),
    questRow(r, questPort),
  ];
  return rows.filter((x): x is ReadinessRowModel => x !== null);
}

const STEP_ROW: Record<BringupStepId, RowId> = {
  preflight: 'preflight',
  link: 'link',
  camera: 'camera',
  bridge: 'bridge',
  sidecar: 'sidecar',
  agent: 'agent',
};

const AGENT_ROW: Record<string, RowId> = {
  sidecar_unreachable: 'sidecar',
  no_lowstate: 'sidecar',
  read_only: 'sidecar',
  estop_latched: 'arms',
  mode_unknown: 'mode',
  mode_not_balance: 'mode',
  lease_none: 'control',
  lease_duplicate: 'control',
  disarmed_reason: 'arms',
  arming: 'arms',
  deadman_hold: 'arms',
  not_engaged: 'arms',
};

/** The row the reason line is about, or null (`following`, unknown codes). */
export function reasonRow(r: RobotReadiness): RowId | null {
  const code = r.reason.code;
  const [head, tail] = code.split(':');
  if ((head === 'bringup_failed' || head === 'bringup_foreign') && tail) {
    return STEP_ROW[tail as BringupStepId] ?? null;
  }
  if (code === 'bringup_stopped') return r.bringup ? 'link' : null;
  if (code === 'bringup_busy') {
    const running = r.bringup?.steps.find((s) => s.state === 'running');
    return running ? STEP_ROW[running.id] : null;
  }
  if (code === 'agent_outdated') {
    const stale = r.bringup?.steps.find((s) => staleCodeOf(s) !== null);
    return stale ? STEP_ROW[stale.id] : 'agent';
  }
  if (code === 'supervisor_unreachable' || code === 'agent_unreachable' || code === 'agent_no_readiness') return 'agent';
  if (code === 'hand_missing' || code === 'hand_fault') {
    const hands = r.agent.readiness?.hands;
    // The agent names the right hand first (it is the one that faults on the G1 EDU).
    for (const side of ['right', 'left'] as const) {
      const h = hands?.[side];
      if (!h) continue;
      if (code === 'hand_missing' ? h.present === false : h.motorFaults.length > 0) {
        return side === 'left' ? 'hand_left' : 'hand_right';
      }
    }
    return /left/i.test(r.reason.text) ? 'hand_left' : 'hand_right';
  }
  return AGENT_ROW[code] ?? null;
}
