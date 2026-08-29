/**
 * @file blockFormat.ts
 * @description Human labels, param summaries and status styling for agent blocks
 * @feature agentmode
 */

import type {
  AgentBlock,
  AgentBlockKind,
  AgentBlockStatus,
  AgentPlanStatus,
  VlaSkillOutcome,
} from '../types';

// ============================================================================
// LABELS
// ============================================================================

const BLOCK_LABELS: Record<AgentBlockKind, string> = {
  walk: 'Walk',
  turn: 'Turn',
  goto: 'Go to',
  look: 'Look',
  scan_room: 'Scan room',
  wave: 'Wave',
  greet: 'Greet',
  posture: 'Posture',
  speak: 'Speak',
  wait: 'Wait',
  remember: 'Remember',
  patrol: 'Patrol',
  capture: 'Capture',
  inspect: 'Inspect',
  // Host mode (TASK-213). "Present" and "Demo" are what the operator sees the
  // robot doing in front of a visitor: saying one authored piece, and running
  // (or describing) a skill.
  tour: 'Tour',
  present: 'Present',
  demo: 'Demo',
  // TASK-226. "Skill" and not "Pick" or "Manipulate": what the block does is
  // hand control to a named policy, and what that policy achieves is exactly
  // the thing the card must not assert.
  vla_skill: 'Skill',
};

/** Human label for a block kind. */
export function blockKindLabel(kind: AgentBlockKind): string {
  return BLOCK_LABELS[kind] ?? kind;
}

/** Single-character glyph used on the block card's icon chip. */
const BLOCK_GLYPHS: Record<AgentBlockKind, string> = {
  walk: '↑',
  turn: '↺',
  goto: '⌖',
  look: '◎',
  scan_room: '⟳',
  wave: '✋',
  greet: '☺',
  posture: '⇕',
  speak: '❝',
  wait: '⏸',
  remember: '✎',
  patrol: '⛨',
  capture: '📷',
  inspect: '🔍',
  tour: '🚩',
  present: '🗣',
  demo: '🤲',
  vla_skill: '🦾',
};

/** Glyph for a block kind — a tiny, dependency-free icon. */
export function blockKindGlyph(kind: AgentBlockKind): string {
  return BLOCK_GLYPHS[kind] ?? '•';
}

// ============================================================================
// PARAMS
// ============================================================================

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * One-line summary of a block's params, tuned per kind so the card reads like
 * an instruction rather than a JSON dump. Falls back to `key: value` pairs for
 * anything the planner sends that v1 doesn't model.
 */
export function formatBlockParams(block: AgentBlock): string {
  const p = block.params ?? {};

  switch (block.kind) {
    case 'walk': {
      const distance = num(p.distanceM);
      const direction = str(p.direction) ?? 'forward';
      return distance !== null ? `${distance.toFixed(1)} m ${direction}` : direction;
    }
    case 'turn': {
      const angle = num(p.angleDeg);
      if (angle === null) return '';
      return `${angle > 0 ? '+' : ''}${Math.round(angle)}° ${angle >= 0 ? 'left' : 'right'}`;
    }
    case 'goto': {
      // TASK-208: how the navigator is driving it. Absent (older agent, or the
      // route not planned yet) → just the target.
      // TASK-209: a `place` is a room of the place graph, an `entity` a thing
      // the camera saw. One `goto` carries exactly one of them.
      const place = str(p.place);
      const entity = place ? `into ${place}` : (str(p.entity) ?? '');
      const nav = block.nav;
      if (!nav) return entity;
      // The navigator re-plans at every stage, so the LAST route it published
      // for an arrived goto is the degenerate one from the goal itself: zero
      // length, no segments. "planned 0.0 m in 0 segments" is not a route an
      // operator can act on — the card falls back to the target, and the block
      // result underneath carries the distance actually walked.
      const degenerate = nav.planned && nav.segments === 0;
      if (degenerate) return entity;
      const how =
        nav.planned && nav.lengthM !== null
          ? `planned ${nav.lengthM.toFixed(1)} m in ${nav.segments} segment${nav.segments === 1 ? '' : 's'}`
          : 'walking by sight';
      return entity ? `${entity} · ${how}` : how;
    }
    case 'scan_room': {
      const steps = num(p.steps);
      return `${steps ?? 8} steps · 360°`;
    }
    case 'wave':
      // No hand is printed on purpose: the G1's ArmTask wave (api 7106) is a
      // fixed right-arm gesture, so there is nothing to select. Naming a hand
      // would suggest a choice the robot does not have. The only modifier the
      // block carries is `turn` — whether the torso turns toward the person.
      return p.turn === true ? '(turning toward them)' : '';
    case 'greet':
      return str(p.text) ?? 'speak + wave';
    case 'posture':
      return str(p.pose) ?? '';
    case 'speak': {
      const text = str(p.text);
      return text ? `“${text}”` : '';
    }
    case 'wait': {
      const seconds = num(p.seconds);
      return seconds !== null ? `${seconds} s` : '';
    }
    case 'remember': {
      // The scope is what an operator has to be able to see at a glance: a
      // "global" line outlives the place it was said in.
      const text = str(p.text);
      const scope = str(p.scope) === 'global' ? 'everywhere' : 'here';
      return text ? `${scope}: “${text}”` : scope;
    }
    case 'patrol': {
      // TASK-212: the top-level block of a run. The runner sends the route id;
      // `routeName` when it has it. Mode says whether this is a reference walk.
      const name = str(p.routeName) ?? str(p.routeId) ?? '';
      const mode = str(p.mode) === 'baseline' ? 'baseline run' : 'patrol';
      return name ? `${name} · ${mode}` : mode;
    }
    case 'capture': {
      // Control photo at a checkpoint; the heading is where the robot turns first.
      const name = str(p.checkpointName) ?? str(p.checkpointId) ?? '';
      const heading = num(p.headingDeg);
      const parts = [name ? `at ${name}` : 'control photo'];
      if (heading !== null) parts.push(`heading ${Math.round(heading)}°`);
      return parts.join(' · ');
    }
    case 'inspect': {
      // Compare the checkpoint against its baseline.
      const name = str(p.checkpointName) ?? str(p.checkpointId) ?? '';
      return name ? `${name} vs baseline` : 'vs baseline';
    }
    case 'tour': {
      // TASK-213: the top-level block of a visit, expanded into legs by the
      // TourRunner exactly as `patrol` is.
      const name = str(p.routeName) ?? str(p.routeId) ?? '';
      const stops = num(p.stops);
      const count = stops !== null ? `${stops} stop${stops === 1 ? '' : 's'}` : 'tour';
      return name ? `${name} · ${count}` : count;
    }
    case 'present': {
      // One authored chunk of a stop's talk track. The words are what belongs
      // on a one-line chip; the "part 2 of 3" counter is rendered as its own
      // chip by BlockCard (see `presentProgress`), where there is room for it.
      const text = str(p.text);
      const progress = presentProgress(block);
      if (text) return `“${text}”`;
      return progress ? `part ${progress.chunk} of ${progress.of}` : 'part';
    }
    case 'demo': {
      // `narrate` must never read as a grasp that happened: the robot said what
      // it does at this station, it did not do it. The mode is spelled out in
      // words rather than left to a status pill.
      const skill = str(p.skillName) ?? str(p.skillId) ?? 'skill';
      return demoMode(block) === 'execute' ? `runs “${skill}”` : `describes “${skill}” (not executed)`;
    }
    case 'vla_skill': {
      // TASK-226. The outcome is the load-bearing half of this chip, and it is
      // spelled out in words rather than left to the status pill: a `done` pill
      // on a rollout nobody checked reads as "the robot did it", which is the
      // one claim this block kind exists to avoid making.
      const skill = str(p.label) ?? str(p.skill) ?? 'skill';
      const outcome = vlaSkillOutcome(block);
      if (outcome === 'succeeded') return `“${skill}” · succeeded`;
      if (outcome === 'failed') return `“${skill}” · failed`;
      if (outcome === 'unknown') return `“${skill}” · outcome unknown`;
      return `“${skill}”`;
    }
    case 'look':
      // `speak: true` is the answering look ("tell me what is on the table"):
      // the robot says what it sees, so the card should say so up front.
      return p.speak === true ? 'camera → scene memory · says what it sees' : 'camera → scene memory';
    default: {
      const pairs = Object.entries(p).map(([k, v]) => `${k}: ${String(v)}`);
      return pairs.join(' · ');
    }
  }
}

/**
 * Which chunk of a stop's talk track a `present` block says, when it says so.
 * Null for any other kind — and for a `present` the robot sent without the
 * counter, which is reported as "no counter" rather than as "part 1 of 1".
 */
export function presentProgress(block: AgentBlock): { chunk: number; of: number } | null {
  if (block.kind !== 'present') return null;
  const chunk = num(block.params?.chunk);
  const of = num(block.params?.of);
  return chunk !== null && of !== null ? { chunk, of } : null;
}

/**
 * The three-way verdict on a finished `vla_skill` block (TASK-226), or null
 * when there is none — a block that has not run yet, or any other kind.
 *
 * An unrecognised value reads as null and NOT as `succeeded`: the whole point
 * of the three-way outcome is that success has to be positively established, so
 * a missing or malformed verdict must never be rendered as one.
 */
export function vlaSkillOutcome(block: AgentBlock): VlaSkillOutcome | null {
  if (block.kind !== 'vla_skill') return null;
  const outcome = str(block.params?.outcome);
  return outcome === 'succeeded' || outcome === 'failed' || outcome === 'unknown' ? outcome : null;
}

/**
 * How a `demo` block ran: `execute` really drove the VLA skill, `narrate` only
 * described it. Null for any other kind, and for a `demo` whose mode is missing
 * — which must NOT default to 'execute': claiming a grasp happened is the one
 * mistake this block kind exists to prevent.
 */
export function demoMode(block: AgentBlock): 'execute' | 'narrate' | null {
  if (block.kind !== 'demo') return null;
  const mode = str(block.params?.mode);
  return mode === 'execute' || mode === 'narrate' ? mode : null;
}

// ============================================================================
// STATUS
// ============================================================================

interface StatusStyle {
  label: string;
  className: string;
  pulse?: boolean;
}

const BLOCK_STATUS_STYLES: Record<AgentBlockStatus, StatusStyle> = {
  pending: {
    label: 'Pending',
    className: 'glass-subtle text-theme-tertiary',
  },
  running: {
    label: 'Running',
    className: 'bg-cobalt-500/15 text-cobalt-400',
    pulse: true,
  },
  done: {
    label: 'Done',
    className: 'bg-turquoise-500/15 text-turquoise-600 dark:text-turquoise-400',
  },
  failed: {
    label: 'Failed',
    className: 'bg-red-500/15 text-red-600 dark:text-red-400',
  },
  skipped: {
    label: 'Skipped',
    className: 'glass-subtle text-theme-muted',
  },
  aborted: {
    label: 'Aborted',
    className: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  },
};

/** Pill styling for a block status. */
export function blockStatusStyle(status: AgentBlockStatus): StatusStyle {
  return BLOCK_STATUS_STYLES[status] ?? BLOCK_STATUS_STYLES.pending;
}

const PLAN_STATUS_STYLES: Record<AgentPlanStatus, StatusStyle> = {
  planning: { label: 'Planning', className: 'glass-subtle text-theme-tertiary', pulse: true },
  running: { label: 'Running', className: 'bg-cobalt-500/15 text-cobalt-400', pulse: true },
  done: {
    label: 'Done',
    className: 'bg-turquoise-500/15 text-turquoise-600 dark:text-turquoise-400',
  },
  failed: { label: 'Failed', className: 'bg-red-500/15 text-red-600 dark:text-red-400' },
  aborted: { label: 'Aborted', className: 'bg-amber-500/15 text-amber-600 dark:text-amber-400' },
};

/** Pill styling for a plan status. */
export function planStatusStyle(status: AgentPlanStatus): StatusStyle {
  return PLAN_STATUS_STYLES[status] ?? PLAN_STATUS_STYLES.planning;
}

// ============================================================================
// DURATION
// ============================================================================

/**
 * Wall-clock duration of a block, from its own timestamps. Returns null while
 * a block has not started — we never invent a number.
 */
export function blockDurationMs(block: AgentBlock): number | null {
  if (!block.startedAt) return null;
  const start = Date.parse(block.startedAt);
  if (Number.isNaN(start)) return null;
  const end = block.finishedAt ? Date.parse(block.finishedAt) : Date.now();
  if (Number.isNaN(end) || end < start) return null;
  return end - start;
}

/**
 * Compact duration string, e.g. `0.8s` / `12.4s` / `1m 05s`.
 *
 * Both halves of the `m`/`s` form come from ONE rounded total. Rounding them
 * separately — `floor` for the minutes, `round` for the remainder — disagrees
 * whenever the remainder lands at 59.5 s or more and prints `1m 60s`. That was
 * invisible while the only caller passed a finished block's fixed duration, but
 * the Planning counter (TASK-202) re-renders a growing number every second, so
 * for any plan whose sub-second offset is >= 500 ms it would show `1m 60s`,
 * `2m 60s`, `3m 60s` — once a minute, on the one number the counter exists to
 * make readable.
 *
 * The seconds branch stops at 59.95 for the same reason from the other side:
 * `toFixed(1)` on 59.999 renders `60.0s`.
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 59.95) return `${seconds.toFixed(1)}s`;
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  return `${minutes}m ${String(total % 60).padStart(2, '0')}s`;
}

/** Bearing rendered as a compass-style signed degree value. */
export function formatBearing(bearingDeg: number): string {
  const rounded = Math.round(bearingDeg);
  return `${rounded > 0 ? '+' : ''}${rounded}°`;
}
