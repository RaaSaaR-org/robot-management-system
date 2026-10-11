/**
 * @file DatasetExpectationsPanel.tsx
 * @description Observed vs expected state/action widths, the robot type a dataset is checked against, and the
 *              controls to change it, define a new configuration, and revalidate the stored files (TASK-353)
 * @feature training
 */

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { RefreshCw } from 'lucide-react';
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
import { trainingApi } from '../../api/trainingApi';
import { datasetShape } from '../../types';
import type { Dataset, RobotType } from '../../types';

/** How often a running validation pass is asked where it is. */
export const EXPECTATIONS_POLL_MS = 2000;

/**
 * How many times it is asked before the panel stops waiting and unlocks. A row
 * left `validating` by a pass that died would otherwise lock every control on
 * this panel — including the one that fixes it — for ever.
 */
export const EXPECTATIONS_MAX_POLLS = 90;

/**
 * The 43-DOF G1 configuration the production case needed (G1 EDU + Dex3-1 hands).
 * A preset, not a guess: the operator still sees and can edit every field.
 */
export const G1_EDU_DEX3_PRESET = {
  name: 'Unitree G1 EDU (Dex3-1)',
  manufacturer: 'Unitree',
  model: 'unitree_g1_edu_dex3',
  actionDim: 43,
  proprioceptionDim: 43,
};

export interface DatasetExpectationsPanelProps {
  dataset: Dataset;
  /** Called with the dataset as the server now has it. */
  onDatasetChange: (dataset: Dataset) => void;
}

/** Statuses another flow owns. `validating` is NOT here: see `watching`. */
const LOCKED_STATUSES = new Set(['importing', 'uploading']);

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
  const locked = LOCKED_STATUSES.has(dataset.status);
  const busy = locked || watching || pending;

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

  const options = robotTypes
    .filter((rt) => rt.id !== dataset.robotTypeId)
    .map((rt) => {
      const fits = rt.proprioceptionDim === observedState && rt.actionDim === observedAction;
      return {
        value: rt.id,
        label: `${rt.name} — state ${widthLabel(rt.proprioceptionDim)}, action ${widthLabel(rt.actionDim)}${fits ? ' (widths match)' : ''}`,
      };
    });

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
    try {
      await trainingApi.revalidateDataset(dataset.id);
      toast.success('Revalidating the files already in storage');
      setGaveUp(false);
      setWatching(true);
    } catch (err) {
      toast.error(errorMessage(err, 'Could not start revalidation'));
    } finally {
      setPending(false);
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

  return (
    <Panel data-testid="dataset-expectations">
      <Panel.Header
        title="Robot and schema expectations"
        description="What the files hold, beside what the selected robot type expects. Changing the robot type never rewrites the data."
        actions={(
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
        )}
      />
      <Panel.Body className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-ink-secondary">Selected robot type:</span>
          <span className="font-medium text-ink-primary" data-testid="selected-robot-type">
            {dataset.robotType?.name ?? 'none'}
          </span>
          <StatusTag status={dataset.status} dot />
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
            {invalidated.fromRobotTypeName ?? 'none'} to {invalidated.toRobotTypeName}.{' '}
            {dataset.status === 'validating' ? 'Revalidating the stored files…' : 'Revalidate to get a new verdict.'}
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
            </p>
            <div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setForm({
                  ...G1_EDU_DEX3_PRESET,
                  actionDim: String(G1_EDU_DEX3_PRESET.actionDim),
                  proprioceptionDim: String(G1_EDU_DEX3_PRESET.proprioceptionDim),
                })}
              >
                Use G1 EDU + Dex3-1 (43 DOF) preset
              </Button>
            </div>
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
                  {new Date(h.at).toLocaleString()} · {h.fromRobotTypeName ?? 'none'} → {h.toRobotTypeName}
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
