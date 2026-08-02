/**
 * @file heartbeat.test.ts
 * @description TASK-199's safety properties, asserted structurally: each tier-0
 *              predicate fires only on its own condition, the two pose
 *              predicates disagree about UNKNOWN in the right directions, the
 *              rate limiter and the active-hours window suppress, and every
 *              error path ends the tick with the robot holding.
 * @feature agentmode
 * @status test
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  buildHeartbeatPlan,
  evaluateHeartbeat,
  filterHeartbeatBlocks,
  HEARTBEAT_ALLOWED_KINDS,
  HEARTBEAT_OK,
  HeartbeatMonitor,
  isPlaceLost,
  parseActiveHours,
  poseAllowsSelfAction,
  protectiveStopRequired,
  selfActionAllowed,
  withinActiveHours,
  type HeartbeatDurations,
  type HeartbeatFinding,
  type HeartbeatSettings,
  type HeartbeatSnapshot,
} from '../heartbeat.js';
import type { PlannedBlock } from '../planner.js';
import type { JournalRecord } from '../workspace.js';

const NOW = Date.parse('2026-08-02T10:00:00.000Z');
const MINUTE = 60_000;

/** A robot with nothing whatsoever wrong with it. */
function snap(over: Partial<HeartbeatSnapshot> = {}): HeartbeatSnapshot {
  return {
    nowMs: NOW,
    crashAcknowledged: true,
    estopLatched: false,
    batteryPercent: 90,
    damped: false,
    pose: { poseKnown: true, insideKeepout: false },
    placeConfigured: true,
    place: 'AISLE-3',
    placeConfidence: 'confident',
    placeAgeMs: 100,
    personVisible: true,
    view: 'a person and a table',
    lastPlanFailedAtMs: null,
    lastOperatorTurnAtMs: null,
    workspaceWriteFailedAtMs: null,
    workspaceWriteError: null,
    ...over,
  };
}

const NO_DURATIONS: HeartbeatDurations = { dampedSinceMs: null, placeLostSinceMs: null };

function ids(findings: readonly HeartbeatFinding[]): string[] {
  return findings.map((f) => f.id);
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ============================================================================
// TIER 0 — one predicate, one condition
// ============================================================================

describe('evaluateHeartbeat — tier-0 predicates', () => {
  it('finds nothing at all when nothing is wrong', () => {
    expect(evaluateHeartbeat(snap(), NO_DURATIONS)).toEqual([]);
  });

  it('battery_low fires below the threshold and only below it', () => {
    expect(ids(evaluateHeartbeat(snap({ batteryPercent: 18 }), NO_DURATIONS))).toEqual([
      'battery_low',
    ]);
    expect(evaluateHeartbeat(snap({ batteryPercent: 20 }), NO_DURATIONS)).toEqual([]);
    // Unknown battery is not "low" either — that refusal belongs to
    // `mayInitiate`, which says so in the first person.
    expect(evaluateHeartbeat(snap({ batteryPercent: null }), NO_DURATIONS)).toEqual([]);
  });

  it('battery_low honours a configured threshold', () => {
    expect(ids(evaluateHeartbeat(snap({ batteryPercent: 34 }), NO_DURATIONS, [], 40))).toEqual([
      'battery_low',
    ]);
  });

  it('damped_unattended waits five minutes, and never fires under a latch', () => {
    const damped = snap({ damped: true, nowMs: NOW + 6 * MINUTE });
    expect(ids(evaluateHeartbeat(damped, { ...NO_DURATIONS, dampedSinceMs: NOW }))).toEqual([
      'damped_unattended',
    ]);
    // Four minutes in it is still an ordinary E-Stop recovery.
    expect(
      evaluateHeartbeat(snap({ damped: true, nowMs: NOW + 4 * MINUTE }), {
        ...NO_DURATIONS,
        dampedSinceMs: NOW,
      }),
    ).toEqual([]);
    // A damped robot under a live latch is not unattended, it is stopped.
    expect(
      evaluateHeartbeat({ ...damped, estopLatched: true }, { ...NO_DURATIONS, dampedSinceMs: NOW }),
    ).toEqual([]);
  });

  it('place_lost fires on an unknown or stale place, but never without a map', () => {
    const lost = { ...NO_DURATIONS, placeLostSinceMs: NOW };
    const later = NOW + 6 * MINUTE;

    expect(ids(evaluateHeartbeat(snap({ place: null, nowMs: later }), lost))).toEqual(['place_lost']);
    expect(
      ids(evaluateHeartbeat(snap({ placeConfidence: 'stale', nowMs: later }), lost)),
    ).toEqual(['place_lost']);
    // No place graph configured at all: the robot was never given a vocabulary
    // of places, which is not the same as having lost the one it had.
    expect(
      evaluateHeartbeat(snap({ placeConfigured: false, place: null, nowMs: later }), lost),
    ).toEqual([]);
  });

  it('plan_failed_idle fires only while nothing has happened since', () => {
    const failed = snap({ lastPlanFailedAtMs: NOW, nowMs: NOW + 2 * MINUTE });
    expect(ids(evaluateHeartbeat(failed, NO_DURATIONS))).toEqual(['plan_failed_idle']);
    // An operator turn AFTER the failure means somebody already knows.
    expect(
      evaluateHeartbeat({ ...failed, lastOperatorTurnAtMs: NOW + MINUTE }, NO_DURATIONS),
    ).toEqual([]);
    // …and one from before it does not count.
    expect(
      ids(evaluateHeartbeat({ ...failed, lastOperatorTurnAtMs: NOW - MINUTE }, NO_DURATIONS)),
    ).toEqual(['plan_failed_idle']);
  });

  it('workspace_write_failed carries the reason it was given', () => {
    const findings = evaluateHeartbeat(
      snap({ workspaceWriteFailedAtMs: NOW, workspaceWriteError: 'EROFS: read-only file system' }),
      NO_DURATIONS,
    );
    expect(ids(findings)).toEqual(['workspace_write_failed']);
    expect(findings[0].message).toContain('EROFS');
  });

  it('crash_unacknowledged SUPPRESSES every other finding', () => {
    const wrecked = snap({
      crashAcknowledged: false,
      batteryPercent: 4,
      workspaceWriteFailedAtMs: NOW,
      lastPlanFailedAtMs: NOW - 10 * MINUTE,
    });
    expect(ids(evaluateHeartbeat(wrecked, NO_DURATIONS))).toEqual(['crash_unacknowledged']);
  });

  it('carries matched intents through as findings, trusted as the operator', () => {
    const intent: HeartbeatFinding = {
      id: 'intent_matched',
      trust: 'operator',
      message: 'You asked me to say this here: is the ladder still blocking the door?',
    };
    const findings = evaluateHeartbeat(snap(), NO_DURATIONS, [intent]);
    expect(ids(findings)).toEqual(['intent_matched']);
    expect(findings[0].trust).toBe('operator');
  });
});

describe('isPlaceLost', () => {
  it('treats a belief older than the staleness budget as lost', () => {
    expect(isPlaceLost(snap({ placeAgeMs: 11 * MINUTE }))).toBe(true);
    expect(isPlaceLost(snap({ placeAgeMs: null }))).toBe(true);
    expect(isPlaceLost(snap())).toBe(false);
  });
});

// ============================================================================
// THE TWO POSE PREDICATES (contradiction #1)
// ============================================================================

describe('the pose split', () => {
  it('self-initiated action fails CLOSED on an unknown pose', () => {
    expect(selfActionAllowed({ poseKnown: false, insideKeepout: false })).toBe(false);
    expect(selfActionAllowed({ poseKnown: true, insideKeepout: false })).toBe(true);
    expect(selfActionAllowed({ poseKnown: true, insideKeepout: true })).toBe(false);
  });

  it('a protective stop requires a KNOWN pose inside a keepout', () => {
    // The whole point: `getLocoOdometry()` returns null several times an hour,
    // and damping the base on every dropped poll is a bigger hazard than the
    // geofence it would be protecting.
    expect(protectiveStopRequired({ poseKnown: false, insideKeepout: true })).toBe(false);
    expect(protectiveStopRequired({ poseKnown: false, insideKeepout: false })).toBe(false);
    expect(protectiveStopRequired({ poseKnown: true, insideKeepout: true })).toBe(true);
  });

  it('the two disagree about UNKNOWN, which is the point', () => {
    const unknown = { poseKnown: false, insideKeepout: true };
    expect(selfActionAllowed(unknown)).toBe(false);
    expect(protectiveStopRequired(unknown)).toBe(false);
  });

  /**
   * The gate is scoped the way `mayInitiate` scopes its own place/damp checks,
   * with `SELF_LOCOMOTION_KINDS`. Applied to the whole tick it made every
   * predicate unreachable wherever no place graph is configured — which is the
   * default G1 profile.
   */
  it('only the kinds that MOVE the robot need a pose', () => {
    const lost = { poseKnown: false, insideKeepout: false };
    for (const kind of ['walk', 'turn', 'goto'] as const) {
      expect(poseAllowsSelfAction(kind, lost)).toBe(false);
    }
    for (const kind of ['speak', 'wait', 'look', 'remember'] as const) {
      expect(poseAllowsSelfAction(kind, lost)).toBe(true);
    }
  });

  it('a keepout still refuses a move, even with a perfectly known pose', () => {
    expect(poseAllowsSelfAction('walk', { poseKnown: true, insideKeepout: true })).toBe(false);
    expect(poseAllowsSelfAction('walk', { poseKnown: true, insideKeepout: false })).toBe(true);
  });
});

// ============================================================================
// ACTIVE HOURS
// ============================================================================

describe('active hours', () => {
  it('parses a window, and reads anything unusable as "no window"', () => {
    expect(parseActiveHours('8-20')).toEqual({ startHour: 8, endHour: 20 });
    expect(parseActiveHours(' 22 - 6 ')).toEqual({ startHour: 22, endHour: 6 });
    expect(parseActiveHours('')).toBeNull();
    expect(parseActiveHours(undefined)).toBeNull();
    expect(parseActiveHours('8-8')).toBeNull();
    expect(parseActiveHours('08:00-20:00')).toBeNull();
    expect(parseActiveHours('8-25')).toBeNull();
  });

  it('handles a window that wraps midnight', () => {
    const night = parseActiveHours('22-6');
    expect(withinActiveHours(night, at(23))).toBe(true);
    expect(withinActiveHours(night, at(3))).toBe(true);
    expect(withinActiveHours(night, at(12))).toBe(false);
  });

  it('is always active with no window configured', () => {
    expect(withinActiveHours(null, at(3))).toBe(true);
  });
});

/** A local-time Date at the given hour — the window is a LOCAL clock window. */
function at(hour: number): Date {
  return new Date(2026, 7, 2, hour, 30, 0);
}

// ============================================================================
// THE ALLOWLIST — a filter, not a prompt rule
// ============================================================================

describe('filterHeartbeatBlocks', () => {
  it('allows exactly look / speak / wait / remember', () => {
    expect([...HEARTBEAT_ALLOWED_KINDS].sort()).toEqual(['look', 'remember', 'speak', 'wait']);
  });

  it('drops every locomotion and gesture block', () => {
    const plan: PlannedBlock[] = [
      { kind: 'speak', params: { text: 'battery low' } },
      { kind: 'walk', params: { distanceM: 3 } },
      { kind: 'goto', params: { entity: 'charger' } },
      { kind: 'turn', params: { angleDeg: 90 } },
      { kind: 'posture', params: { pose: 'stand' } },
      { kind: 'wave', params: {} },
      { kind: 'look', params: {} },
    ];
    const { kept, dropped } = filterHeartbeatBlocks(plan);
    expect(kept.map((b) => b.kind)).toEqual(['speak', 'look']);
    expect(dropped).toEqual(['walk', 'goto', 'turn', 'posture', 'wave']);
  });
});

describe('buildHeartbeatPlan', () => {
  it('speaks one sentence when somebody is there', () => {
    const blocks = buildHeartbeatPlan({
      snapshot: snap({ personVisible: true }),
      findings: [{ id: 'battery_low', trust: 'self', message: 'My battery is at 18%.' }],
    });
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe('speak');
    expect(blocks[0].params.text).toBe('My battery is at 18%.');
  });

  it('says nothing into an empty aisle', () => {
    expect(
      buildHeartbeatPlan({
        snapshot: snap({ personVisible: false }),
        findings: [{ id: 'battery_low', trust: 'self', message: 'My battery is at 18%.' }],
      }),
    ).toEqual([]);
  });
});

// ============================================================================
// THE MONITOR
// ============================================================================

interface MonitorHarness {
  monitor: HeartbeatMonitor;
  runs: Array<{ command: string; blocks: PlannedBlock[] }>;
  journal: JournalRecord[];
  set: (over: Partial<HeartbeatSnapshot>) => void;
  advance: (ms: number) => void;
  current: () => HeartbeatSnapshot;
}

function makeMonitor(
  opts: {
    settings?: Partial<HeartbeatSettings>;
    snapshot?: Partial<HeartbeatSnapshot>;
    buildPlan?: (input: { findings: readonly HeartbeatFinding[] }) => PlannedBlock[];
    matchIntents?: () => HeartbeatFinding[];
    voiceBusy?: () => boolean;
    run?: () => boolean;
    snapshotThrows?: () => boolean;
    protectiveStop?: (reason: string) => void;
    clock?: () => Date;
  } = {},
): MonitorHarness {
  let current = snap(opts.snapshot);
  const runs: MonitorHarness['runs'] = [];
  const journal: JournalRecord[] = [];

  const monitor = new HeartbeatMonitor({
    settings: {
      enabled: true,
      minIntervalMs: 300_000,
      activeHours: null,
      batteryPct: 20,
      motion: false,
      ...opts.settings,
    },
    snapshot: () => {
      if (opts.snapshotThrows?.()) throw new Error('sidecar exploded');
      return current;
    },
    run: (command, blocks) => {
      runs.push({ command, blocks });
      return opts.run ? opts.run() : true;
    },
    journal: (record) => journal.push(record),
    now: () => current.nowMs,
    clock: opts.clock ?? (() => new Date(current.nowMs)),
    ...(opts.buildPlan ? { buildPlan: opts.buildPlan } : {}),
    ...(opts.matchIntents ? { matchIntents: opts.matchIntents } : {}),
    ...(opts.voiceBusy ? { voiceBusy: opts.voiceBusy } : {}),
    ...(opts.protectiveStop ? { protectiveStop: opts.protectiveStop } : {}),
  });

  return {
    monitor,
    runs,
    journal,
    current: () => current,
    set: (over) => {
      current = { ...current, ...over };
    },
    advance: (ms) => {
      current = { ...current, nowMs: current.nowMs + ms };
    },
  };
}

describe('HeartbeatMonitor', () => {
  it('does nothing at all when the feature is off', () => {
    const h = makeMonitor({ settings: { enabled: false }, snapshot: { batteryPercent: 4 } });
    h.monitor.tick();
    expect(h.runs).toEqual([]);
    expect(h.journal).toEqual([]);
    expect(h.monitor.lastHold()).toBeNull();
  });

  it('a tick that finds nothing writes nothing and starts nothing', () => {
    const h = makeMonitor();
    for (let i = 0; i < 10; i++) {
      h.monitor.tick();
      h.advance(3000);
    }
    expect(h.runs).toEqual([]);
    expect(h.journal).toEqual([]);
  });

  it('runs at most ONE tier-1 pass per interval, however many predicates fire', () => {
    const h = makeMonitor({ snapshot: { batteryPercent: 12, workspaceWriteFailedAtMs: NOW } });

    for (let i = 0; i < 20; i++) {
      h.monitor.tick();
      h.advance(3000);
    }
    expect(h.runs).toHaveLength(1);
    // Both findings still made it into the journal — the limiter bounds what is
    // SAID, not what is recorded.
    expect(h.journal.map((r) => r.msg.split(':')[0])).toContain('battery_low');
    expect(h.journal.map((r) => r.msg.split(':')[0])).toContain('workspace_write_failed');

    // …and it speaks again once the window has passed.
    h.advance(300_000);
    h.monitor.tick();
    expect(h.runs).toHaveLength(2);
  });

  it('is suppressed entirely outside the active hours', () => {
    const h = makeMonitor({
      snapshot: { batteryPercent: 4 },
      settings: { activeHours: { startHour: 8, endHour: 18 } },
      clock: () => at(3),
    });
    h.monitor.tick();
    expect(h.runs).toEqual([]);
    expect(h.journal).toEqual([]);
    expect(h.monitor.lastHold()?.reason).toMatch(/active hours/i);
  });

  /**
   * The pose gate used to end the TICK, before `evaluateHeartbeat` was ever
   * called. On a default G1 profile `getPlaceBelief()` returns null (neither
   * `PLACE_GRAPH_PATH` nor `PLACE_TWIN_ID` is set), so `poseKnown` was false
   * forever and EVERY predicate — battery, workspace, crash, standing intents —
   * was unreachable. Fail-closed, and therefore not a hazard, but any
   * "heartbeat verified" claim in such a config was testing nothing.
   */
  it('still warns about a flat battery when it has no idea where it is', () => {
    const h = makeMonitor({
      snapshot: { batteryPercent: 4, pose: { poseKnown: false, insideKeepout: false } },
    });

    h.monitor.tick();

    expect(h.runs).toHaveLength(1);
    expect(h.runs[0].blocks.map((b) => b.kind)).toEqual(['speak']);
    expect(h.journal.map((r) => r.msg).join(' ')).toMatch(/battery_low/);
  });

  it('still holds the tick when the geofence puts a KNOWN pose inside a keepout', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const h = makeMonitor({
      snapshot: { batteryPercent: 4, pose: { poseKnown: true, insideKeepout: true } },
    });

    h.monitor.tick();

    // Scoping the pose gate must not soften the OTHER half of the split: a
    // keepout violation is a stop, not a question about what may be said.
    expect(h.runs).toEqual([]);
    expect(h.journal).toEqual([]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('holding:'));
  });

  it('does NOT protective-stop on an unknown pose that claims a keepout', () => {
    const stops: string[] = [];
    const h = makeMonitor({
      snapshot: { batteryPercent: 4, pose: { poseKnown: false, insideKeepout: true } },
      protectiveStop: (reason) => stops.push(reason),
    });
    h.monitor.tick();
    expect(stops).toEqual([]);
  });

  it('protective-stops on a KNOWN pose inside a keepout, and runs nothing else', () => {
    const stops: string[] = [];
    const h = makeMonitor({
      snapshot: { batteryPercent: 4, pose: { poseKnown: true, insideKeepout: true } },
      protectiveStop: (reason) => stops.push(reason),
    });
    h.monitor.tick();
    expect(stops).toHaveLength(1);
    expect(h.runs).toEqual([]);
  });

  it('an unacknowledged crash suppresses all other proactivity until an operator turn', () => {
    const h = makeMonitor({ snapshot: { crashAcknowledged: false, batteryPercent: 4 } });

    for (let i = 0; i < 5; i++) {
      h.monitor.tick();
      h.advance(3000);
    }
    expect(h.runs).toEqual([]);
    expect(h.monitor.lastHold()?.reason).toMatch(/did not shut down cleanly/i);

    // `resetEstop()` is the acknowledgement (TASK-196) — after it, the battery
    // is worth saying out loud.
    h.set({ crashAcknowledged: true });
    h.monitor.tick();
    expect(h.runs).toHaveLength(1);
  });

  it('holds under a latch rather than talking over a stopped robot', () => {
    const h = makeMonitor({ snapshot: { estopLatched: true, batteryPercent: 4 } });
    h.monitor.tick();
    expect(h.runs).toEqual([]);
    expect(h.monitor.lastHold()?.reason).toMatch(/E-Stop/);
  });

  it('fails closed when the snapshot itself throws', () => {
    let broken = true;
    const h = makeMonitor({ snapshot: { batteryPercent: 4 }, snapshotThrows: () => broken });

    h.monitor.tick();
    expect(h.runs).toEqual([]);
    expect(h.monitor.lastHold()?.reason).toMatch(/could not read my own state/i);

    broken = false;
    h.monitor.tick();
    expect(h.runs).toHaveLength(1);
  });

  it('fails closed when the plan builder throws — after journalling what it found', () => {
    const h = makeMonitor({
      snapshot: { batteryPercent: 4 },
      buildPlan: () => {
        throw new Error('template blew up');
      },
    });
    h.monitor.tick();
    expect(h.runs).toEqual([]);
    expect(h.journal.map((r) => r.msg)).toEqual([expect.stringContaining('battery_low')]);
    expect(h.monitor.lastHold()?.reason).toMatch(/could not work out what to say/i);
  });

  it('does not speak while a voice turn is in flight, and yields to it', () => {
    let busy = true;
    const h = makeMonitor({ snapshot: { batteryPercent: 4 }, voiceBusy: () => busy });

    for (let i = 0; i < 5; i++) {
      h.monitor.tick();
      h.advance(3000);
    }
    expect(h.runs).toEqual([]);
    expect(h.journal).toEqual([]);
    expect(h.monitor.lastHold()?.reason).toMatch(/talking to me/i);

    // Yielding must not COST the tier-1 pass: the moment the operator's turn
    // ends, the robot may still say what it noticed.
    busy = false;
    h.monitor.tick();
    expect(h.runs).toHaveLength(1);
  });

  it('drops a walk from the plan before it is handed on, and records the refusal', () => {
    const h = makeMonitor({
      snapshot: { batteryPercent: 4 },
      buildPlan: () => [
        { kind: 'walk', params: { distanceM: 4 } },
        { kind: 'speak', params: { text: 'my battery is at 4%' } },
      ],
    });

    h.monitor.tick();

    expect(h.runs).toHaveLength(1);
    expect(h.runs[0].blocks.map((b) => b.kind)).toEqual(['speak']);
    expect(h.journal.map((r) => r.msg)).toContainEqual(expect.stringContaining('refused to walk'));
  });

  it('writes HEARTBEAT_OK and speaks nothing when there is nobody to tell', () => {
    const h = makeMonitor({ snapshot: { batteryPercent: 4, personVisible: false } });

    h.monitor.tick();

    expect(h.runs).toEqual([]);
    expect(h.journal.map((r) => r.msg)).toEqual([
      expect.stringContaining('battery_low'),
      expect.stringContaining(HEARTBEAT_OK),
    ]);
  });

  it('journals the finding even when the initiative gate refuses the block', () => {
    // `look` is not free, so an unknown battery refuses it — and a refusal ends
    // the tick rather than running the rest of the plan.
    const h = makeMonitor({
      snapshot: { batteryPercent: null, workspaceWriteFailedAtMs: NOW },
      buildPlan: () => [{ kind: 'look', params: {} }],
    });

    h.monitor.tick();

    expect(h.runs).toEqual([]);
    expect(h.monitor.lastHold()?.reason).toMatch(/how much battery/i);
    expect(h.journal.map((r) => r.msg)).toContainEqual(expect.stringContaining('workspace_write_failed'));
  });

  it('measures the damped stretch from the tick it first saw it', () => {
    const h = makeMonitor({ snapshot: { damped: true } });

    h.monitor.tick(); // t0 — the clock starts here
    h.advance(4 * MINUTE);
    h.monitor.tick();
    expect(h.runs).toEqual([]);

    h.advance(2 * MINUTE);
    h.monitor.tick();
    expect(h.runs).toHaveLength(1);
    expect(h.runs[0].command).toContain('damped_unattended');
  });

  it('forgets the damped stretch as soon as the base is re-armed', () => {
    const h = makeMonitor({ snapshot: { damped: true } });
    h.monitor.tick();
    h.advance(4 * MINUTE);
    h.set({ damped: false });
    h.monitor.tick();
    h.set({ damped: true });
    h.advance(4 * MINUTE);
    h.monitor.tick();
    expect(h.runs).toEqual([]);
  });

  it('holds when something else took control between the snapshot and the claim', () => {
    const h = makeMonitor({ snapshot: { batteryPercent: 4 }, run: () => false });
    h.monitor.tick();
    expect(h.monitor.lastHold()?.reason).toMatch(/had control/i);
  });

  it('reset() clears the edge clocks and the rate limiter', () => {
    const h = makeMonitor({ snapshot: { batteryPercent: 4 } });
    h.monitor.tick();
    expect(h.runs).toHaveLength(1);

    h.monitor.reset();
    h.advance(3000);
    h.monitor.tick();
    expect(h.runs).toHaveLength(2);
  });
});
