/**
 * @file ImportActivity.tsx
 * @description Background dataset imports in the top bar (TASK-352): a button
 *              that counts what is running, and a panel with each import's
 *              phase, progress, live log and — when it ends — the outcome and
 *              the reason. Nothing renders while nothing is tracked.
 * @feature training
 */

import { useEffect, useRef, useState } from 'react';
import { Ban, CheckCircle2, ChevronDown, ChevronRight, Download, Loader2, RotateCw, Square, X, XCircle } from 'lucide-react';
import { Button, ConfirmDialog, StatusTag, Tooltip } from '@/shared/components/ui';
import { toast } from '@/shared/components/ui/toast';
import { getErrorMessage } from '@/shared/utils';
import { cn } from '@/shared/utils/cn';
import { formatDateTime } from '@/shared/utils/format';
import { selectRunningCount, useImportJobsStore, type ImportJob } from '../store/importJobsStore';
import { useTrainingStore } from '../store/trainingStore';
import { ImportProgress } from './ImportProgress';
import { describeImportFailure, formatLerobotVersion, shortRevision } from './datasets/importFormat';

// ============================================================================
// HELPERS
// ============================================================================

const PHASE_LABEL: Record<NonNullable<ImportJob['phase']>, string> = {
  metadata: 'Reading metadata',
  downloading: 'Downloading',
  storing: 'Storing',
  validating: 'Validating',
};

/** "Downloading 12 / 40 files" — the one line that says where it is. */
export function describeJob(job: ImportJob): string {
  if (job.state === 'succeeded') return 'Imported';
  if (job.state === 'failed') return 'Failed';
  if (job.state === 'cancelled') return 'Cancelled';
  const phase = job.phase ? PHASE_LABEL[job.phase] : 'Starting';
  if (job.phase === 'downloading' && job.totalFiles) {
    return `${phase} ${job.completedFiles ?? 0} / ${job.totalFiles} files`;
  }
  return phase;
}

const STATE_TAG: Record<ImportJob['state'], { tone: 'success' | 'danger' | 'info' | 'neutral'; label: string }> = {
  running: { tone: 'info', label: 'Running' },
  succeeded: { tone: 'success', label: 'Done' },
  failed: { tone: 'danger', label: 'Failed' },
  cancelled: { tone: 'neutral', label: 'Cancelled' },
};

function timeOf(iso: string): string {
  return Number.isNaN(new Date(iso).getTime())
    ? ''
    : formatDateTime(iso, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ============================================================================
// BUTTON + PANEL
// ============================================================================

export function ImportActivity() {
  const order = useImportJobsStore((state) => state.order);
  const running = useImportJobsStore(selectRunningCount);
  const panelOpen = useImportJobsStore((state) => state.panelOpen);
  const togglePanel = useImportJobsStore((state) => state.togglePanel);
  const closePanel = useImportJobsStore((state) => state.closePanel);
  const rootRef = useRef<HTMLDivElement>(null);

  // Outside click and Escape close it; it is a glance, not a dialog. A
  // confirmation asked from inside it (cancel, TASK-378) renders in a portal,
  // so clicks and Escape that belong to that dialog must leave the panel open.
  useEffect(() => {
    if (!panelOpen) return;
    const confirmOpen = () => document.querySelector('[role="alertdialog"]') !== null;
    const onPointer = (event: PointerEvent) => {
      if (confirmOpen()) return;
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) closePanel();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !confirmOpen()) closePanel();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [panelOpen, closePanel]);

  if (order.length === 0) return null;

  const label = running > 0 ? `${running} dataset import${running === 1 ? '' : 's'} running` : 'Dataset imports';

  return (
    <div ref={rootRef} className="relative">
      <Button
        variant="ghost"
        onClick={togglePanel}
        title={label}
        aria-label={label}
        aria-expanded={panelOpen}
        aria-haspopup="dialog"
        className="px-2"
        data-testid="import-activity-button"
      >
        {running > 0
          ? <Loader2 className="h-5 w-5 animate-spin" strokeWidth={1.75} />
          : <Download className="h-5 w-5" strokeWidth={1.75} />}
        {running > 0 && (
          <span className="rounded-tag bg-primary px-1.5 text-[11px] font-medium text-on-primary">{running}</span>
        )}
      </Button>
      {panelOpen && <ImportActivityPanel />}
    </div>
  );
}

export function ImportActivityPanel() {
  const order = useImportJobsStore((state) => state.order);
  const jobs = useImportJobsStore((state) => state.jobs);
  const clearFinished = useImportJobsStore((state) => state.clearFinished);
  const hasFinished = order.some((id) => jobs[id] && jobs[id].state !== 'running');

  return (
    <div
      role="dialog"
      aria-label="Dataset imports"
      data-testid="import-activity-panel"
      className={cn(
        // A phone's top bar puts the button mid-screen, so there the panel spans
        // the width under the bar instead of hanging off its left edge.
        'fixed inset-x-4 top-14 z-[60] flex max-h-[70vh] flex-col',
        'sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[30rem]',
        'rounded-control border border-line-strong bg-raised shadow-[0_12px_32px_rgba(0,0,0,0.4)]',
      )}
    >
      <div className="flex items-center justify-between border-b border-line-subtle px-3 py-2">
        <span className="text-sm font-medium text-ink-primary">Dataset imports</span>
        {hasFinished && (
          <Button size="sm" variant="ghost" onClick={clearFinished}>Clear finished</Button>
        )}
      </div>
      <ul className="flex flex-col divide-y divide-line-subtle overflow-y-auto">
        {order.map((id) => jobs[id] && <ImportJobRow key={id} job={jobs[id]} />)}
      </ul>
    </div>
  );
}

// ============================================================================
// ONE IMPORT
// ============================================================================

function ImportJobRow({ job }: { job: ImportJob }) {
  const focusedId = useImportJobsStore((state) => state.focusedId);
  const focus = useImportJobsStore((state) => state.focus);
  const dismiss = useImportJobsStore((state) => state.dismiss);
  const expanded = focusedId === job.datasetId;
  const Chevron = expanded ? ChevronDown : ChevronRight;
  const rev = shortRevision(job.revision);
  const version = formatLerobotVersion(job.lerobotVersion);
  const failure = job.state === 'failed' && job.error ? describeImportFailure(job.error, job.phase) : null;

  return (
    <li className="flex flex-col gap-2 px-3 py-3" data-testid={`import-job-${job.datasetId}`}>
      <div className="flex items-start gap-2">
        <StateIcon job={job} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink-primary" title={job.revision ? `${job.label}@${job.revision}` : job.label}>
            {job.label}
            {rev && <span data-testid="import-job-revision" className="font-mono text-xs font-normal text-ink-tertiary">@{rev}</span>}
          </p>
          <p className="text-xs text-ink-tertiary">
            {describeJob(job)}
            {version && <span data-testid="import-job-version"> · {version}</span>}
          </p>
        </div>
        <StatusTag size="sm" tone={STATE_TAG[job.state].tone} pulse={job.state === 'running'} dot>
          {STATE_TAG[job.state].label}
        </StatusTag>
        {job.state === 'running' && <CancelButton job={job} />}
        {job.state !== 'running' && (
          <Button
            size="sm"
            variant="ghost"
            iconOnly
            aria-label={`Dismiss ${job.label}`}
            title="Dismiss"
            onClick={() => dismiss(job.datasetId)}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {(job.state === 'running' || job.state === 'failed') && (
        <div className="flex flex-col gap-1">
          <ImportProgress job={job} />
          {job.state === 'running' && job.phase === 'downloading' && job.currentFile && (
            <p className="truncate font-mono text-[11px] text-ink-tertiary" title={job.currentFile}>{job.currentFile}</p>
          )}
        </div>
      )}

      {job.state === 'cancelled' && <RetryButton job={job} />}

      {failure && (
        <div className="flex flex-col gap-2">
          {/* The cause first; the server's full sentence, file name and all, on hover. */}
          <Tooltip content={failure.detail}>
            <p
              role="alert"
              tabIndex={0}
              data-testid="import-job-error"
              className="break-words rounded-control bg-inset px-2 py-1.5 text-xs font-medium text-ink-primary"
            >
              {failure.headline}
            </p>
          </Tooltip>
          <RetryButton job={job} />
        </div>
      )}

      <button
        type="button"
        onClick={() => focus(expanded ? null : job.datasetId)}
        aria-expanded={expanded}
        className="flex items-center gap-1 self-start text-xs text-ink-secondary hover:text-ink-primary"
      >
        <Chevron className="h-3.5 w-3.5" />
        {expanded ? 'Hide log' : job.lines.length > 0 ? `Show log (${job.lines.length})` : 'Show log'}
      </button>
      {expanded && <ImportLog job={job} />}
    </li>
  );
}

/**
 * Stop a running import (TASK-371). Not offered once it is validating: every
 * file is stored by then and the server refuses, so the button would only
 * ever say no. A cancel deletes what was downloaded, so it asks first
 * (TASK-378) — one misclick must not throw away a long download.
 */
function CancelButton({ job }: { job: ImportJob }) {
  const cancel = useImportJobsStore((state) => state.cancel);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  if (job.phase === 'validating') return null;

  const onCancel = async () => {
    setAsking(false);
    setBusy(true);
    try {
      await cancel(job.datasetId);
    } catch (error) {
      toast.error("Couldn't cancel the import", { description: getErrorMessage(error, job.label) });
      void useImportJobsStore.getState().backfill(job.datasetId);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        iconOnly
        aria-label={`Cancel ${job.label}`}
        title="Cancel import"
        isLoading={busy}
        onClick={() => setAsking(true)}
        data-testid="import-job-cancel"
      >
        <Square className="h-3.5 w-3.5" />
      </Button>
      <ConfirmDialog
        isOpen={asking}
        onClose={() => setAsking(false)}
        onConfirm={() => void onCancel()}
        title={`Cancel the import of ${job.label}?`}
        description="The files downloaded so far are discarded. Importing it again starts from the beginning."
        confirmLabel="Cancel import"
        cancelLabel="Keep importing"
        tone="danger"
        testId="import-job-cancel-confirm"
      />
    </>
  );
}

/** Start the same import again; the row keeps its pinned commit and mode. */
function RetryButton({ job }: { job: ImportJob }) {
  const track = useImportJobsStore((state) => state.track);
  const [busy, setBusy] = useState(false);
  // A dataset that is gone has nothing to retry.
  if (job.error === 'The dataset no longer exists') return null;

  const retry = async () => {
    setBusy(true);
    try {
      await useTrainingStore.getState().retryImport(job.datasetId);
      track(job.datasetId, job.label);
    } catch (error) {
      toast.error("Couldn't restart the import", { description: getErrorMessage(error, job.label) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      size="sm"
      variant="secondary"
      className="self-start"
      leftIcon={<RotateCw className="h-3.5 w-3.5" />}
      isLoading={busy}
      onClick={() => void retry()}
    >
      Retry import
    </Button>
  );
}

function StateIcon({ job }: { job: ImportJob }) {
  if (job.state === 'succeeded') return <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-signal-measured" />;
  if (job.state === 'failed') return <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-signal-stopped" />;
  if (job.state === 'cancelled') return <Ban className="mt-0.5 h-4 w-4 shrink-0 text-ink-tertiary" />;
  return <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-ink-secondary" />;
}

/** The live log, newest at the bottom, following the tail while it grows. */
function ImportLog({ job }: { job: ImportJob }) {
  const boxRef = useRef<HTMLOListElement>(null);
  const count = job.lines.length;
  const backfill = useImportJobsStore((state) => state.backfill);

  // Lines are not kept across a reload (only which imports are followed is),
  // so an empty log is fetched when it is opened.
  useEffect(() => {
    if (job.lines.length === 0) void backfill(job.datasetId);
    // Once per opening, not on every new line.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.datasetId]);

  useEffect(() => {
    const box = boxRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [count]);

  return (
    <div className="flex flex-col gap-1">
      {!job.logRetained && (
        <p className="text-xs text-ink-tertiary">
          The server restarted since this import ran, so its log is gone. The outcome above still holds.
        </p>
      )}
      {job.dropped > 0 && <p className="text-xs text-ink-tertiary">… {job.dropped} earlier lines not kept</p>}
      <ol
        ref={boxRef}
        data-testid="import-job-log"
        aria-live="polite"
        className="max-h-56 overflow-y-auto rounded-control bg-inset px-2 py-1.5 font-mono text-[11px] leading-relaxed"
      >
        {count === 0 && <li className="text-ink-tertiary">Waiting for the server…</li>}
        {job.lines.map((line, index) => (
          <li
            key={`${line.at}-${index}`}
            className={cn(
              'whitespace-pre-wrap break-all',
              line.level === 'error' ? 'text-signal-stopped' : line.level === 'warn' ? 'text-signal-estimated' : 'text-ink-secondary',
            )}
          >
            <span className="text-ink-tertiary">{timeOf(line.at)} </span>
            {line.message}
          </li>
        ))}
      </ol>
    </div>
  );
}
