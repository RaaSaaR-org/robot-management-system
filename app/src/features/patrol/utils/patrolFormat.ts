/**
 * @file patrolFormat.ts
 * @description Pure helpers for the patrol UI: status/severity styling, the
 *              finding link an alert carries, run/leg summaries.
 * @feature patrol
 */

import type {
  PatrolFinding,
  PatrolFindingSeverity,
  PatrolLegStatus,
  PatrolRun,
  PatrolRunStatus,
  PatrolTimeWindow,
} from '../types/patrol.types';

// ============================================================================
// STATUS STYLES
// ============================================================================

export interface ChipStyle {
  label: string;
  className: string;
  pulse?: boolean;
}

const RUN_STATUS_STYLES: Record<PatrolRunStatus, ChipStyle> = {
  running: { label: 'Running', className: 'bg-cobalt-500/15 text-cobalt-600 dark:text-cobalt-300', pulse: true },
  done: { label: 'Done', className: 'bg-turquoise-500/15 text-turquoise-700 dark:text-turquoise-400' },
  aborted: { label: 'Aborted', className: 'bg-amber-500/15 text-amber-600 dark:text-amber-400' },
  failed: { label: 'Failed', className: 'bg-red-500/15 text-red-600 dark:text-red-400' },
  skipped: { label: 'Skipped', className: 'glass-subtle text-theme-muted' },
};

/** Pill styling for a run status. */
export function runStatusStyle(status: PatrolRunStatus): ChipStyle {
  return RUN_STATUS_STYLES[status] ?? RUN_STATUS_STYLES.skipped;
}

const LEG_STATUS_STYLES: Record<PatrolLegStatus, ChipStyle> = {
  pending: { label: 'Pending', className: 'glass-subtle text-theme-tertiary' },
  running: { label: 'Running', className: 'bg-cobalt-500/15 text-cobalt-600 dark:text-cobalt-300', pulse: true },
  done: { label: 'Done', className: 'bg-turquoise-500/15 text-turquoise-700 dark:text-turquoise-400' },
  failed: { label: 'Failed', className: 'bg-red-500/15 text-red-600 dark:text-red-400' },
  skipped: { label: 'Skipped', className: 'glass-subtle text-theme-muted' },
};

/** Pill styling for a leg status. */
export function legStatusStyle(status: PatrolLegStatus): ChipStyle {
  return LEG_STATUS_STYLES[status] ?? LEG_STATUS_STYLES.pending;
}

const SEVERITY_STYLES: Record<PatrolFindingSeverity, ChipStyle> = {
  low: { label: 'Low', className: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20' },
  medium: {
    label: 'Medium',
    className: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20',
  },
  high: { label: 'High', className: 'bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20' },
};

/** Pill styling for a finding severity. */
export function severityStyle(severity: PatrolFindingSeverity): ChipStyle {
  return SEVERITY_STYLES[severity] ?? SEVERITY_STYLES.low;
}

// ============================================================================
// FINDING LINK IN ALERTS
// ============================================================================

/**
 * The server appends `[finding:<id> run:<runId>]` to the message of the alert it
 * raises for a confirmed finding, and a bare `[run:<runId>]` to the one it raises
 * for a skipped run (PatrolService.raiseSkippedAlert). This pulls either back out.
 */
export interface FindingLink {
  /** Null for a run-only tag: a skipped run has no finding to jump to. */
  findingId: string | null;
  runId: string | null;
}

/**
 * Both shapes of the machine tag. The bare `[run:…]` alternative is second so a
 * full `[finding:… run:…]` tag still parses as one link. Without it the skipped-run
 * alert reached the operator with a raw `[run:…]` in the prose and no way into the run.
 */
const FINDING_LINK_RE = /\[(?:finding:([^\s\]]+)(?:\s+run:([^\s\]]+))?|run:([^\s\]]+))\]/;

/** Parse the finding/run link out of an alert message/title; null when absent. */
export function parseFindingLink(text: string | null | undefined): FindingLink | null {
  if (!text) return null;
  const m = FINDING_LINK_RE.exec(text);
  if (!m) return null;
  return { findingId: m[1] ?? null, runId: m[2] ?? m[3] ?? null };
}

/** The message with the machine tag removed (for display). */
export function stripFindingLink(text: string): string {
  return text.replace(FINDING_LINK_RE, '').replace(/\s{2,}/g, ' ').trim();
}

/**
 * Route into RunDetail: to the finding when the tag names one, to the run itself
 * for a run-only tag. Null when the link has no run — nowhere to go then.
 */
export function findingLinkPath(link: FindingLink): string | null {
  if (!link.runId) return null;
  const runPath = `/patrol/runs/${encodeURIComponent(link.runId)}`;
  return link.findingId ? `${runPath}#finding-${link.findingId}` : runPath;
}

// ============================================================================
// SUMMARIES
// ============================================================================

/** "3/5 legs · 1 finding" for a run row. */
export function runProgressText(run: PatrolRun): string {
  const total = run.legs.length;
  const finished = run.legs.filter((l) => l.status === 'done' || l.status === 'failed' || l.status === 'skipped').length;
  const failed = run.legs.filter((l) => l.status === 'failed').length;
  const parts = [`${finished}/${total} legs`];
  if (failed > 0) parts.push(`${failed} failed`);
  parts.push(`${run.findingCount} ${run.findingCount === 1 ? 'finding' : 'findings'}`);
  return parts.join(' · ');
}

/** "07:00–19:00" for a time window. */
export function formatWindow(w: PatrolTimeWindow): string {
  // Clamped to 24, not 23: hour 24 is a legal end (RouteEditor's clampHour, the
  // `max={24}` inputs, the 24-column band and the `00 06 12 18 24` axis all allow
  // it). Clamping to 23 printed an all-day window as "00:00–23:00" in the legend,
  // the Preview rail and the bar's aria-label — the only text a screen reader gets —
  // telling the operator the last hour of the day was uncovered when it was not.
  const hh = (h: number) => `${String(Math.max(0, Math.min(24, Math.round(h)))).padStart(2, '0')}:00`;
  return `${hh(w.startHour)}–${hh(w.endHour)}`;
}

/** Findings of a run, highest severity first, then newest first. */
export function sortFindings(findings: readonly PatrolFinding[]): PatrolFinding[] {
  const rank: Record<PatrolFindingSeverity, number> = { high: 0, medium: 1, low: 2 };
  return [...findings].sort((a, b) => {
    const r = rank[a.severity] - rank[b.severity];
    if (r !== 0) return r;
    return Date.parse(b.at) - Date.parse(a.at);
  });
}

/** Whether a run still counts as "active" for banners and overlays. */
export function isRunActive(run: PatrolRun | null | undefined): boolean {
  return Boolean(run && run.status === 'running');
}

/** Short local time, or the raw string when it does not parse. */
export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
