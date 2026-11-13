/**
 * @file DatasetUploadModal.tsx
 * @description Upload a LeRobot dataset folder straight into the instance
 *              (TASK-481): pick or drop the folder, see what it holds before
 *              anything is sent, then watch it go up file by file. The upload
 *              itself runs in `datasetUploadStore`, so closing this dialog
 *              leaves it running; cancelling is a separate, confirmed button.
 * @feature training
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, FolderOpen, FolderUp, XCircle } from 'lucide-react';
import {
  Button, FormField, Input, KeyValueList, Modal, Panel, ProgressBar, Select, Spinner, Textarea, confirm, toast,
} from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import { trainingApi } from '../api';
import {
  useDatasetUploadStore, uploadPercent, uploadToastId, isSending,
  type UploadErrorView, type UploadFileProgress, type UploadJob,
} from '../store/datasetUploadStore';
import {
  entriesFromDrop, filesFromEntries, filesFromInput, inspectFolder,
  type FolderInspection, type PickedFile,
} from '../upload/lerobotFolder';
import type { RobotType } from '../types';
import { formatBytes, formatCount, formatDuration } from './datasets/datasetFormat';

export interface DatasetUploadModalProps {
  /** Robot types for the override select; fetched here when the page has none */
  robotTypes?: RobotType[];
}

/** File rows drawn at once; a dataset can hold thousands. */
const MAX_FILE_ROWS = 60;

export function DatasetUploadModal({ robotTypes = [] }: DatasetUploadModalProps) {
  const isOpen = useDatasetUploadStore((state) => state.dialogOpen);
  const job = useDatasetUploadStore((state) => state.job);
  const startError = useDatasetUploadStore((state) => state.startError);
  const closeDialog = useDatasetUploadStore((state) => state.closeDialog);
  const clearStartError = useDatasetUploadStore((state) => state.clearStartError);
  const start = useDatasetUploadStore((state) => state.start);
  const resume = useDatasetUploadStore((state) => state.resume);
  const cancel = useDatasetUploadStore((state) => state.cancel);

  const [inspection, setInspection] = useState<FolderInspection | null>(null);
  const [reading, setReading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [robotTypeId, setRobotTypeId] = useState('');
  const [nameError, setNameError] = useState<string | undefined>();
  const [fetchedTypes, setFetchedTypes] = useState<RobotType[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  /** Bumped per pick, so a slow read of an earlier folder cannot overwrite a later one. */
  const readToken = useRef(0);

  // Robot types for the override. A failure costs the override, not the
  // upload: leaving it on auto-detect is the normal path.
  useEffect(() => {
    if (!isOpen || robotTypes.length > 0 || fetchedTypes.length > 0) return;
    let cancelled = false;
    void trainingApi.listRobotTypes()
      .then((types) => { if (!cancelled) setFetchedTypes(types); })
      .catch(() => { /* the select stays on auto-detect */ });
    return () => { cancelled = true; };
  }, [isOpen, robotTypes.length, fetchedTypes.length]);
  const types = robotTypes.length > 0 ? robotTypes : fetchedTypes;

  // A fresh form every time the dialog opens with nothing running.
  useEffect(() => {
    if (!isOpen) return;
    if (useDatasetUploadStore.getState().job) return;
    readToken.current += 1;
    setInspection(null);
    setReading(false);
    setDragging(false);
    setName('');
    setDescription('');
    setRobotTypeId('');
    setNameError(undefined);
    clearStartError();
  }, [isOpen, clearStartError]);

  const take = useCallback(async (load: () => Promise<PickedFile[]> | PickedFile[]) => {
    const token = ++readToken.current;
    setReading(true);
    clearStartError();
    try {
      const found = await inspectFolder(await load());
      if (readToken.current !== token) return;
      setInspection(found);
      setName(found.problems.length === 0 ? found.rootName : '');
      setNameError(undefined);
    } catch {
      if (readToken.current !== token) return;
      setInspection({
        rootName: '', files: [], totalBytes: 0, skipped: 0, info: null,
        summary: { version: null, robotType: null, episodes: null, frames: null, fps: null, cameras: [], actionWidth: null, stateWidth: null },
        problems: ['The browser could not read this folder. Pick it with "Choose folder" instead.'],
        warnings: [],
      });
    } finally {
      if (readToken.current === token) setReading(false);
    }
  }, [clearStartError]);

  const onInputChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const list = event.target.files;
    if (list && list.length > 0) {
      const picked = filesFromInput(list);
      void take(() => picked);
    }
    // The same folder can be picked again after a fix on disk.
    event.target.value = '';
  }, [take]);

  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    setDragging(false);
    // Entries have to be taken now: the browser empties the list once the
    // handler returns.
    const entries = entriesFromDrop(event.dataTransfer);
    const fallback = filesFromInput(Array.from(event.dataTransfer?.files ?? []));
    void take(() => (entries.length > 0 ? filesFromEntries(entries) : fallback));
  }, [take]);

  const submit = useCallback(() => {
    if (!inspection || inspection.problems.length > 0) return;
    const trimmed = name.trim();
    if (!trimmed) { setNameError('Give the dataset a name.'); return; }
    if (trimmed.length > 200) { setNameError('At most 200 characters.'); return; }
    setNameError(undefined);
    void start({ name: trimmed, description: description.trim(), robotTypeId, inspection });
  }, [inspection, name, description, robotTypeId, start]);

  const askCancel = useCallback(async () => {
    const ok = await confirm({
      title: 'Cancel this upload?',
      description: 'Everything sent so far is removed from the server, and the dataset disappears from the list.',
      confirmLabel: 'Cancel upload',
      cancelLabel: 'Keep uploading',
      tone: 'danger',
      testId: 'upload-cancel-confirm',
    });
    if (ok) void cancel();
  }, [cancel]);

  const close = useCallback(() => {
    const running = useDatasetUploadStore.getState().job;
    closeDialog();
    if (isSending(running)) {
      toast.info('The upload continues in the background', {
        id: running?.datasetId ? uploadToastId(running.datasetId) : undefined,
        description: 'Keep this tab open. Progress shows in the top bar and on the dataset\'s row.',
        action: { label: 'Show', onClick: () => useDatasetUploadStore.getState().openDialog() },
      });
    }
  }, [closeDialog]);

  const active = job !== null && job.phase !== 'starting';
  const starting = job?.phase === 'starting';
  const blocked = !inspection || inspection.problems.length > 0;

  const serverSide = job?.phase === 'processing' || job?.phase === 'validating';
  const footer = active ? (
    job.phase === 'cancelling' ? undefined : serverSide ? (
      <Button variant="secondary" onClick={close}>Close</Button>
    ) : job.phase === 'failed' ? (
      <>
        <Button variant="ghost" onClick={() => void askCancel()} data-testid="upload-cancel">Cancel upload</Button>
        <Button onClick={() => void resume()} data-testid="upload-resume">Try again</Button>
      </>
    ) : (
      <>
        <Button variant="ghost" onClick={() => void askCancel()} data-testid="upload-cancel">Cancel upload</Button>
        <Button variant="secondary" onClick={close} data-testid="upload-background">Continue in background</Button>
      </>
    )
  ) : (
    <>
      <Button variant="ghost" onClick={close}>Cancel</Button>
      <Button type="submit" disabled={blocked || reading} isLoading={starting} loadingText="Starting…" data-testid="upload-start">
        {inspection && !blocked ? `Upload ${formatBytes(inspection.totalBytes)}` : 'Upload'}
      </Button>
    </>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title="Upload dataset"
      description={active
        ? undefined
        : 'Pick a LeRobot dataset folder on this computer, check what it holds, then upload it.'}
      size="lg"
      closeOnBackdrop={false}
      onSubmit={active ? undefined : () => submit()}
      noValidate
      footer={footer}
      testId="dataset-upload-modal"
    >
      {active ? (
        <UploadRun job={job} />
      ) : (
        <div className="flex flex-col gap-4">
          {/* `webkitdirectory` is what makes it a folder picker — in Chrome, Edge, Firefox and Safari alike. */}
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            data-testid="upload-folder-input"
            onChange={onInputChange}
            {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
          />

          {!inspection ? (
            <div
              data-testid="upload-dropzone"
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={(e) => { e.preventDefault(); setDragging(false); }}
              onDrop={onDrop}
              className={cn(
                'flex flex-col items-center gap-2 rounded-panel border-2 border-dashed px-6 py-10 text-center transition-colors duration-150',
                dragging ? 'border-primary bg-primary/10' : 'border-line',
              )}
            >
              {reading ? (
                <>
                  <Spinner size="lg" color="primary" />
                  <p className="text-sm text-ink-secondary">Reading the folder…</p>
                </>
              ) : (
                <>
                  <FolderUp className="h-7 w-7 text-ink-tertiary" strokeWidth={1.75} aria-hidden />
                  <p className="text-sm font-medium text-ink-primary">Drop a LeRobot dataset folder here</p>
                  <p className="text-xs text-ink-tertiary">The folder that contains meta/ and data/. Nothing is sent until you press Upload.</p>
                  <Button
                    variant="secondary"
                    className="mt-2"
                    leftIcon={<FolderOpen className="h-4 w-4" />}
                    onClick={() => inputRef.current?.click()}
                    data-autofocus
                  >
                    Choose folder
                  </Button>
                </>
              )}
            </div>
          ) : (
            <FolderFacts
              inspection={inspection}
              reading={reading}
              dragging={dragging}
              onDragState={setDragging}
              onDrop={onDrop}
              onPickAnother={() => inputRef.current?.click()}
            />
          )}

          {inspection && inspection.problems.length === 0 && (
            <>
              <FormField label="Name" required error={nameError}>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., pick-and-place-v1"
                  data-testid="upload-name"
                />
              </FormField>
              <FormField label="Description" aside="Optional">
                <Textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What was recorded, and how"
                />
              </FormField>
              <FormField
                label="Robot type"
                hint="Auto-detect matches the dataset's robot and joint count to a registered type, and registers one when none fits."
              >
                <Select
                  placeholder={inspection.summary.robotType ? `Auto-detect (${inspection.summary.robotType})` : 'Auto-detect'}
                  value={robotTypeId}
                  onChange={(e) => setRobotTypeId(e.target.value)}
                  options={types.map((t) => ({ value: t.id, label: t.name }))}
                  data-testid="upload-robot-type"
                />
              </FormField>
            </>
          )}

          {startError && <RefusalBlock title="The server did not accept this upload" error={startError} testId="upload-start-error" />}
        </div>
      )}
    </Modal>
  );
}

// ============================================================================
// WHAT THE FOLDER HOLDS
// ============================================================================

interface FolderFactsProps {
  inspection: FolderInspection;
  reading: boolean;
  dragging: boolean;
  onDragState: (dragging: boolean) => void;
  onDrop: (event: React.DragEvent) => void;
  onPickAnother: () => void;
}

function FolderFacts({ inspection, reading, dragging, onDragState, onDrop, onPickAnother }: FolderFactsProps) {
  const { summary, problems, warnings } = inspection;
  const wrong = problems.length > 0;
  const count = (value: number | null) => (value === null ? null : formatCount(value));

  return (
    <div className="flex flex-col gap-3">
      {/* Still a drop target: the wrong folder is replaced by dropping the right one. */}
      <Panel
        variant="inset"
        padding="sm"
        data-testid="upload-folder-facts"
        onDragOver={(e: React.DragEvent) => { e.preventDefault(); onDragState(true); }}
        onDragLeave={(e: React.DragEvent) => { e.preventDefault(); onDragState(false); }}
        onDrop={onDrop}
        className={cn('flex flex-col gap-4 border', dragging ? 'border-primary' : 'border-transparent')}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-ink-tertiary">{wrong ? 'Picked' : 'About to upload'}</p>
            <p className="break-all text-sm font-medium text-ink-primary" data-testid="upload-folder-name">
              {inspection.rootName || 'This folder'}
            </p>
          </div>
          <Button size="sm" variant="secondary" onClick={onPickAnother} isLoading={reading} loadingText="Reading…">
            Choose another folder
          </Button>
        </div>
        {!wrong && (
          <>
            <KeyValueList
              columns={3}
              items={[
                { label: 'Format', value: summary.version ? `LeRobot ${summary.version}` : null },
                { label: 'Episodes', value: count(summary.episodes) },
                { label: 'Frames', value: count(summary.frames) },
                { label: 'Frame rate', value: summary.fps === null ? null : `${summary.fps} fps` },
                {
                  label: 'Cameras',
                  value: summary.cameras.length > 0 ? `${summary.cameras.length} (${summary.cameras.join(', ')})` : 'None',
                },
                { label: 'Size', value: formatBytes(inspection.totalBytes) },
              ]}
            />
            <p className="text-xs text-ink-tertiary" data-testid="upload-folder-files">
              {formatCount(inspection.files.length)} {inspection.files.length === 1 ? 'file' : 'files'} to upload
              {summary.robotType && ` · recorded on ${summary.robotType}`}
              {summary.actionWidth !== null && ` (${summary.actionWidth} joints)`}
              {inspection.skipped > 0
                && ` · ${formatCount(inspection.skipped)} other ${inspection.skipped === 1 ? 'file is' : 'files are'} not part of the dataset and ${inspection.skipped === 1 ? 'stays' : 'stay'} here`}
            </p>
          </>
        )}
      </Panel>

      {wrong && (
        <div
          role="alert"
          data-testid="upload-folder-problems"
          className="flex items-start gap-2 rounded-control border border-signal-stopped/40 bg-signal-stopped/10 px-3 py-2 text-sm text-ink-primary"
        >
          <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-signal-stopped" strokeWidth={1.75} aria-hidden />
          <div className="flex min-w-0 flex-col gap-1">
            <p className="font-medium">This folder cannot be uploaded</p>
            <ul className="flex flex-col gap-0.5 text-ink-secondary">
              {problems.map((problem) => <li key={problem} className="break-words">{problem}</li>)}
            </ul>
          </div>
        </div>
      )}

      {!wrong && warnings.map((warning) => (
        <p
          key={warning}
          role="status"
          data-testid="upload-folder-warning"
          className="flex items-start gap-2 rounded-control border border-signal-estimated/40 bg-signal-estimated/10 px-3 py-2 text-sm text-ink-primary"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-signal-estimated" strokeWidth={1.75} aria-hidden />
          <span>{warning}</span>
        </p>
      ))}
    </div>
  );
}

// ============================================================================
// THE UPLOAD, RUNNING
// ============================================================================

const PHASE_LABEL: Record<UploadJob['phase'], string> = {
  starting: 'Starting',
  uploading: 'Uploading',
  finishing: 'Finishing',
  processing: 'The server is assembling and verifying the files',
  validating: 'The server is validating the dataset',
  failed: 'Stopped',
  cancelling: 'Cancelling',
};

/** "212 MB of 446 MB · 24.3 MB/s · about 10s left" */
export function describeTransfer(job: UploadJob): string {
  const parts = [`${formatBytes(job.sentBytes)} of ${formatBytes(job.totalBytes)}`];
  if (job.phase === 'uploading') {
    if (job.rate !== null && job.rate > 0) parts.push(`${formatBytes(job.rate)}/s`);
    if (job.etaSeconds !== null && Number.isFinite(job.etaSeconds)) {
      parts.push(job.etaSeconds < 1 ? 'almost done' : `about ${formatDuration(job.etaSeconds)} left`);
    }
  }
  return parts.join(' · ');
}

function UploadRun({ job }: { job: UploadJob }) {
  const percent = uploadPercent(job) ?? 0;
  const failed = job.phase === 'failed';
  // Every byte is with the server; what it does now has no percentage.
  const serverSide = job.phase === 'processing' || job.phase === 'validating';
  const filesDone = job.files.filter((f) => f.done).length;

  // The ones in motion first, then what is waiting, then what is through.
  const rows = useMemo(() => {
    const rank = (f: UploadFileProgress) => (f.done ? 2 : f.sent > 0 ? 0 : 1);
    return [...job.files].sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path));
  }, [job.files]);

  if (job.phase === 'cancelling') {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center" data-testid="upload-cancelling">
        <Spinner size="lg" color="primary" />
        <p className="text-sm font-medium text-ink-primary">Cancelling the upload…</p>
        <p className="text-sm text-ink-secondary">The server is removing what it received.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="upload-run">
      <div>
        <p className="text-xs text-ink-tertiary">{failed ? 'Upload stopped' : serverSide ? 'Uploaded' : 'Uploading'}</p>
        <p className="break-all text-sm font-medium text-ink-primary">{job.name}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <ProgressBar value={percent} label={PHASE_LABEL[job.phase]} variant={failed ? 'error' : 'default'} indeterminate={serverSide} />
        <p className="text-xs tabular-nums text-ink-tertiary" data-testid="upload-overall">
          {describeTransfer(job)} · {formatCount(filesDone)} of {formatCount(job.files.length)} files
        </p>
      </div>

      {failed && job.error && (
        <RefusalBlock title="The upload stopped" error={job.error} testId="upload-error">
          What reached the server is kept. “Try again” asks the server what it holds and sends only the rest.
        </RefusalBlock>
      )}

      <Panel padding="none" className="max-h-56 overflow-y-auto">
        <ul className="flex flex-col divide-y divide-line-subtle" data-testid="upload-files">
          {rows.slice(0, MAX_FILE_ROWS).map((file) => <FileRow key={file.id} file={file} />)}
        </ul>
        {rows.length > MAX_FILE_ROWS && (
          <p className="border-t border-line-subtle px-3 py-2 text-xs text-ink-tertiary">
            and {formatCount(rows.length - MAX_FILE_ROWS)} more files
          </p>
        )}
      </Panel>

      {serverSide && (
        <p className="text-xs text-ink-secondary">
          Everything is uploaded. The dataset&rsquo;s row in the list turns ready once the server has checked it.
        </p>
      )}
      {!failed && !serverSide && (
        <p className="text-xs text-ink-secondary" data-testid="upload-background-note">
          You can close this dialog — the upload keeps running as long as this tab stays open, and shows in the top bar
          and on the dataset&rsquo;s row. Only “Cancel upload” stops it.
        </p>
      )}
    </div>
  );
}

function FileRow({ file }: { file: UploadFileProgress }) {
  const percent = file.size > 0 ? Math.min(100, (file.sent / file.size) * 100) : file.done ? 100 : 0;
  return (
    <li className="flex flex-col gap-1.5 px-3 py-2" data-testid="upload-file" data-done={file.done ? 'true' : 'false'}>
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate font-mono text-[11px] text-ink-secondary" title={file.path}>{file.path}</span>
        <span className="flex shrink-0 items-center gap-1.5 text-[11px] tabular-nums text-ink-tertiary">
          {file.done
            ? <>{formatBytes(file.size)} <CheckCircle2 className="h-3.5 w-3.5 text-signal-measured" aria-label="Sent" /></>
            : file.sent > 0
              ? `${formatBytes(file.sent)} of ${formatBytes(file.size)}`
              : formatBytes(file.size)}
        </span>
      </div>
      {!file.done && file.sent > 0 && <ProgressBar size="sm" showValue={false} value={percent} />}
    </li>
  );
}

// ============================================================================
// A REFUSAL
// ============================================================================

/** The server's sentence, its code, and the fields that say what to change. */
function RefusalBlock({ title, error, testId, children }: {
  title: string;
  error: UploadErrorView;
  testId: string;
  children?: React.ReactNode;
}) {
  // A refusal can arrive below the fold of a long form; bring it into view.
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollIntoView?.({ block: 'nearest' }); }, [error]);
  return (
    <div
      ref={ref}
      role="alert"
      data-testid={testId}
      className="flex items-start gap-2 rounded-control border border-signal-stopped/40 bg-signal-stopped/10 px-3 py-2 text-sm text-ink-primary"
    >
      <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-signal-stopped" strokeWidth={1.75} aria-hidden />
      <div className="flex min-w-0 flex-col gap-1.5">
        <p className="font-medium">{title}</p>
        <p className="break-words text-ink-secondary">{error.message}</p>
        {(error.context.length > 0 || error.code) && (
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs text-ink-tertiary">
            {error.context.map((item) => (
              <div key={item.label} className="contents">
                <dt>{item.label}</dt>
                <dd className="break-all text-ink-secondary">{item.value}</dd>
              </div>
            ))}
            <div className="contents">
              <dt>Code</dt>
              <dd className="break-all font-mono text-ink-secondary">
                {error.code}{error.status > 0 ? ` (HTTP ${error.status})` : ''}
              </dd>
            </div>
          </dl>
        )}
        {children && <p className="text-xs text-ink-secondary">{children}</p>}
      </div>
    </div>
  );
}
