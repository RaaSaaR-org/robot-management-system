/**
 * @file RouteEditor.tsx
 * @description Create/edit a patrol route as one form: Basics (name, robot,
 *              armed), Checkpoints (a vertical stepper of inset cards), Schedule
 *              (cron with server validation, home place) and Time windows, next
 *              to a sticky Preview. Problems show at their fields after a save
 *              attempt; the sticky footer holds Cancel and Save.
 * @feature patrol
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  Button,
  FormField,
  Input,
  KeyValueList,
  Panel,
  Select,
  Switch,
  toast,
} from '@/shared/components/ui';
import { useDebounce } from '@/shared/hooks/useDebounce';
import { getErrorMessage } from '@/shared/utils/error';
import type { CronValidation, PatrolCheckpoint, PatrolRoute, PatrolRouteInput, PatrolTimeWindow } from '../types/patrol.types';
import { DEFAULT_TIME_WINDOWS } from '../types/patrol.types';
import { patrolApi } from '../api/patrolApi';
import { usePatrolStore, selectPlacesForRobot } from '../store/patrolStore';
import { formatWhen, formatWindow } from '../utils/patrolFormat';
import { describeCron } from '../utils/cronText';
import { CheckpointCard } from './CheckpointCard';
import { WindowBar, windowBand } from './WindowBar';
import { RoutePath } from './opsUi';

export { windowSegments } from './WindowBar';

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
// HELPERS (pure)
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

interface FieldErrors {
  name?: string;
  checkpoints?: string;
  windows?: string;
  byCheckpoint: Record<number, string>;
}

/** Pure: sorts validateDraft's messages onto the fields they belong to. */
function fieldErrors(problems: string[]): FieldErrors {
  const out: FieldErrors = { byCheckpoint: {} };
  for (const p of problems) {
    const cp = /^Checkpoint (\d+) has no place\.$/.exec(p);
    if (cp) out.byCheckpoint[Number(cp[1]) - 1] = 'Choose or type a place.';
    else if (p.startsWith('Give the route')) out.name = p;
    else if (p.startsWith('Add at least')) out.checkpoints = p;
    else out.windows = out.windows ?? p;
  }
  return out;
}

// ============================================================================
// COMPONENT
// ============================================================================

export const RouteEditor = memo(function RouteEditor({ route, robots, defaultRobotId, onSaved, onCancel, className }: RouteEditorProps) {
  const [draft, setDraft] = useState<Draft>(() => draftFromRoute(route, defaultRobotId));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [pickPlace, setPickPlace] = useState<string>('');
  const [manualPlace, setManualPlace] = useState('');
  /** Checkpoint ids whose details are folded away (inputs stay mounted). */
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(route?.checkpoints.map((c) => c.id) ?? []));
  const formRef = useRef<HTMLFormElement>(null);

  const saveRoute = usePatrolStore((s) => s.saveRoute);
  const fetchPlaces = usePatrolStore((s) => s.fetchPlaces);
  const places = usePatrolStore(selectPlacesForRobot(draft.robotId || null));
  const placesStatus = usePatrolStore((s) => (draft.robotId ? (s.placesStatus[draft.robotId] ?? 'idle') : 'idle'));

  // Reset the draft when a different route is opened.
  useEffect(() => {
    setDraft(draftFromRoute(route, defaultRobotId));
    setCollapsed(new Set(route?.checkpoints.map((c) => c.id) ?? []));
    setSubmitted(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route?.id]);

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

  const placeName = useCallback((id: string) => places?.find((p) => p.id === id)?.name ?? id, [places]);
  const update = useCallback((patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch })), []);
  const updateCheckpoint = useCallback((index: number, patch: Partial<PatrolCheckpoint>) => {
    setDraft((d) => ({ ...d, checkpoints: d.checkpoints.map((c, i) => (i === index ? { ...c, ...patch } : c)) }));
  }, []);
  const updateWindow = useCallback((index: number, patch: Partial<PatrolTimeWindow>) => {
    setDraft((d) => ({ ...d, timeWindows: d.timeWindows.map((w, i) => (i === index ? { ...w, ...patch } : w)) }));
  }, []);

  const addCheckpoint = useCallback(() => {
    const placeId = (pickPlace === MANUAL ? manualPlace : pickPlace).trim();
    if (!placeId) return;
    const cp: PatrolCheckpoint = { id: newId('cp'), placeId, name: placeName(placeId), headingDeg: null, actions: ['capture'], dwellMs: 0, expectations: [] };
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
  const errors = useMemo(() => (submitted ? fieldErrors(problems) : { byCheckpoint: {} } as FieldErrors), [submitted, problems]);
  const cronBlocks = Boolean(draft.cronExpression.trim()) && cron !== null && !cron.valid;

  const handleSubmit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      setSubmitted(true);
      if (problems.length > 0 || cronBlocks) {
        // Focus the first field that needs attention once the errors are drawn.
        requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
        return;
      }
      setSaving(true);
      setSaveError(null);
      const saved = await saveRoute(draftToInput(draft), route?.id ?? null);
      setSaving(false);
      if (saved) {
        onSaved(saved);
        return;
      }
      const message = usePatrolStore.getState().error ?? 'Saving failed';
      setSaveError(message);
      toast.error(route ? "Couldn't update route" : "Couldn't create route", { description: message });
    },
    [problems, cronBlocks, saveRoute, draft, route, onSaved],
  );

  const placeOptions = places ?? [];
  const placesListId = placeOptions.length ? `patrol-places-${draft.robotId}` : undefined;
  const robotLabel = robots.find((r) => r.id === draft.robotId)?.name ?? (draft.robotId || 'Any robot');
  const previewLegs = useMemo(
    () => draft.checkpoints.map((c, i) => ({ index: i, label: c.name || c.placeId || '?', status: 'route' as const })),
    [draft.checkpoints],
  );
  const nextFires = cron && cron.valid ? cron.nextRuns.slice(0, 3).map(formatWhen).join(' · ') || '—' : null;
  const invalidCount = submitted
    ? Number(Boolean(errors.name)) + Number(Boolean(errors.checkpoints)) + Number(Boolean(errors.windows)) + Object.keys(errors.byCheckpoint).length + Number(cronBlocks)
    : 0;
  const cronHint = !draft.cronExpression.trim()
    ? 'Manual only — no schedule.'
    : cronBusy && !cron
      ? 'Checking…'
      : cron && cron.valid
        ? `${describeCron(draft.cronExpression) ?? 'Valid'}. Next: ${nextFires}`
        : null;
  const placesMeta = draft.robotId
    ? placesStatus === 'loading'
      ? 'Reading places…'
      : placesStatus === 'error' || (placesStatus === 'ok' && placeOptions.length === 0)
        ? 'The robot lists no places — type a place id.'
        : `${placeOptions.length} places known`
    : 'Pick a robot to list its places, or type a place id.';

  return (
    <form ref={formRef} onSubmit={(e) => void handleSubmit(e)} noValidate className={className ? `flex flex-col gap-6 ${className}` : 'flex flex-col gap-6'} data-testid="patrol-route-editor">
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3 xl:items-start">
        <div className="flex min-w-0 flex-col gap-6 xl:col-span-2">
          {/* Basics */}
          <Panel>
            <Panel.Header title="Basics" />
            <Panel.Body className="flex flex-col gap-4">
              {(invalidCount > 0 || saveError) && (
                <div className="rounded-control border border-line-subtle bg-inset px-3 py-2 text-[13px] text-signal-stopped" role="alert" data-testid="patrol-editor-problems">
                  {saveError ?? `Fix ${invalidCount} field${invalidCount === 1 ? '' : 's'} before saving.`}
                </div>
              )}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField label="Name" required error={errors.name}>
                  <Input data-testid="patrol-route-name" value={draft.name} onChange={(e) => update({ name: e.target.value })} placeholder="Night round, ground floor" />
                </FormField>
                <FormField label="Robot" hint="Any robot: you choose one when you start a run.">
                  <Select
                    data-testid="patrol-route-robot"
                    value={draft.robotId}
                    onChange={(e) => update({ robotId: e.target.value })}
                    options={[{ value: '', label: 'Any robot' }, ...robots.map((r) => ({ value: r.id, label: r.name }))]}
                  />
                </FormField>
              </div>
              <Switch
                data-testid="patrol-route-enabled"
                label="Armed"
                description="The scheduler may start this route on its own."
                checked={draft.enabled}
                onCheckedChange={(enabled) => update({ enabled })}
              />
            </Panel.Body>
          </Panel>

          {/* Checkpoints */}
          <Panel>
            <Panel.Header title="Checkpoints" description={placesMeta} />
            <Panel.Body className="flex flex-col gap-4">
              {draft.checkpoints.length === 0 && (
                <p className={errors.checkpoints ? 'text-[13px] text-signal-stopped' : 'text-[13px] text-ink-tertiary'} role={errors.checkpoints ? 'alert' : undefined}>
                  {errors.checkpoints ?? 'No checkpoints yet. Add places in the order the robot should walk them.'}
                </p>
              )}
              {draft.checkpoints.length > 0 && (
                <ol className="relative flex flex-col gap-3 before:absolute before:bottom-6 before:left-3 before:top-6 before:w-px before:bg-line">
                  {draft.checkpoints.map((cp, index) => (
                    <CheckpointCard
                      key={cp.id}
                      checkpoint={cp}
                      index={index}
                      count={draft.checkpoints.length}
                      open={!cp.placeId.trim() || !collapsed.has(cp.id)}
                      placeError={errors.byCheckpoint[index]}
                      placesListId={placesListId}
                      onToggle={() => toggleCollapsed(cp.id)}
                      onChange={(patch) => updateCheckpoint(index, patch)}
                      onMove={(delta) => setDraft((d) => ({ ...d, checkpoints: moveCheckpoint(d.checkpoints, index, delta) }))}
                      onRemove={() => setDraft((d) => ({ ...d, checkpoints: d.checkpoints.filter((_, i) => i !== index) }))}
                    />
                  ))}
                </ol>
              )}
              <div className="flex flex-col gap-3 border-t border-line-subtle pt-4 sm:flex-row sm:items-end">
                <FormField label="Add checkpoint at" className="min-w-0 flex-1">
                  <Select
                    data-testid="patrol-place-pick"
                    value={pickPlace}
                    onChange={(e) => setPickPlace(e.target.value)}
                    placeholder="Choose a place…"
                    options={[
                      ...placeOptions.map((p) => ({ value: p.id, label: `${p.name}${p.placeType ? ` · ${p.placeType}` : ''}` })),
                      { value: MANUAL, label: 'Type a place id…' },
                    ]}
                  />
                </FormField>
                {pickPlace === MANUAL && (
                  <FormField label="Place id" className="min-w-0 flex-1">
                    <Input
                      data-testid="patrol-place-manual"
                      className="font-mono"
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
                  </FormField>
                )}
                <Button
                  variant="secondary"
                  leftIcon={<Plus className="h-4 w-4" strokeWidth={1.75} />}
                  data-testid="patrol-checkpoint-add"
                  disabled={!pickPlace || (pickPlace === MANUAL && !manualPlace.trim())}
                  onClick={addCheckpoint}
                >
                  Add checkpoint
                </Button>
              </div>
              {placesListId && (
                <datalist id={placesListId}>
                  {placeOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </datalist>
              )}
            </Panel.Body>
          </Panel>

          {/* Schedule */}
          <Panel>
            <Panel.Header title="Schedule" description="Server local time. Leave empty to start the route by hand only." />
            <Panel.Body className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="Cron expression" hint={cronBlocks ? undefined : cronHint} error={cronBlocks ? (cron?.error ?? 'Invalid cron expression') : undefined}>
                <Input data-testid="patrol-cron-input" className="font-mono" value={draft.cronExpression} placeholder="0 22,3 * * 1-5" onChange={(e) => update({ cronExpression: e.target.value })} />
              </FormField>
              <FormField label="Home place" hint="Where the robot returns when done; empty stays at the last checkpoint.">
                <Input data-testid="patrol-home-place" className="font-mono" list={placesListId} value={draft.homePlaceId} placeholder="HALLWAY" onChange={(e) => update({ homePlaceId: e.target.value })} />
              </FormField>
              {/* Machine-readable line the tests read: the three next fire times, or the server's error. */}
              <p className="sr-only" data-testid="patrol-cron-next" aria-live="polite">
                {cronBlocks ? (cron?.error ?? 'Invalid cron expression') : cron?.valid ? `Next: ${nextFires}` : ''}
              </p>
            </Panel.Body>
          </Panel>

          {/* Time windows */}
          <Panel>
            <Panel.Header
              title="Time windows"
              description="Baselines are kept per window: a lit lamp is normal by day and a finding at 03:00."
              actions={
                <>
                  <Button size="sm" variant="ghost" data-testid="patrol-windows-defaults" onClick={() => update({ timeWindows: DEFAULT_TIME_WINDOWS.map((w) => ({ ...w })) })}>
                    Use day / night
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    leftIcon={<Plus className="h-4 w-4" strokeWidth={1.75} />}
                    data-testid="patrol-window-add"
                    onClick={() => update({ timeWindows: [...draft.timeWindows, { id: newId('w'), name: '', startHour: 0, endHour: 24 }] })}
                  >
                    Add window
                  </Button>
                </>
              }
            />
            <Panel.Body className="flex flex-col gap-4">
              <WindowBar windows={draft.timeWindows} />
              {errors.windows && (
                <p className="text-[13px] text-signal-stopped" role="alert">
                  {errors.windows}
                </p>
              )}
              {draft.timeWindows.length === 0 && <p className="text-[13px] text-ink-tertiary">No windows — one baseline for the whole day.</p>}
              {draft.timeWindows.map((w, index) => (
                <div key={w.id} className="grid grid-cols-[minmax(0,1fr)_5rem_5rem_auto] items-end gap-3" data-testid="patrol-window">
                  <FormField label={<span className="inline-flex items-center gap-1.5"><span className={`inline-block h-2 w-2 rounded-full ${windowBand(w)}`} aria-hidden="true" />Name</span>}>
                    <Input aria-label={`Window ${index + 1} name`} value={w.name} onChange={(e) => updateWindow(index, { name: e.target.value })} />
                  </FormField>
                  <FormField label="From">
                    <Input type="number" min={0} max={24} aria-label={`Window ${index + 1} start hour`} value={w.startHour} onChange={(e) => updateWindow(index, { startHour: Number(e.target.value) })} />
                  </FormField>
                  <FormField label="To">
                    <Input type="number" min={0} max={24} aria-label={`Window ${index + 1} end hour`} value={w.endHour} onChange={(e) => updateWindow(index, { endHour: Number(e.target.value) })} />
                  </FormField>
                  <Button variant="ghost" iconOnly aria-label={`Remove window ${index + 1}`} onClick={() => update({ timeWindows: draft.timeWindows.filter((_, i) => i !== index) })}>
                    <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                  </Button>
                </div>
              ))}
            </Panel.Body>
          </Panel>
        </div>

        {/* Preview */}
        <Panel as="aside" className="xl:sticky xl:top-20">
          <Panel.Header title="Preview" />
          <Panel.Body className="flex flex-col gap-4">
            {previewLegs.length > 0 ? (
              <RoutePath size="md" legs={previewLegs} />
            ) : (
              <p className="text-[13px] text-ink-tertiary">Add checkpoints to see the path.</p>
            )}
            <KeyValueList
              columns={1}
              items={[
                { label: 'Robot', value: robotLabel },
                { label: 'Checkpoints', value: draft.checkpoints.length },
                { label: 'Schedule', value: draft.cronExpression.trim() ? (describeCron(draft.cronExpression) ?? draft.cronExpression.trim()) : 'Manual' },
                { label: 'Next run', value: !draft.cronExpression.trim() ? '—' : cronBlocks ? 'Invalid schedule' : (nextFires ?? 'Checking…') },
                { label: 'Home', value: draft.homePlaceId.trim() || 'Last checkpoint' },
                { label: 'Windows', value: draft.timeWindows.length ? draft.timeWindows.map((w) => `${w.name || w.id} ${formatWindow(w)}`).join(' · ') : 'Whole day' },
              ]}
            />
          </Panel.Body>
        </Panel>
      </div>

      <div className="sticky bottom-0 z-10 -mx-4 flex justify-end gap-2 border-t border-line bg-canvas px-4 py-3 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" data-testid="patrol-route-save" isLoading={saving} disabled={saving || cronBlocks}>
          {route ? 'Save changes' : 'Create route'}
        </Button>
      </div>
    </form>
  );
});
