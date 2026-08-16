/**
 * @file blockFormat.ts
 * @description Human labels, param summaries and status styling for agent blocks
 * @feature agentmode
 */

import type { AgentBlock, AgentBlockKind, AgentBlockStatus, AgentPlanStatus } from '../types';

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

/** Compact duration string, e.g. `0.8s` / `12.4s` / `1m 05s`. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}m ${String(rest).padStart(2, '0')}s`;
}

/** Bearing rendered as a compass-style signed degree value. */
export function formatBearing(bearingDeg: number): string {
  const rounded = Math.round(bearingDeg);
  return `${rounded > 0 ? '+' : ''}${rounded}°`;
}
