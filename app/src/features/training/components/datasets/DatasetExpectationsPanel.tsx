/**
 * @file DatasetExpectationsPanel.tsx
 * @description Observed vs expected state/action widths, the robot type a dataset is checked against, and the
 *              controls to change it, define a new configuration, and revalidate the stored files (TASK-353).
 *              One summary line by default, whatever the verdict, so the episode browser stays on the
 *              first screen (TASK-363).
 * @feature training
 */

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { AlertTriangle, CheckCircle2, ChevronUp, RefreshCw } from 'lucide-react';
import {
  Button,
  FormField,
  Input,
  Panel,
  Select,
  StatusTag,
  errorMessage,
  toast,
} from '@/shared/components/ui';
import { formatDateTime } from '@/shared/utils/format';
import { trainingApi } from '../../api/trainingApi';
import { datasetShape } from '../../types';
import { robotTypeLabel } from './datasetFormat';
import type { Dataset, RobotType } from '../../types';

/** How often a running validation pass is asked where it is. */
export const EXPECTATIONS_POLL_MS = 2000;

/**
 * How many times it is asked before the panel stops waiting and unlocks. A row
 * left `validating` by a pass that died would otherwise lock every control on
 * this panel — including the one that fixes it — for ever.
 */
export const EXPECTATIONS_MAX_POLLS = 90;

export interface DatasetExpectationsPanelProps {
  dataset: Dataset;
  /** Called with the dataset as the server now has it. */
  onDatasetChange: (dataset: Dataset) => void;
}

/** Statuses another flow owns. `validating` is NOT here: see `watching`. */
const LOCKED_STATUSES = new Set(['importing', 'uploading']);

/** A stored robot-type name for display; `null` means the dataset had none. */
function nameLabel(name: string | null | undefined): string {
  return name == null ? 'none' : robotTypeLabel({ name });
}

function widthLabel(width: number | null | undefined): string {
  return typeof width === 'number' && width > 0 ? String(width) : '—';
}

export function DatasetExpectationsPanel({ dataset, onDatasetChange }: DatasetExpectationsPanelProps) {
  const [robotTypes, setRobotTypes] = useState<RobotType[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [creating, setCreating] = useState(false);
  const shape = useMemo(() => datasetShape(dataset), [dataset]);
  const validation = dataset.validation;

  // Observed = what the parquet holds; falls back to what info.json declares
  // when nothing has opened the files yet, and says which it is.
  const observedState = validation?.observedStateWidth ?? shape.stateWidth;
  const observedAction = validation?.observedActionWidth ?? shape.actionWidth;
  const observedSource = validation?.observedStateWidth != null ? 'parquet' : 'info.json';
  const expectedState = dataset.robotType?.proprioceptionDim;
  const expectedAction = dataset.robotType?.actionDim;

  const [form, setForm] = useState({
    name: '',
    manufacturer: '',
    model: '',
    actionDim: String(observedAction ?? ''),
    proprioceptionDim: String(observedState ?? ''),
  });

  // Watching = a pass this panel knows is running (it started one, or the row
  // said `validating` when the page opened). Bounded, so a stuck row unlocks.
  const [watching, setWatching] = useState(dataset.status === 'validating');
  const [gaveUp, setGaveUp] = useState(false);
  // One line until asked, whatever the verdict: the episode browser below is
  // what the page is for (TASK-358 for a pass, TASK-363 for every other state).
  const [expanded, setExpanded] = useState(false);
  // Set the moment "Revalidate" is clicked, before the server has answered.
  const [revalidating, setRevalidating] = useState(false);
  const locked = LOCKED_STATUSES.has(dataset.status);
  const busy = locked || watching || pending;
  // A revalidation leaves a `ready` or `failed` row alone until the verdict
  // lands, so the row's status alone would read "Ready" for the whole pass.
  const shownStatus = watching || revalidating ? 'validating' : dataset.status;

  useEffect(() => {
    let cancelled = false;
    trainingApi.listRobotTypes()
      .then((list) => { if (!cancelled) setRobotTypes(Array.isArray(list) ? list : []); })
      .catch(() => { if (!cancelled) setRobotTypes([]); });
    return () => { cancelled = true; };
  }, []);

  // Ask the pass, not the row: a revalidation of a `failed` or `ready` row
  // leaves the row alone until the verdict lands, so polling the row's status
  // never saw it. Once the pass reports anything but `validating`, re-read the
  // dataset for the verdict and stop.
  useEffect(() => {
    if (!watching) return;
    let polls = 0;
    let stopped = false;
    const finish = (timedOut: boolean) => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      setWatching(false);
      setGaveUp(timedOut);
      trainingApi.getDataset(dataset.id).then(onDatasetChange).catch(() => undefined);
    };
    const timer = setInterval(() => {
      polls += 1;
      trainingApi.getValidationProgress(dataset.id)
        .then((p) => {
          if (p.status !== 'validating') finish(false);
          else if (polls >= EXPECTATIONS_MAX_POLLS) finish(true);
        })
        .catch(() => { if (polls >= EXPECTATIONS_MAX_POLLS) finish(true); });
    }, EXPECTATIONS_POLL_MS);
    return () => { stopped = true; clearInterval(timer); };
  }, [watching, dataset.id, onDatasetChange]);

  // Types whose widths fit the files first: those are the plausible choices.
  const options = robotTypes
    .filter((rt) => rt.id !== dataset.robotTypeId)
    .map((rt) => ({ rt, fits: rt.proprioceptionDim === observedState && rt.actionDim === observedAction }))
    .sort((a, b) => Number(b.fits) - Number(a.fits) || robotTypeLabel(a.rt).localeCompare(robotTypeLabel(b.rt)))
    .map(({ rt, fits }) => ({
      value: rt.id,
      label: `${robotTypeLabel(rt)} — state ${widthLabel(rt.proprioceptionDim)}, action ${widthLabel(rt.actionDim)}${fits ? ' (widths match)' : ''}`,
    }));

  const reassociate = async () => {
    if (!selectedId) return;
    setPending(true);
    try {
      const result = await trainingApi.reassociateRobotType(dataset.id, selectedId, reason || undefined);
      onDatasetChange(result.dataset);
      if (result.revalidation === 'started' || result.revalidation === 'queued') {
        setGaveUp(false);
        setWatching(true);
      }
      setSelectedId('');
      setReason('');
      toast.success(
        result.revalidation === 'store-unavailable'
          ? 'Robot type changed — storage is unreachable, revalidate once it is back'
          : 'Robot type changed — revalidating the stored files',
      );
    } catch (err) {
      toast.error(errorMessage(err, 'Could not change the robot type'));
    } finally {
      setPending(false);
    }
  };

  const revalidate = async () => {
    setPending(true);
    setRevalidating(true);
    try {
      await trainingApi.revalidateDataset(dataset.id);
      toast.success('Revalidating the files already in storage');
      setGaveUp(false);
      setWatching(true);
    } catch (err) {
      toast.error(errorMessage(err, 'Could not start revalidation'));
    } finally {
      setPending(false);
      setRevalidating(false);
    }
  };

  const createType = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    try {
      const created = await trainingApi.createRobotType({
        name: form.name.trim(),
        manufacturer: form.manufacturer.trim() || undefined,
        model: form.model.trim() || undefined,
        actionDim: Number(form.actionDim),
        proprioceptionDim: Number(form.proprioceptionDim),
      });
      setRobotTypes((list) => [...list, created]);
      setSelectedId(created.id);
      setCreating(false);
      toast.success(`Created ${created.name} — select it and change the robot type`);
    } catch (err) {
      toast.error(errorMessage(err, 'Could not create the robot configuration'));
    } finally {
      setPending(false);
    }
  };

  const invalidated = dataset.expectations?.invalidated ?? null;
  const history = dataset.expectations?.history ?? [];
  const mismatch = (observed: number | null | undefined, expected: number | undefined) =>
    typeof observed === 'number' && typeof expected === 'number' && expected > 0 && observed !== expected;
  const passes = dataset.status === 'ready'
    && validation?.valid === true
    && Boolean(dataset.robotType)
    && !mismatch(observedState, expectedState)
    && !mismatch(observedAction, expectedAction);

  if (!expanded) {
    const anyMismatch = mismatch(observedState, expectedState) || mismatch(observedAction, expectedAction);
    const typeName = <span className="font-medium text-ink-primary">{robotTypeLabel(dataset.robotType)}</span>;
    const widths = (observed: number | null | undefined, expected: number | undefined) => (
      mismatch(observed, expected) ? `${widthLabel(observed)} (expects ${widthLabel(expected)})` : widthLabel(observed)
    );
    const failing = anyMismatch || dataset.status === 'failed';
    const lead = shownStatus === 'validating' ? 'Validating against'
      : passes ? 'Matches'
        : anyMismatch ? 'Does not match'
          : dataset.status === 'failed' ? 'Failed validation against'
            : 'Checked against';
    return (
      <Panel data-testid="dataset-expectations" data-collapsed="true" padding="sm">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
          {shownStatus === 'validating' ? (
            <RefreshCw className="h-4 w-4 shrink-0 animate-spin text-ink-tertiary" strokeWidth={1.75} aria-hidden />
          ) : passes ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-signal-measured" strokeWidth={1.75} aria-hidden />
          ) : failing ? (
            <AlertTriangle className="h-4 w-4 shrink-0 text-signal-stopped" strokeWidth={1.75} aria-hidden />
          ) : null}
          <p className="min-w-0 flex-1 text-ink-secondary" data-testid="expectations-summary">
            {lead} {typeName}
            {' '}— state {widths(observedState, expectedState)}, action {widths(observedAction, expectedAction)}
            {gaveUp && <span className="ml-2 text-xs text-ink-tertiary">· no verdict reported, revalidate to try again</span>}
          </p>
          <StatusTag status={shownStatus} dot data-testid="expectations-status" />
          <Button variant="ghost" size="sm" onClick={() => setExpanded(true)} data-testid="expectations-expand">
            Change robot type
          </Button>
        </div>
      </Panel>
    );
  }

  return (
    <Panel data-testid="dataset-expectations">
      <Panel.Header
        title="Robot and schema expectations"
        description="What the files hold, beside what the selected robot type expects. Changing the robot type never rewrites the data."
        actions={(
          <>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<RefreshCw className="h-4 w-4" strokeWidth={1.75} />}
              disabled={busy}
              onClick={revalidate}
              data-testid="revalidate-button"
            >
              Revalidate existing files
            </Button>
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<ChevronUp className="h-4 w-4" strokeWidth={1.75} />}
              onClick={() => { setExpanded(false); setCreating(false); }}
              data-testid="expectations-collapse"
            >
              Hide
            </Button>
          </>
        )}
      />
      <Panel.Body className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-ink-secondary">Selected robot type:</span>
          <span className="font-medium text-ink-primary" data-testid="selected-robot-type">
            {robotTypeLabel(dataset.robotType)}
          </span>
          <StatusTag status={shownStatus} dot data-testid="selected-robot-type-status" />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="width-table">
            <thead>
              <tr className="text-left text-xs text-ink-tertiary">
                <th className="py-1 pr-4 font-medium">Vector</th>
                <th className="py-1 pr-4 font-medium">Observed ({observedSource})</th>
                <th className="py-1 pr-4 font-medium">Expected by robot type</th>
              </tr>
            </thead>
            <tbody>
              {([
                ['observation.state', observedState, expectedState, 'state'],
                ['action', observedAction, expectedAction, 'action'],
              ] as const).map(([label, observed, expected, key]) => (
                <tr key={key} data-testid={`width-row-${key}`}>
                  <td className="py-1 pr-4 font-mono text-xs">{label}</td>
                  <td className="py-1 pr-4">{widthLabel(observed)}</td>
                  <td className={`py-1 pr-4 ${mismatch(observed, expected) ? 'font-medium text-signal-stopped' : ''}`}>
                    {widthLabel(expected)}
                    {mismatch(observed, expected) && <span className="ml-2 text-xs">mismatch</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-xs text-ink-tertiary">
            Widths are the dataset&apos;s observed schema, not proof that two robots are interchangeable.
          </p>
        </div>

        {invalidated && (
          <p className="text-sm text-ink-secondary" data-testid="verdict-invalidated">
            The previous verdict was voided when the robot type changed from{' '}
            {nameLabel(invalidated.fromRobotTypeName)} to {nameLabel(invalidated.toRobotTypeName)}.{' '}
            {shownStatus === 'validating' ? 'Revalidating the stored files…' : 'Revalidate to get a new verdict.'}
          </p>
        )}

        <div className="flex flex-col gap-3">
          <FormField label="Change robot type" hint="The old verdict is voided and the stored files are revalidated. Nothing is downloaded.">
            <Select
              aria-label="Robot type"
              placeholder="Choose a robot type…"
              options={options}
              value={selectedId}
              disabled={busy}
              onChange={(e) => setSelectedId(e.target.value)}
            />
          </FormField>
          <FormField label="Reason" aside="Optional">
            <Input value={reason} disabled={busy} onChange={(e) => setReason(e.target.value)} placeholder="Why the expectation changes" />
          </FormField>
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || !selectedId} onClick={reassociate} data-testid="reassociate-button">
              Change and revalidate
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setCreating((v) => !v)}>
              {creating ? 'Cancel new configuration' : 'Define a new robot configuration'}
            </Button>
          </div>
          {locked && (
            <p className="text-xs text-ink-tertiary">Locked while the dataset is {dataset.status}.</p>
          )}
          {watching && !locked && (
            <p className="text-xs text-ink-tertiary" data-testid="validation-running">Validating the stored files…</p>
          )}
          {gaveUp && (
            <p className="text-xs text-ink-tertiary" data-testid="validation-gave-up">
              The validation did not report a verdict. Revalidate to try again.
            </p>
          )}
          {dataset.expectations?.error && dataset.status === 'failed' && (
            <p className="text-xs text-signal-stopped" data-testid="validation-error">{dataset.expectations.error}</p>
          )}
        </div>

        {creating && (
          <form className="flex flex-col gap-3 rounded-md border border-line p-3" onSubmit={createType} data-testid="new-robot-type-form">
            <p className="text-xs text-ink-tertiary">
              Creates a new robot type. Existing types are never changed — other datasets are validated against them.
              The standard embodiments (G1 EDU + Dex3-1, G1 arms + hands, SO-101) are already in the list above.
            </p>
            <FormField label="Name" required>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </FormField>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField label="Manufacturer">
                <Input value={form.manufacturer} onChange={(e) => setForm({ ...form, manufacturer: e.target.value })} />
              </FormField>
              <FormField label="Model">
                <Input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
              </FormField>
              <FormField label="State width (proprioceptionDim)" required>
                <Input type="number" min={1} value={form.proprioceptionDim} onChange={(e) => setForm({ ...form, proprioceptionDim: e.target.value })} />
              </FormField>
              <FormField label="Action width (actionDim)" required>
                <Input type="number" min={1} value={form.actionDim} onChange={(e) => setForm({ ...form, actionDim: e.target.value })} />
              </FormField>
            </div>
            <div>
              <Button type="submit" disabled={pending || !form.name.trim()}>Create configuration</Button>
            </div>
          </form>
        )}

        {history.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium text-ink-tertiary">History</p>
            <ul className="flex flex-col gap-1 text-xs text-ink-secondary" data-testid="expectation-history">
              {history.map((h) => (
                <li key={h.at}>
                  {formatDateTime(h.at)} · {nameLabel(h.fromRobotTypeName)} → {nameLabel(h.toRobotTypeName)}
                  {h.previousValid === false ? ' (previous verdict: failed)' : h.previousValid ? ' (previous verdict: passed)' : ''}
                  {h.reason ? ` · ${h.reason}` : ''}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Panel.Body>
    </Panel>
  );
}
