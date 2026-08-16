/**
 * @file RouteEditor.tsx
 * @description Create/edit a patrol route: name, robot, ordered checkpoints
 *              (places from the robot's place graph, or a typed place id),
 *              per-checkpoint heading/actions/dwell/expectations, cron with
 *              live validation, time windows, home place, enabled, VDA5050
 *              export. Laid out as an ops form (left) with a sticky live
 *              preview rail + save bar (right); the checkpoints are a
 *              vertical stepper of collapsible cards.
 * @feature patrol
 */

import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { cn } from '@/shared/utils/cn';
import { Button } from '@/shared/components/ui/Button';
import { useDebounce } from '@/shared/hooks/useDebounce';
import { getErrorMessage } from '@/shared/utils/error';
import { downloadBlob } from '@/features/agentmode/utils/mapExport';
import type {
  CronValidation,
  PatrolCheckpoint,
  PatrolCheckpointAction,
  PatrolPlace,
  PatrolRoute,
  PatrolRouteInput,
  PatrolTimeWindow,
} from '../types/patrol.types';
import { DEFAULT_TIME_WINDOWS, PatrolCheckpointActions } from '../types/patrol.types';
import { patrolApi } from '../api/patrolApi';
import { usePatrolStore, selectPlacesForRobot } from '../store/patrolStore';
import { formatWhen, formatWindow } from '../utils/patrolFormat';
import {
  LEG_NODE,
  PATROL_FADE_IN,
  PATROL_FOCUS,
  PATROL_MICRO,
  PATROL_MONO,
  PATROL_MOTION,
  PATROL_PANEL,
  PATROL_STICKY_RAIL,
  RoutePath,
  SectionHeader,
  StatusDot,
} from './patrolUi';

// ============================================================================
// TYPES
// ============================================================================

export interface RouteEditorRobot {
  id: string;
  name: string;
}

export interface RouteEditorProps {
  /** Existing route to edit; null/undefined = new route. */
  route?: PatrolRoute | null;
  robots: RouteEditorRobot[];
  /** Preselect a robot for a new route. */
  defaultRobotId?: string | null;
  onSaved: (route: PatrolRoute) => void;
  onCancel?: () => void;
  onDelete?: (route: PatrolRoute) => void;
  className?: string;
}

interface Draft {
  name: string;
  robotId: string;
  twinId: string;
  checkpoints: PatrolCheckpoint[];
  cronExpression: string;
  enabled: boolean;
  timeWindows: PatrolTimeWindow[];
  homePlaceId: string;
}

// ============================================================================
// HELPERS
// ============================================================================

const MANUAL = '__manual__';
const CRON_DEBOUNCE_MS = 400;

function newId(prefix: string): string {
  const rnd =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${rnd}`;
}

function draftFromRoute(route: PatrolRoute | null | undefined, defaultRobotId?: string | null): Draft {
  return {
    name: route?.name ?? '',
    robotId: route?.robotId ?? defaultRobotId ?? '',
    twinId: route?.twinId ?? '',
    checkpoints: route?.checkpoints ? route.checkpoints.map((c) => ({ ...c, actions: [...c.actions] })) : [],
    cronExpression: route?.cronExpression ?? '',
    enabled: route?.enabled ?? true,
    timeWindows: route ? route.timeWindows.map((w) => ({ ...w })) : DEFAULT_TIME_WINDOWS.map((w) => ({ ...w })),
    homePlaceId: route?.homePlaceId ?? '',
  };
}

/** Pure: reorder a checkpoint by one slot; out-of-range moves are no-ops. */
export function moveCheckpoint(list: PatrolCheckpoint[], index: number, delta: -1 | 1): PatrolCheckpoint[] {
  const target = index + delta;
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  return next;
}

/** Pure: the route body the server accepts, from the editor draft. */
export function draftToInput(draft: Draft): PatrolRouteInput {
  return {
    name: draft.name.trim(),
    robotId: draft.robotId || null,
    twinId: draft.twinId || null,
    checkpoints: draft.checkpoints.map((c) => ({
      id: c.id,
      placeId: c.placeId.trim(),
      name: (c.name || c.placeId).trim(),
      headingDeg: typeof c.headingDeg === 'number' && Number.isFinite(c.headingDeg) ? c.headingDeg : null,
      actions: c.actions,
      dwellMs: c.actions.includes('dwell') ? Math.max(0, Math.round(c.dwellMs ?? 0)) : 0,
      expectations: (c.expectations ?? []).map((e) => e.trim()).filter(Boolean),
    })),
    cronExpression: draft.cronExpression.trim() || null,
    enabled: draft.enabled,
    // A window added in the editor carries a placeholder id (`w-…`) so its
    // inputs keep a stable key while the operator types; the real id is the
    // name's slug, fixed here at save time.
    timeWindows: draft.timeWindows.map((w) => ({
      id: windowId(w),
      name: w.name.trim() || w.id,
      startHour: clampHour(w.startHour),
      endHour: clampHour(w.endHour),
    })),
    homePlaceId: draft.homePlaceId.trim() || null,
  };
}

/** Slug of the window name for editor-added windows; existing ids are kept. */
function windowId(w: PatrolTimeWindow): string {
  const slug = w.name.trim().toLowerCase().replace(/\s+/g, '-');
  if (w.id.startsWith('w-')) return slug || w.id;
  return w.id.trim() || slug;
}

function clampHour(h: number): number {
  return Math.max(0, Math.min(24, Math.round(Number.isFinite(h) ? h : 0)));
}

/** Pure: what stops the draft from being saved; empty when it can be. */
export function validateDraft(draft: Draft): string[] {
  const problems: string[] = [];
  if (!draft.name.trim()) problems.push('Give the route a name.');
  if (draft.checkpoints.length === 0) problems.push('Add at least one checkpoint.');
  draft.checkpoints.forEach((c, i) => {
    if (!c.placeId.trim()) problems.push(`Checkpoint ${i + 1} has no place.`);
  });
  const ids = new Set<string>();
  for (const w of draft.timeWindows) {
    const id = windowId(w);
    if (!w.name.trim() && w.id.startsWith('w-')) problems.push('Every time window needs a name.');
    else if (ids.has(id)) problems.push(`Time window "${id}" is listed twice.`);
    ids.add(id);
  }
  return problems;
}

const INPUT = cn(
  'glass-subtle w-full min-w-0 px-2.5 py-1.5 text-sm text-theme-primary rounded-brand border border-glass-subtle',
  'focus:outline-none focus:ring-2 focus:ring-cobalt-500/40 focus:border-cobalt-500/40 disabled:opacity-50',
  PATROL_MOTION
);
const LABEL = 'block text-xs font-medium text-theme-secondary mb-1';
const ICON_BTN = cn(
  'size-7 glass-subtle rounded-brand inline-flex items-center justify-center text-xs leading-none',
  'hover:bg-theme-hover disabled:opacity-40 disabled:hover:bg-transparent',
  PATROL_MOTION,
  PATROL_FOCUS
);
const ACTION_PILL = cn(
  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs cursor-pointer select-none',
  'glass-subtle text-theme-secondary hover:text-theme-primary',
  'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-cobalt-500/40',
  PATROL_MOTION
);
const ACTION_PILL_ON = 'bg-cobalt-500/15 text-cobalt-700 dark:text-cobalt-300 ring-1 ring-cobalt-500/40';
const CHIP = cn(PATROL_MONO, 'glass-subtle rounded px-1.5 py-px text-[11px]');
const NODE = cn('relative z-10 shrink-0 w-6 h-6 rounded-full inline-flex items-center justify-center text-[11px] font-semibold tabular-nums');
const STEPPER_LINE = 'relative before:absolute before:left-[11px] before:top-3 before:bottom-3 before:w-px before:bg-[var(--glass-border-highlight)]';

/**
 * Band colour of a time window on the 24-h bar. Windows are a tonal scale of
 * the primary (light = day, deep = night, grey = custom) so they never borrow
 * amber (attention) or turquoise (done) from the status vocabulary.
 */
function windowBand(w: PatrolTimeWindow): string {
  const id = windowId(w);
  if (id === 'day') return 'bg-cobalt-300/70 dark:bg-cobalt-300/60';
  if (id === 'night') return 'bg-cobalt-700/70 dark:bg-cobalt-500/70';
  return 'bg-surface-light-400/80 dark:bg-surface-400/80';
}
function windowDot(w: PatrolTimeWindow): string {
  const id = windowId(w);
  if (id === 'day') return 'bg-cobalt-300';
  if (id === 'night') return 'bg-cobalt-700 dark:bg-cobalt-500';
  return 'bg-surface-light-400 dark:bg-surface-400';
}

/** Pure: the [start,end) hour segments a window covers; wraps midnight into two. */
export function windowSegments(w: PatrolTimeWindow): Array<[number, number]> {
  const s = clampHour(w.startHour);
  const e = clampHour(w.endHour);
  if (e > s) return [[s, e]];
  if (s === e && s === 0) return [[0, 24]];
  return [[s, 24], [0, e]].filter(([a, b]) => b > a) as Array<[number, number]>;
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

interface WindowBarProps {
  windows: readonly PatrolTimeWindow[];
  size?: 'sm' | 'md';
  className?: string;
}

/** 24-hour bar with one band per time window and a "now" marker. */
const WindowBar = memo(function WindowBar({ windows, size = 'md', className }: WindowBarProps) {
  const [nowFrac, setNowFrac] = useState<number>(() => {
    const d = new Date();
    return (d.getHours() + d.getMinutes() / 60) / 24;
  });
  useEffect(() => {
    const t = setInterval(() => {
      const d = new Date();
      setNowFrac((d.getHours() + d.getMinutes() / 60) / 24);
    }, 60_000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className={cn('min-w-0', className)}>
      <div
        className={cn('relative grid grid-cols-24 rounded-full overflow-hidden glass-subtle', size === 'sm' ? 'h-1.5' : 'h-2.5')}
        role="img"
        aria-label={windows.length ? `Time windows: ${windows.map((w) => `${w.name || w.id} ${formatWindow(w)}`).join(', ')}` : 'No time windows'}
      >
        {windows.map((w) =>
          windowSegments(w).map(([a, b], i) => (
            <span
              key={`${w.id}-${i}`}
              className={cn('h-full', windowBand(w), PATROL_MOTION)}
              style={{ gridColumn: `${a + 1} / ${b + 1}` }}
              aria-hidden="true"
            />
          ))
        )}
        <span
          className="absolute inset-y-0 w-px bg-theme-primary"
          style={{ left: `${(nowFrac * 100).toFixed(2)}%` }}
          aria-hidden="true"
          title="now"
        />
      </div>
      {size === 'md' && (
        <div className={cn(PATROL_MICRO, 'mt-1 flex justify-between font-mono tabular-nums')} aria-hidden="true">
          <span>00</span>
          <span>06</span>
          <span>12</span>
          <span>18</span>
          <span>24</span>
        </div>
      )}
    </div>
  );
});

function Fact({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <>
      <dt className={cn(PATROL_MICRO, 'pt-0.5')}>{label}</dt>
      <dd className={cn(PATROL_MONO, 'min-w-0 break-words')}>{children}</dd>
    </>
  );
}

// ============================================================================
// COMPONENT
// ============================================================================

export const RouteEditor = memo(function RouteEditor({
  route,
  robots,
  defaultRobotId,
  onSaved,
  onCancel,
  onDelete,
  className,
}: RouteEditorProps) {
  const [draft, setDraft] = useState<Draft>(() => draftFromRoute(route, defaultRobotId));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const [pickPlace, setPickPlace] = useState<string>('');
  const [manualPlace, setManualPlace] = useState('');
  /** Checkpoint ids whose details are folded away (inputs stay mounted). */
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(route?.checkpoints.map((c) => c.id) ?? []));

  const saveRoute = usePatrolStore((s) => s.saveRoute);
  const fetchPlaces = usePatrolStore((s) => s.fetchPlaces);
  const places = usePatrolStore(selectPlacesForRobot(draft.robotId || null));
  const placesStatus = usePatrolStore((s) => (draft.robotId ? (s.placesStatus[draft.robotId] ?? 'idle') : 'idle'));

  // Reset the draft when a different route is opened.
  useEffect(() => {
    setDraft(draftFromRoute(route, defaultRobotId));
    setCollapsed(new Set(route?.checkpoints.map((c) => c.id) ?? []));
  }, [route?.id]);

  // Places of the selected robot.
  useEffect(() => {
    if (draft.robotId) void fetchPlaces(draft.robotId);
  }, [draft.robotId, fetchPlaces]);

  // Cron: validate on the server, debounced.
  const debouncedCron = useDebounce(draft.cronExpression.trim(), CRON_DEBOUNCE_MS);
  const [cron, setCron] = useState<CronValidation | null>(null);
  const [cronBusy, setCronBusy] = useState(false);
  useEffect(() => {
    if (!debouncedCron) {
      setCron(null);
      return;
    }
    let cancelled = false;
    setCronBusy(true);
    void patrolApi
      .validateCron(debouncedCron)
      .then((v) => {
        if (!cancelled) setCron(v);
      })
      .catch((err: unknown) => {
        if (!cancelled) setCron({ valid: false, nextRuns: [], error: getErrorMessage(err, 'validation failed') });
      })
      .finally(() => {
        if (!cancelled) setCronBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedCron]);

  const placeName = useCallback(
    (id: string) => places?.find((p) => p.id === id)?.name ?? id,
    [places]
  );

  const update = useCallback((patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch })), []);
  const updateCheckpoint = useCallback((index: number, patch: Partial<PatrolCheckpoint>) => {
    setDraft((d) => ({
      ...d,
      checkpoints: d.checkpoints.map((c, i) => (i === index ? { ...c, ...patch } : c)),
    }));
  }, []);

  const addCheckpoint = useCallback(() => {
    const placeId = (pickPlace === MANUAL ? manualPlace : pickPlace).trim();
    if (!placeId) return;
    const cp: PatrolCheckpoint = {
      id: newId('cp'),
      placeId,
      name: placeName(placeId),
      headingDeg: null,
      actions: ['capture'],
      dwellMs: 0,
      expectations: [],
    };
    setDraft((d) => ({ ...d, checkpoints: [...d.checkpoints, cp] }));
    if (pickPlace === MANUAL) setManualPlace('');
  }, [pickPlace, manualPlace, placeName]);

  const toggleCollapsed = useCallback((id: string) => {
    setCollapsed((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const problems = useMemo(() => validateDraft(draft), [draft]);
  const cronBlocks = Boolean(draft.cronExpression.trim()) && cron !== null && !cron.valid;

  const handleSave = useCallback(async () => {
    if (problems.length > 0 || cronBlocks) return;
    setSaving(true);
    setSaveError(null);
    const saved = await saveRoute(draftToInput(draft), route?.id ?? null);
    setSaving(false);
    if (saved) onSaved(saved);
    else setSaveError(usePatrolStore.getState().error ?? 'Saving failed');
  }, [problems, cronBlocks, saveRoute, draft, route?.id, onSaved]);

  const handleExport = useCallback(async () => {
    if (!route) return;
    try {
      const doc = await patrolApi.exportVda5050(route.id);
      const stem = route.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || route.id;
      downloadBlob(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }), `${stem}.vda5050.json`);
      setExportNote(null);
    } catch (err) {
      setExportNote(`Export failed: ${getErrorMessage(err, 'unknown error')}`);
    }
  }, [route]);

  const placeOptions: PatrolPlace[] = places ?? [];
  const robotLabel = robots.find((r) => r.id === draft.robotId)?.name ?? (draft.robotId || 'any robot');
  const previewLegs = useMemo(
    () => draft.checkpoints.map((c, i) => ({ index: i, label: c.name || c.placeId || '?', status: 'route' as const })),
    [draft.checkpoints]
  );
  const nextFires = cron && cron.valid ? cron.nextRuns.slice(0, 3).map(formatWhen).join(' · ') || '—' : null;
  const allCollapsed = draft.checkpoints.length > 0 && draft.checkpoints.every((c) => collapsed.has(c.id));

  return (
    <div className={cn('flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start min-w-0', className)} data-testid="patrol-route-editor">
      {/* ------------------------------------------------------------ left: form */}
      <div className="flex flex-col gap-4 min-w-0">
        {/* Route */}
        <section className={PATROL_PANEL}>
          <SectionHeader as="h3" title="Route" className="mb-3" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="min-w-0">
              <label className={LABEL} htmlFor="patrol-route-name">
                Route name
              </label>
              <input
                id="patrol-route-name"
                data-testid="patrol-route-name"
                className={INPUT}
                value={draft.name}
                onChange={(e) => update({ name: e.target.value })}
                placeholder="Night round, ground floor"
              />
            </div>
            <div className="min-w-0">
              <label className={LABEL} htmlFor="patrol-route-robot">
                Robot
              </label>
              <select
                id="patrol-route-robot"
                data-testid="patrol-route-robot"
                className={cn(INPUT, 'truncate')}
                value={draft.robotId}
                onChange={(e) => update({ robotId: e.target.value })}
              >
                <option value="">Any robot (choose at start)</option>
                {robots.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        {/* Checkpoints */}
        <section className={PATROL_PANEL}>
          <SectionHeader
            as="h3"
            title="Checkpoints"
            count={draft.checkpoints.length}
            className="mb-3"
            meta={
              draft.robotId
                ? placesStatus === 'loading'
                  ? 'reading places…'
                  : placesStatus === 'error' || (placesStatus === 'ok' && placeOptions.length === 0)
                    ? 'no places from the robot — type a place id'
                    : `${placeOptions.length} places known`
                : 'pick a robot to list its places'
            }
            actions={
              draft.checkpoints.length > 1 ? (
                <button
                  type="button"
                  className={cn('text-[11px] text-theme-tertiary hover:text-theme-primary rounded px-1', PATROL_MOTION, PATROL_FOCUS)}
                  onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(draft.checkpoints.map((c) => c.id)))}
                >
                  {allCollapsed ? 'Expand all' : 'Collapse all'}
                </button>
              ) : undefined
            }
          />

          {draft.checkpoints.length === 0 && (
            <p className="card-meta text-xs mb-3">No checkpoints yet. Add places below in the order the robot should walk them.</p>
          )}

          <ol className={cn('flex flex-col gap-2', STEPPER_LINE)}>
            {draft.checkpoints.map((cp, index) => {
              const missingPlace = !cp.placeId.trim();
              const isOpen = missingPlace || !collapsed.has(cp.id);
              const detailsId = `patrol-checkpoint-details-${cp.id}`;
              return (
                <li
                  key={cp.id}
                  className={cn('flex items-start gap-3 min-w-0', PATROL_FADE_IN)}
                  data-testid="patrol-checkpoint"
                  data-index={index}
                >
                  <span className={cn(NODE, LEG_NODE.route, missingPlace && 'ring-2 ring-amber-500/50')} aria-hidden="true">
                    {index + 1}
                  </span>

                  <div
                    className={cn(
                      'glass-subtle rounded-brand p-3 flex-1 min-w-0 flex flex-col gap-2 border border-transparent',
                      PATROL_MOTION,
                      isOpen && 'border-glass-highlight',
                      missingPlace && 'border-l-[3px] border-l-amber-500'
                    )}
                  >
                    {/* summary line + rail */}
                    <div className="flex items-start gap-2 min-w-0">
                      <button
                        type="button"
                        className={cn('flex-1 min-w-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-left rounded', PATROL_FOCUS, !missingPlace && 'cursor-pointer')}
                        aria-expanded={isOpen}
                        aria-controls={detailsId}
                        aria-label={`Checkpoint ${index + 1} details`}
                        disabled={missingPlace}
                        onClick={() => toggleCollapsed(cp.id)}
                      >
                        <span className="text-sm font-medium text-theme-primary truncate max-w-full">
                          {cp.name || cp.placeId || <span className="text-theme-muted">unnamed</span>}
                        </span>
                        <span className={CHIP}>{cp.placeId || '—'}</span>
                        {cp.actions.map((a) => (
                          <span key={a} className={cn(CHIP, 'text-cobalt-700 dark:text-cobalt-300')}>
                            {a}
                            {a === 'dwell' && cp.dwellMs ? ` ${cp.dwellMs}ms` : ''}
                          </span>
                        ))}
                        {typeof cp.headingDeg === 'number' && Number.isFinite(cp.headingDeg) && <span className={CHIP}>{cp.headingDeg}°</span>}
                        {(cp.expectations ?? []).filter((e) => e.trim()).length > 0 && (
                          <span className={CHIP}>{(cp.expectations ?? []).filter((e) => e.trim()).length} expect.</span>
                        )}
                        <span className={cn('ml-auto text-theme-tertiary text-[10px]', PATROL_MOTION, isOpen && 'rotate-180')} aria-hidden="true">
                          ▼
                        </span>
                      </button>
                      <div className={cn('shrink-0 flex gap-1', isOpen ? 'flex-col sm:flex-row' : 'flex-row')}>
                        <button
                          type="button"
                          className={ICON_BTN}
                          aria-label={`Move checkpoint ${index + 1} up`}
                          data-testid="patrol-checkpoint-up"
                          disabled={index === 0}
                          onClick={() => setDraft((d) => ({ ...d, checkpoints: moveCheckpoint(d.checkpoints, index, -1) }))}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className={ICON_BTN}
                          aria-label={`Move checkpoint ${index + 1} down`}
                          data-testid="patrol-checkpoint-down"
                          disabled={index === draft.checkpoints.length - 1}
                          onClick={() => setDraft((d) => ({ ...d, checkpoints: moveCheckpoint(d.checkpoints, index, 1) }))}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          className={cn(ICON_BTN, 'text-red-600 dark:text-red-400 hover:bg-red-500/10')}
                          aria-label={`Remove checkpoint ${index + 1}`}
                          data-testid="patrol-checkpoint-remove"
                          onClick={() => setDraft((d) => ({ ...d, checkpoints: d.checkpoints.filter((_, i) => i !== index) }))}
                        >
                          ✕
                        </button>
                      </div>
                    </div>

                    {/* details — folded with `hidden`, never unmounted */}
                    <div id={detailsId} className={cn('flex flex-col gap-2 min-w-0', !isOpen && 'hidden')}>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div className="min-w-0">
                          <label className={LABEL}>Name</label>
                          <input
                            className={INPUT}
                            value={cp.name}
                            aria-label={`Checkpoint ${index + 1} name`}
                            onChange={(e) => updateCheckpoint(index, { name: e.target.value })}
                          />
                        </div>
                        <div className="min-w-0">
                          <label className={LABEL}>Place id</label>
                          <input
                            className={cn(INPUT, 'font-mono text-xs')}
                            value={cp.placeId}
                            aria-label={`Checkpoint ${index + 1} place id`}
                            aria-invalid={missingPlace || undefined}
                            list={placeOptions.length ? `patrol-places-${draft.robotId}` : undefined}
                            onChange={(e) => updateCheckpoint(index, { placeId: e.target.value })}
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end">
                        <div className="min-w-0">
                          <label className={LABEL}>Heading (°)</label>
                          <input
                            type="number"
                            className={INPUT}
                            aria-label={`Checkpoint ${index + 1} heading`}
                            placeholder="keep"
                            value={cp.headingDeg ?? ''}
                            onChange={(e) =>
                              updateCheckpoint(index, {
                                headingDeg: e.target.value === '' ? null : Number(e.target.value),
                              })
                            }
                          />
                        </div>
                        <div className="col-span-2 sm:col-span-2 min-w-0">
                          <span className={LABEL}>Actions</span>
                          <div className="flex flex-wrap gap-1.5">
                            {PatrolCheckpointActions.map((action: PatrolCheckpointAction) => {
                              const on = cp.actions.includes(action);
                              return (
                                <label key={action} className={cn(ACTION_PILL, on && ACTION_PILL_ON)}>
                                  <input
                                    type="checkbox"
                                    className="sr-only"
                                    checked={on}
                                    aria-label={`Checkpoint ${index + 1} ${action}`}
                                    onChange={() =>
                                      updateCheckpoint(index, {
                                        actions: on ? cp.actions.filter((a) => a !== action) : [...cp.actions, action],
                                      })
                                    }
                                  />
                                  <span
                                    className={cn('inline-block w-1.5 h-1.5 rounded-full', on ? 'bg-cobalt-500' : 'bg-surface-light-400 dark:bg-surface-400')}
                                    aria-hidden="true"
                                  />
                                  {action}
                                </label>
                              );
                            })}
                          </div>
                        </div>
                        <div className="min-w-0">
                          <label className={LABEL}>Dwell (ms)</label>
                          <input
                            type="number"
                            min={0}
                            step={500}
                            className={cn(INPUT, 'font-mono text-xs')}
                            aria-label={`Checkpoint ${index + 1} dwell`}
                            disabled={!cp.actions.includes('dwell')}
                            value={cp.dwellMs ?? 0}
                            onChange={(e) => updateCheckpoint(index, { dwellMs: Number(e.target.value) })}
                          />
                        </div>
                      </div>

                      <div className="min-w-0">
                        <label className={LABEL}>Expectations (one per line)</label>
                        <textarea
                          className={cn(INPUT, 'min-h-[2.5rem]')}
                          rows={2}
                          aria-label={`Checkpoint ${index + 1} expectations`}
                          placeholder="fire extinguisher on the wall left of the door"
                          value={(cp.expectations ?? []).join('\n')}
                          onChange={(e) => updateCheckpoint(index, { expectations: e.target.value.split('\n') })}
                        />
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}

            {/* ghost node: add the next checkpoint */}
            <li className="flex items-start gap-3 min-w-0">
              <span
                className={cn(NODE, 'border border-dashed border-glass-highlight text-theme-tertiary bg-[var(--glass-bg)]')}
                aria-hidden="true"
              >
                +
              </span>
              <div className="flex-1 min-w-0 border border-dashed border-glass-highlight rounded-brand p-3">
                <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
                  <div className="flex-1 min-w-0">
                    <label className={LABEL} htmlFor="patrol-place-pick">
                      Add checkpoint at
                    </label>
                    <select
                      id="patrol-place-pick"
                      data-testid="patrol-place-pick"
                      className={cn(INPUT, 'truncate')}
                      value={pickPlace}
                      onChange={(e) => setPickPlace(e.target.value)}
                    >
                      <option value="">Choose a place…</option>
                      {placeOptions.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                          {p.placeType ? ` · ${p.placeType}` : ''}
                        </option>
                      ))}
                      <option value={MANUAL}>Type a place id…</option>
                    </select>
                  </div>
                  {pickPlace === MANUAL && (
                    <div className="flex-1 min-w-0">
                      <label className={LABEL} htmlFor="patrol-place-manual">
                        Place id
                      </label>
                      <input
                        id="patrol-place-manual"
                        data-testid="patrol-place-manual"
                        className={cn(INPUT, 'font-mono text-xs')}
                        value={manualPlace}
                        placeholder="hallway"
                        onChange={(e) => setManualPlace(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            addCheckpoint();
                          }
                        }}
                      />
                    </div>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="min-h-9"
                    data-testid="patrol-checkpoint-add"
                    disabled={!pickPlace || (pickPlace === MANUAL && !manualPlace.trim())}
                    onClick={addCheckpoint}
                  >
                    Add checkpoint
                  </Button>
                </div>
              </div>
            </li>
          </ol>

          {placeOptions.length > 0 && (
            <datalist id={`patrol-places-${draft.robotId}`}>
              {placeOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </datalist>
          )}
        </section>

        {/* Schedule */}
        <section className={PATROL_PANEL}>
          <SectionHeader as="h3" title="Schedule" className="mb-3" meta={draft.cronExpression.trim() ? 'server local time' : 'manual'} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="min-w-0">
              <label className={LABEL} htmlFor="patrol-cron">
                Schedule (5-field cron, server local time)
              </label>
              <input
                id="patrol-cron"
                data-testid="patrol-cron-input"
                className={cn(INPUT, 'font-mono', cronBlocks && 'border-red-500/50 focus:ring-red-500/30')}
                value={draft.cronExpression}
                placeholder="0 22,3 * * 1-5"
                aria-invalid={cronBlocks || undefined}
                onChange={(e) => update({ cronExpression: e.target.value })}
              />
              <div className={cn('mt-1.5 text-xs min-h-[1.25rem] font-mono tabular-nums break-words')} data-testid="patrol-cron-next" aria-live="polite">
                {!draft.cronExpression.trim() ? (
                  <span className="text-theme-muted">Manual only — no schedule.</span>
                ) : cronBusy && !cron ? (
                  <span className="text-theme-muted">checking…</span>
                ) : cron && !cron.valid ? (
                  <span className="text-red-600 dark:text-red-400">{cron.error ?? 'Invalid cron expression'}</span>
                ) : cron ? (
                  <span className="text-theme-secondary">
                    Next: {cron.nextRuns.slice(0, 3).map(formatWhen).join(' · ') || '—'}
                  </span>
                ) : null}
              </div>
            </div>
            <div className="min-w-0">
              <label className={LABEL} htmlFor="patrol-home">
                Home place (return here when done)
              </label>
              <input
                id="patrol-home"
                data-testid="patrol-home-place"
                className={cn(INPUT, 'font-mono text-xs')}
                list={placeOptions.length ? `patrol-places-${draft.robotId}` : undefined}
                value={draft.homePlaceId}
                placeholder="stay at the last checkpoint"
                onChange={(e) => update({ homePlaceId: e.target.value })}
              />
              <label className="mt-3 inline-flex items-center gap-2.5 text-sm text-theme-secondary cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  data-testid="patrol-route-enabled"
                  checked={draft.enabled}
                  onChange={(e) => update({ enabled: e.target.checked })}
                />
                <span
                  className={cn(
                    'relative inline-block w-9 h-5 rounded-full shrink-0 bg-surface-light-300 dark:bg-surface-500',
                    'peer-checked:bg-cobalt-500 peer-focus-visible:ring-2 peer-focus-visible:ring-cobalt-500/40',
                    'after:absolute after:top-0.5 after:left-0.5 after:w-4 after:h-4 after:rounded-full after:bg-white after:shadow-sm',
                    'after:transition-transform after:duration-200 peer-checked:after:translate-x-4',
                    PATROL_MOTION
                  )}
                  aria-hidden="true"
                />
                Enabled (the scheduler may start it)
              </label>
            </div>
          </div>
        </section>

        {/* Time windows */}
        <section className={PATROL_PANEL}>
          <SectionHeader
            as="h3"
            title="Time windows"
            count={draft.timeWindows.length}
            className="mb-3"
            actions={
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  data-testid="patrol-windows-defaults"
                  onClick={() => update({ timeWindows: DEFAULT_TIME_WINDOWS.map((w) => ({ ...w })) })}
                >
                  Day / night defaults
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  data-testid="patrol-window-add"
                  onClick={() =>
                    update({
                      timeWindows: [...draft.timeWindows, { id: newId('w'), name: '', startHour: 0, endHour: 24 }],
                    })
                  }
                >
                  Add window
                </Button>
              </>
            }
          />
          <p className="card-meta text-xs mb-3">Baselines are kept per window: a lit lamp is normal by day and a finding at 03:00. Wraps midnight when end ≤ start.</p>

          <WindowBar windows={draft.timeWindows} className="mb-2" />
          {draft.timeWindows.length > 0 && (
            <div className="flex flex-wrap gap-x-3 gap-y-1 mb-3">
              {draft.timeWindows.map((w) => (
                <span key={w.id} className={cn(PATROL_MONO, 'inline-flex items-center gap-1.5')}>
                  <span className={cn('inline-block w-2 h-2 rounded-full', windowDot(w))} aria-hidden="true" />
                  {w.name || w.id} {formatWindow(w)}
                </span>
              ))}
            </div>
          )}
          {draft.timeWindows.length === 0 && <p className="card-meta text-xs">No windows — one baseline for the whole day.</p>}

          <div className="flex flex-col gap-1.5">
            {draft.timeWindows.map((w, index) => (
              <div key={w.id} className={cn('grid grid-cols-[1fr_4.5rem_4.5rem_1.75rem] gap-2 items-end min-w-0', PATROL_FADE_IN)} data-testid="patrol-window">
                <div className="min-w-0">
                  <label className={cn(LABEL, 'inline-flex items-center gap-1.5')}>
                    <span className={cn('inline-block w-2 h-2 rounded-full', windowDot(w))} aria-hidden="true" />
                    Name
                  </label>
                  <input
                    className={INPUT}
                    aria-label={`Window ${index + 1} name`}
                    value={w.name}
                    onChange={(e) =>
                      update({
                        timeWindows: draft.timeWindows.map((x, i) => (i === index ? { ...x, name: e.target.value } : x)),
                      })
                    }
                  />
                </div>
                <div className="min-w-0">
                  <label className={LABEL}>From</label>
                  <input
                    type="number"
                    min={0}
                    max={24}
                    className={cn(INPUT, 'font-mono text-xs')}
                    aria-label={`Window ${index + 1} start hour`}
                    value={w.startHour}
                    onChange={(e) =>
                      update({
                        timeWindows: draft.timeWindows.map((x, i) => (i === index ? { ...x, startHour: Number(e.target.value) } : x)),
                      })
                    }
                  />
                </div>
                <div className="min-w-0">
                  <label className={LABEL}>To</label>
                  <input
                    type="number"
                    min={0}
                    max={24}
                    className={cn(INPUT, 'font-mono text-xs')}
                    aria-label={`Window ${index + 1} end hour`}
                    value={w.endHour}
                    onChange={(e) =>
                      update({
                        timeWindows: draft.timeWindows.map((x, i) => (i === index ? { ...x, endHour: Number(e.target.value) } : x)),
                      })
                    }
                  />
                </div>
                <button
                  type="button"
                  className={cn(ICON_BTN, 'h-8 w-7 text-red-600 dark:text-red-400 hover:bg-red-500/10')}
                  aria-label={`Remove window ${index + 1}`}
                  onClick={() => update({ timeWindows: draft.timeWindows.filter((_, i) => i !== index) })}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* ------------------------------------------------------ right: preview */}
      <aside className={cn(PATROL_STICKY_RAIL, 'flex flex-col gap-4 min-w-0')}>
        <section className={PATROL_PANEL}>
          <SectionHeader
            as="h3"
            title="Preview"
            className="mb-3"
            actions={
              <span className={cn(PATROL_MONO, 'inline-flex items-center gap-1.5')}>
                <StatusDot tone={draft.enabled ? 'accent' : 'neutral'} />
                {draft.enabled ? 'enabled' : 'disabled'}
              </span>
            }
          />
          {previewLegs.length > 0 ? (
            <RoutePath size="md" legs={previewLegs} className="mb-3" />
          ) : (
            <p className="card-meta text-xs mb-3">Add checkpoints to see the path.</p>
          )}
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5">
            <Fact label="Robot">{robotLabel}</Fact>
            <Fact label="Legs">{draft.checkpoints.length}</Fact>
            <Fact label="Schedule">{draft.cronExpression.trim() || 'manual'}</Fact>
            <Fact label="Next">
              {!draft.cronExpression.trim() ? (
                '—'
              ) : cronBusy && !cron ? (
                'checking…'
              ) : cron && !cron.valid ? (
                <span className="text-red-600 dark:text-red-400">invalid schedule</span>
              ) : (
                nextFires ?? '—'
              )}
            </Fact>
            <Fact label="Home">{draft.homePlaceId.trim() || 'last checkpoint'}</Fact>
            <Fact label="Windows">
              <WindowBar windows={draft.timeWindows} size="sm" className="mt-1" />
              <span className="block mt-1">
                {draft.timeWindows.length ? draft.timeWindows.map((w) => `${w.name || w.id} ${formatWindow(w)}`).join(' · ') : 'whole day'}
              </span>
            </Fact>
          </dl>
        </section>

        {/* save bar — fixed to the bottom on small screens */}
        <div
          className={cn(
            'fixed bottom-0 inset-x-0 z-20 glass-elevated rounded-none border-t border-glass p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]',
            'lg:static lg:z-auto lg:rounded-brand-lg lg:border-t-0 lg:p-4',
            'flex flex-col gap-2 min-w-0'
          )}
        >
          {(problems.length > 0 || saveError || exportNote) && (
            <ul
              className="text-xs text-amber-700 dark:text-amber-400 list-disc pl-4 max-h-24 overflow-y-auto"
              role="status"
              data-testid="patrol-editor-problems"
            >
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
              {saveError && <li className="text-red-600 dark:text-red-400">{saveError}</li>}
              {exportNote && <li className="text-red-600 dark:text-red-400">{exportNote}</li>}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-2 justify-end">
            {route && onDelete && (
              <Button
                size="sm"
                variant="ghost"
                className="mr-auto min-h-9 text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"
                data-testid="patrol-route-delete"
                onClick={() => onDelete(route)}
              >
                Delete route
              </Button>
            )}
            {route && (
              <Button size="sm" variant="outline" className="min-h-9" data-testid="patrol-export-vda5050" onClick={() => void handleExport()}>
                Export VDA5050
              </Button>
            )}
            {onCancel && (
              <Button size="sm" variant="ghost" className="min-h-9" onClick={onCancel}>
                Cancel
              </Button>
            )}
            <Button
              size="sm"
              variant="primary"
              className={cn('min-h-9', PATROL_MOTION, 'hover:shadow-[0_0_20px_-4px_color-mix(in_srgb,var(--color-primary)_45%,transparent)]')}
              data-testid="patrol-route-save"
              isLoading={saving}
              disabled={saving || problems.length > 0 || cronBlocks}
              onClick={() => void handleSave()}
            >
              {route ? 'Save route' : 'Create route'}
            </Button>
          </div>
        </div>
      </aside>
    </div>
  );
});
