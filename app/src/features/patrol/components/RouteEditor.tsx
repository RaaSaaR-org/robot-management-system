/**
 * @file RouteEditor.tsx
 * @description Create/edit a patrol route: name, robot, ordered checkpoints
 *              (places from the robot's place graph, or a typed place id),
 *              per-checkpoint heading/actions/dwell/expectations, cron with
 *              live validation, time windows, home place, enabled, VDA5050
 *              export.
 * @feature patrol
 */

import { memo, useCallback, useEffect, useMemo, useState } from 'react';
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
import { formatWhen } from '../utils/patrolFormat';

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

const INPUT =
  'glass-subtle w-full min-w-0 px-2.5 py-1.5 text-sm text-theme-primary rounded-brand border border-glass-subtle focus:outline-none focus:ring-2 focus:ring-cobalt-500/40';
const LABEL = 'block text-xs font-medium text-theme-secondary mb-1';

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

  const saveRoute = usePatrolStore((s) => s.saveRoute);
  const fetchPlaces = usePatrolStore((s) => s.fetchPlaces);
  const places = usePatrolStore(selectPlacesForRobot(draft.robotId || null));
  const placesStatus = usePatrolStore((s) => (draft.robotId ? (s.placesStatus[draft.robotId] ?? 'idle') : 'idle'));

  // Reset the draft when a different route is opened.
  useEffect(() => {
    setDraft(draftFromRoute(route, defaultRobotId));
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

  return (
    <div className={cn('glass-card p-4 sm:p-5 flex flex-col gap-5 min-w-0', className)} data-testid="patrol-route-editor">
      {/* Basics */}
      <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
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
        <div>
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
      </section>

      {/* Checkpoints */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="card-title text-sm">Checkpoints ({draft.checkpoints.length})</h3>
          <span className="card-meta text-[11px]">
            {draft.robotId
              ? placesStatus === 'loading'
                ? 'reading places…'
                : placesStatus === 'error' || (placesStatus === 'ok' && placeOptions.length === 0)
                  ? 'no places from the robot — type a place id'
                  : `${placeOptions.length} places known`
              : 'pick a robot to list its places'}
          </span>
        </div>

        {draft.checkpoints.length === 0 && (
          <p className="card-meta text-xs">No checkpoints yet. Add places below in the order the robot should walk them.</p>
        )}

        <ol className="flex flex-col gap-2">
          {draft.checkpoints.map((cp, index) => (
            <li
              key={cp.id}
              className="glass-subtle rounded-brand p-3 flex flex-col gap-2 min-w-0"
              data-testid="patrol-checkpoint"
              data-index={index}
            >
              <div className="flex items-start gap-2 min-w-0">
                <span className="shrink-0 w-6 h-6 rounded-full bg-cobalt-500/15 text-cobalt-600 dark:text-cobalt-300 text-xs font-semibold inline-flex items-center justify-center tabular-nums">
                  {index + 1}
                </span>
                <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <label className={LABEL}>Name</label>
                    <input
                      className={INPUT}
                      value={cp.name}
                      aria-label={`Checkpoint ${index + 1} name`}
                      onChange={(e) => updateCheckpoint(index, { name: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className={LABEL}>Place id</label>
                    <input
                      className={cn(INPUT, 'font-mono text-xs')}
                      value={cp.placeId}
                      aria-label={`Checkpoint ${index + 1} place id`}
                      list={placeOptions.length ? `patrol-places-${draft.robotId}` : undefined}
                      onChange={(e) => updateCheckpoint(index, { placeId: e.target.value })}
                    />
                  </div>
                </div>
                <div className="shrink-0 flex flex-col gap-1">
                  <button
                    type="button"
                    className="glass-subtle px-2 py-0.5 text-xs rounded-brand disabled:opacity-40"
                    aria-label={`Move checkpoint ${index + 1} up`}
                    data-testid="patrol-checkpoint-up"
                    disabled={index === 0}
                    onClick={() => setDraft((d) => ({ ...d, checkpoints: moveCheckpoint(d.checkpoints, index, -1) }))}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="glass-subtle px-2 py-0.5 text-xs rounded-brand disabled:opacity-40"
                    aria-label={`Move checkpoint ${index + 1} down`}
                    data-testid="patrol-checkpoint-down"
                    disabled={index === draft.checkpoints.length - 1}
                    onClick={() => setDraft((d) => ({ ...d, checkpoints: moveCheckpoint(d.checkpoints, index, 1) }))}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="glass-subtle px-2 py-0.5 text-xs rounded-brand text-red-600 dark:text-red-400"
                    aria-label={`Remove checkpoint ${index + 1}`}
                    data-testid="patrol-checkpoint-remove"
                    onClick={() => setDraft((d) => ({ ...d, checkpoints: d.checkpoints.filter((_, i) => i !== index) }))}
                  >
                    ✕
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end">
                <div>
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
                <div className="col-span-2 sm:col-span-2">
                  <span className={LABEL}>Actions</span>
                  <div className="flex flex-wrap gap-2">
                    {PatrolCheckpointActions.map((action: PatrolCheckpointAction) => {
                      const on = cp.actions.includes(action);
                      return (
                        <label key={action} className="inline-flex items-center gap-1 text-xs text-theme-secondary">
                          <input
                            type="checkbox"
                            checked={on}
                            aria-label={`Checkpoint ${index + 1} ${action}`}
                            onChange={() =>
                              updateCheckpoint(index, {
                                actions: on ? cp.actions.filter((a) => a !== action) : [...cp.actions, action],
                              })
                            }
                          />
                          {action}
                        </label>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <label className={LABEL}>Dwell (ms)</label>
                  <input
                    type="number"
                    min={0}
                    step={500}
                    className={INPUT}
                    aria-label={`Checkpoint ${index + 1} dwell`}
                    disabled={!cp.actions.includes('dwell')}
                    value={cp.dwellMs ?? 0}
                    onChange={(e) => updateCheckpoint(index, { dwellMs: Number(e.target.value) })}
                  />
                </div>
              </div>

              <div>
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
            </li>
          ))}
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
            data-testid="patrol-checkpoint-add"
            disabled={!pickPlace || (pickPlace === MANUAL && !manualPlace.trim())}
            onClick={addCheckpoint}
          >
            Add checkpoint
          </Button>
        </div>
      </section>

      {/* Schedule */}
      <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="min-w-0">
          <label className={LABEL} htmlFor="patrol-cron">
            Schedule (5-field cron, server local time)
          </label>
          <input
            id="patrol-cron"
            data-testid="patrol-cron-input"
            className={cn(INPUT, 'font-mono')}
            value={draft.cronExpression}
            placeholder="0 22,3 * * 1-5"
            aria-invalid={cronBlocks || undefined}
            onChange={(e) => update({ cronExpression: e.target.value })}
          />
          <div className="mt-1 text-xs min-h-[1.25rem]" data-testid="patrol-cron-next" aria-live="polite">
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
          <label className="mt-2 inline-flex items-center gap-2 text-sm text-theme-secondary">
            <input
              type="checkbox"
              data-testid="patrol-route-enabled"
              checked={draft.enabled}
              onChange={(e) => update({ enabled: e.target.checked })}
            />
            Enabled (the scheduler may start it)
          </label>
        </div>
      </section>

      {/* Time windows */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="card-title text-sm">Time windows</h3>
          <div className="flex gap-1.5">
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
          </div>
        </div>
        <p className="card-meta text-xs">Baselines are kept per window: a lit lamp is normal by day and a finding at 03:00. Wraps midnight when end ≤ start.</p>
        {draft.timeWindows.length === 0 && <p className="card-meta text-xs">No windows — one baseline for the whole day.</p>}
        <div className="flex flex-col gap-1.5">
          {draft.timeWindows.map((w, index) => (
            <div key={w.id} className="grid grid-cols-[1fr_5rem_5rem_2rem] gap-2 items-end" data-testid="patrol-window">
              <div className="min-w-0">
                <label className={LABEL}>Name</label>
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
              <div>
                <label className={LABEL}>From</label>
                <input
                  type="number"
                  min={0}
                  max={24}
                  className={INPUT}
                  aria-label={`Window ${index + 1} start hour`}
                  value={w.startHour}
                  onChange={(e) =>
                    update({
                      timeWindows: draft.timeWindows.map((x, i) => (i === index ? { ...x, startHour: Number(e.target.value) } : x)),
                    })
                  }
                />
              </div>
              <div>
                <label className={LABEL}>To</label>
                <input
                  type="number"
                  min={0}
                  max={24}
                  className={INPUT}
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
                className="glass-subtle h-8 rounded-brand text-xs text-red-600 dark:text-red-400"
                aria-label={`Remove window ${index + 1}`}
                onClick={() => update({ timeWindows: draft.timeWindows.filter((_, i) => i !== index) })}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Problems + actions */}
      {(problems.length > 0 || saveError || exportNote) && (
        <ul className="text-xs text-amber-600 dark:text-amber-400 list-disc pl-4" role="status" data-testid="patrol-editor-problems">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
          {saveError && <li className="text-red-600 dark:text-red-400">{saveError}</li>}
          {exportNote && <li className="text-red-600 dark:text-red-400">{exportNote}</li>}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2 justify-end">
        {route && onDelete && (
          <Button size="sm" variant="ghost" className="mr-auto text-red-600 dark:text-red-400" data-testid="patrol-route-delete" onClick={() => onDelete(route)}>
            Delete route
          </Button>
        )}
        {route && (
          <Button size="sm" variant="outline" data-testid="patrol-export-vda5050" onClick={() => void handleExport()}>
            Export VDA5050
          </Button>
        )}
        {onCancel && (
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button
          size="sm"
          variant="primary"
          data-testid="patrol-route-save"
          isLoading={saving}
          disabled={saving || problems.length > 0 || cronBlocks}
          onClick={() => void handleSave()}
        >
          {route ? 'Save route' : 'Create route'}
        </Button>
      </div>
    </div>
  );
});
