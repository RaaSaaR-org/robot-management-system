/**
 * @file DatasetUploadModal.tsx
 * @description Modal for uploading new datasets with drag-and-drop
 * @feature training
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { AlertTriangle, CameraOff, CheckCircle2, UploadCloud, XCircle } from 'lucide-react';
import { Button, FormField, Input, Modal, Panel, ProgressBar, Select, Spinner, Textarea, toast } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import { UI_DATE_LOCALE } from '@/shared/utils/format';
import { getErrorMessage } from '@/shared/utils/error';
import { trainingApi } from '../api';
import type { Dataset, RobotType } from '../types';

/** How often to ask, and how long to keep asking. */
const VALIDATION_POLL_MS = 1000;
const VALIDATION_TIMEOUT_MS = 60_000;

export interface DatasetUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  robotTypes?: RobotType[];
}

type Step = 'metadata' | 'upload' | 'validating' | 'complete';

/**
 * What the poll concluded — not just "here is a dataset, or null".
 *
 * `null` used to mean two different things: the deadline passed, and every
 * single status request failed. Both were rendered as the green tick with
 * "Still validating", which asserts something no successful reply ever said.
 */
type PollResult =
  | { kind: 'dataset'; dataset: Dataset }
  | { kind: 'timeout'; dataset: Dataset | null }
  | { kind: 'unreachable'; message: string };

interface FormState {
  name: string;
  description: string;
  robotTypeId: string;
}

/**
 * Modal wizard for uploading new datasets
 */
export function DatasetUploadModal({
  isOpen,
  onClose,
  onSuccess,
  robotTypes = [],
}: DatasetUploadModalProps) {
  const [step, setStep] = useState<Step>('metadata');
  const [form, setForm] = useState<FormState>({
    name: '',
    description: '',
    robotTypeId: '',
  });
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  /** The dataset as the server left it, once validation finished. */
  const [validated, setValidated] = useState<Dataset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [_datasetId, setDatasetId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fetchedTypes, setFetchedTypes] = useState<RobotType[]>([]);
  const [typesError, setTypesError] = useState<string | null>(null);
  const [typesFailed, setTypesFailed] = useState(false);
  const [typesLoading, setTypesLoading] = useState(false);
  const [typesAttempt, setTypesAttempt] = useState(0);
  /** Bumped on close/unmount/reset, so a poll in flight stops writing state. */
  const pollToken = useRef(0);
  /** True while an upload is running, so a second click cannot start another. */
  const uploading = useRef(false);
  const [busy, setBusy] = useState(false);
  const [pollOutcome, setPollOutcome] = useState<PollResult | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; robotTypeId?: string }>({});

  // The select had no source. `robotTypes` defaults to `[]`, `DatasetsPage`
  // never passed it, and `robotTypeId` is required — so the modal could not be
  // completed from the page that opens it, whatever the server did.
  useEffect(() => {
    if (!isOpen || robotTypes.length > 0) return;
    let cancelled = false;
    setTypesLoading(true);
    setTypesError(null);
    setTypesFailed(false);
    trainingApi.listRobotTypes()
      .then((types) => { if (!cancelled) setFetchedTypes(types); })
      .catch((err: unknown) => {
        // Kept, not swallowed. An empty select in front of a required field
        // sends the operator to "Please fill in all required fields" about a
        // field that has nothing to fill it with — the exact dead end this
        // endpoint was added to remove.
        if (cancelled) return;
        setFetchedTypes([]);
        // The detail, not another copy of the headline: the api client's own
        // message for a failed GET is already a sentence, and prefixing it with
        // the same words rendered "Could not load robot types: Could not load
        // robot types".
        // `getErrorMessage`, not `String(err)`: the api client rejects with a
        // plain `ApiError` object, so `String` on it renders "[object Object]".
        const detail = getErrorMessage(err, '');
        setTypesError(!detail || /robot types/i.test(detail) ? null : detail);
        setTypesFailed(true);
      })
      .finally(() => { if (!cancelled) setTypesLoading(false); });
    return () => { cancelled = true; };
  }, [isOpen, robotTypes.length, typesAttempt]);

  const availableTypes = robotTypes.length > 0 ? robotTypes : fetchedTypes;
  const noTypes = availableTypes.length === 0;

  const resetForm = useCallback(() => {
    // Stop any poll still running for the previous upload before clearing:
    // it would otherwise finish and write `step: 'complete'` into a modal the
    // operator has closed, so the NEXT open landed on the last upload's result
    // screen instead of the metadata form.
    pollToken.current += 1;
    uploading.current = false;
    setBusy(false);
    setPollOutcome(null);
    setStep('metadata');
    setForm({ name: '', description: '', robotTypeId: '' });
    setFile(null);
    setUploadProgress(0);
    setError(null);
    setFieldErrors({});
    setValidated(null);
    setDatasetId(null); // eslint-disable-line @typescript-eslint/no-unused-vars
  }, []);

  const handleClose = useCallback(() => {
    resetForm();
    onClose();
  }, [resetForm, onClose]);

  useEffect(() => () => { pollToken.current += 1; }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      validateAndSetFile(droppedFile);
    }
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      validateAndSetFile(selectedFile);
    }
  }, []);

  const validateAndSetFile = (f: File) => {
    // Check file type
    const validTypes = [
      'application/gzip',
      'application/x-gzip',
      'application/zip',
      'application/x-tar',
    ];
    const validExtensions = ['.tar.gz', '.tgz', '.zip'];

    const hasValidExtension = validExtensions.some((ext) =>
      f.name.toLowerCase().endsWith(ext)
    );

    if (!validTypes.includes(f.type) && !hasValidExtension) {
      setError('Please upload a .tar.gz or .zip file');
      return;
    }

    setFile(f);
    setError(null);
  };

  const handleMetadataSubmit = useCallback(async () => {
    const errors = {
      name: form.name.trim() ? undefined : 'Give the dataset a name.',
      robotTypeId: form.robotTypeId ? undefined : 'Pick the robot the episodes were recorded on.',
    };
    setFieldErrors(errors);
    if (errors.name || errors.robotTypeId) return;

    setError(null);
    setStep('upload');
  }, [form]);

  /**
   * Wait for the server to finish validating, and return the dataset.
   *
   * Gives up after `VALIDATION_TIMEOUT_MS` and returns whatever the row says
   * then — a still-`validating` dataset is a real answer ("it is taking a
   * while"), and better than a green tick that means nothing.
   */
  const pollValidation = useCallback(async (
    id: string,
    token: number,
    /** True once the completion call has failed — nothing will move the row. */
    abandoned: () => boolean,
  ): Promise<PollResult | null> => {
    const deadline = Date.now() + VALIDATION_TIMEOUT_MS;
    let lastError = 'the server did not answer';
    let everAnswered = false;
    for (;;) {
      // Checked after every await: `null` means "this modal moved on, drop it".
      if (pollToken.current !== token) return null;
      try {
        const dataset = await trainingApi.getDataset(id);
        everAnswered = true;
        if (pollToken.current !== token) return null;
        if (dataset.status !== 'validating' && dataset.status !== 'uploading') {
          return { kind: 'dataset', dataset };
        }
        // The row has not been picked up AND the request that would have picked
        // it up has already failed. Waiting out the deadline would spin for a
        // minute on something that is never going to happen.
        if (dataset.status === 'uploading' && abandoned()) {
          return { kind: 'dataset', dataset };
        }
        if (Date.now() > deadline) return { kind: 'timeout', dataset };
      } catch (err) {
        lastError = getErrorMessage(err, 'the server did not answer');
        if (Date.now() > deadline) {
          // Never once read the status vs read it and it is still going: the
          // first must not be painted as a green tick.
          return everAnswered ? { kind: 'timeout', dataset: null } : { kind: 'unreachable', message: lastError };
        }
      }
      await new Promise((r) => setTimeout(r, VALIDATION_POLL_MS));
    }
  }, []);

  const handleUpload = useCallback(async () => {
    if (!file) {
      setError('Please select a file');
      return;
    }
    // A second click used to create a SECOND Dataset row and re-upload the
    // file, which is what an operator does when the first attempt looks stuck.
    if (uploading.current) return;
    uploading.current = true;
    setBusy(true);

    setError(null);
    setUploadProgress(0);
    const token = pollToken.current;

    let datasetId: string | null = null;
    try {
      // Create dataset record
      const dataset = await trainingApi.createDataset({
        name: form.name,
        description: form.description || undefined,
        robotTypeId: form.robotTypeId,
      });

      datasetId = dataset.id;
      setDatasetId(dataset.id);

      // Get presigned upload URL
      const { uploadUrl } = await trainingApi.initiateUpload(
        dataset.id,
        file.type || 'application/gzip',
        file.size
      );

      // Upload file with progress tracking
      await uploadFileWithProgress(uploadUrl, file, setUploadProgress);

      // The bytes are in the bucket. Everything after this point is the server
      // working on them, so the wizard moves on BEFORE asking it to — the
      // completion call now unpacks the archive and (without NATS) validates it
      // inside the request, and the shared axios client aborts at 30 s. Waiting
      // on it and treating a rejection as failure reported "Upload failed" for
      // every upload big enough to be worth making.
      setStep('validating');
    } catch (err) {
      uploading.current = false;
      setBusy(false);
      setError(getErrorMessage(err, 'Upload failed'));
      return;
    }

    // The completion call and the poll run TOGETHER, not one after the other.
    // Completion downloads the archive, unpacks it and — without NATS —
    // validates it inside the request, which is minutes on a real dataset; the
    // row reaches `validating` and then `ready` while it is still open. Waiting
    // for it first meant the poll that exists to show that progress could not
    // run until there was nothing left to show.
    let completionError: string | null = null;
    const completion = trainingApi.completeUpload(datasetId).catch((err: unknown) => {
      // Not a failed upload on its own: a dropped connection or a proxy's idle
      // timeout leaves the server working and the row still carries the answer.
      // Only used below if the poll ALSO never saw the row move.
      completionError = getErrorMessage(err, 'the completion request failed');
    });

    // POLL the real thing. This used to be `setTimeout(2000)` with a comment
    // saying "in reality, would poll", followed unconditionally by a green
    // tick and "your dataset will be ready for training soon" — including for
    // a dataset that had just failed. Validation now opens every file the
    // manifest names, so it has something to say and the operator should see
    // it here rather than find out during a training run.
    const outcome = await pollValidation(datasetId, token, () => completionError !== null);
    if (outcome === null) return; // the modal was closed or reset under us

    // Only wait on the completion call when the poll did NOT get a terminal
    // answer. A row that reached `ready` or `failed` is the server's verdict,
    // and blocking on a request that may never return would hide it.
    const settled = outcome.kind === 'dataset' && outcome.dataset.status !== 'uploading';
    if (!settled) await completion;
    if (pollToken.current !== token) return;
    uploading.current = false;
    setBusy(false);

    // The one case that IS a failed upload: the completion request errored and
    // the row never moved off `uploading`, so nothing on the server ever took
    // the archive. Anything else — a row that reached ready or failed — is the
    // server's answer and outranks a broken HTTP call.
    if (completionError && !settled) {
      setError(completionError);
      setStep('upload');
      return;
    }

    setPollOutcome(outcome);
    setValidated(outcome.kind === 'unreachable' ? null : outcome.dataset);
    setStep('complete');
  }, [file, form, pollValidation]);

  const handleComplete = useCallback(() => {
    if (validated?.status === 'ready') toast.success('Dataset uploaded', { description: validated.name });
    onSuccess?.();
    handleClose();
  }, [onSuccess, handleClose, validated]);

  const STEP_LABEL: Record<Step, string> = {
    metadata: 'Details',
    upload: 'File',
    validating: 'Validation',
    complete: 'Result',
  };
  const stepIndex = (['metadata', 'upload', 'validating', 'complete'] as Step[]).indexOf(step);

  const footer = (
    <>
      {step !== 'complete' && <Button variant="ghost" onClick={handleClose}>Cancel</Button>}
      {step === 'metadata' && <Button type="submit">Continue</Button>}
      {/* Disabled while an upload runs: a second click created a second row. */}
      {step === 'upload' && (
        <Button type="submit" disabled={busy} isLoading={busy} loadingText="Uploading…">Upload</Button>
      )}
      {step === 'complete' && <Button onClick={handleComplete}>Done</Button>}
    </>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Upload dataset"
      description={`Step ${stepIndex + 1} of 4 · ${STEP_LABEL[step]}`}
      size="lg"
      closeOnBackdrop={false}
      onSubmit={step === 'metadata' || step === 'upload' ? (e) => { e.preventDefault(); void (step === 'metadata' ? handleMetadataSubmit() : handleUpload()); } : undefined}
      noValidate
      footer={footer}
    >
      <div className="flex flex-col gap-4">
        {step === 'metadata' && (
          <>
            <FormField label="Name" required error={fieldErrors.name}>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g., pick-and-place-v1"
              />
            </FormField>
            <FormField label="Description" aside="Optional">
              <Textarea
                rows={3}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="What was recorded, and how"
              />
            </FormField>
            <FormField label="Robot type" required error={fieldErrors.robotTypeId}>
              <Select
                placeholder="Select robot type…"
                value={form.robotTypeId}
                onChange={(e) => setForm({ ...form, robotTypeId: e.target.value })}
                options={availableTypes.map((rt) => ({ value: rt.id, label: `${rt.name} (${rt.manufacturer})` }))}
              />
            </FormField>
            {/* An empty select in front of a required field is a dead end. Say which kind. */}
            {typesLoading && noTypes && <p className="text-sm text-ink-secondary">Loading robot types…</p>}
            {!typesLoading && typesFailed && (
              <p data-testid="robot-types-error" className="flex flex-wrap items-center gap-2 text-sm text-signal-stopped">
                <AlertTriangle className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                <span>Could not load robot types{typesError ? `: ${typesError}` : '.'}</span>
                <Button variant="ghost" size="sm" onClick={() => setTypesAttempt((n) => n + 1)}>Retry</Button>
              </p>
            )}
            {!typesLoading && !typesFailed && noTypes && (
              <p data-testid="robot-types-empty" className="text-sm text-ink-secondary">
                No robot types are registered yet — one has to exist before a dataset can name it.
              </p>
            )}
          </>
        )}

        {step === 'upload' && (
          <>
            <button
              type="button"
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                'flex flex-col items-center gap-1 rounded-panel border-2 border-dashed p-8 text-center transition-colors',
                isDragging ? 'border-primary bg-primary/10' : 'border-line hover:border-line-strong',
              )}
            >
              <UploadCloud className="mb-1 h-6 w-6 text-ink-tertiary" strokeWidth={1.75} />
              {file ? (
                <>
                  <span className="text-sm font-medium text-ink-primary">{file.name}</span>
                  <span className="text-xs text-ink-tertiary">{formatFileSize(file.size)} · click to pick another</span>
                </>
              ) : (
                <>
                  <span className="text-sm text-ink-primary">Drop the archive here, or click to browse</span>
                  <span className="text-xs text-ink-tertiary">.tar.gz or .zip in LeRobot v3 format</span>
                </>
              )}
            </button>
            <input ref={fileInputRef} type="file" onChange={handleFileSelect} accept=".tar.gz,.tgz,.zip" className="hidden" />
            {uploadProgress > 0 && (
              <ProgressBar
                value={uploadProgress}
                label={uploadProgress < 100 ? 'Uploading…' : 'Uploaded — unpacking on the server…'}
              />
            )}
          </>
        )}

        {step === 'validating' && (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <Spinner size="lg" color="primary" />
            <p className="text-sm font-medium text-ink-primary">Validating dataset…</p>
            <p className="text-sm text-ink-secondary">Checking LeRobot format and computing statistics.</p>
          </div>
        )}

        {step === 'complete' && (
          /* What the server ACTUALLY found — never a green tick it did not say. */
          pollOutcome?.kind === 'unreachable' ? (
            <ResultBlock testId="upload-status-unknown" icon={<AlertTriangle className="h-8 w-8 text-signal-estimated" strokeWidth={1.75} />}
              title="Uploaded — could not read the validation status"
              text={`The file is on the server. ${pollOutcome.message}`} />
          ) : validated?.status === 'failed' ? (
            <ResultBlock testId="upload-failed" icon={<XCircle className="h-8 w-8 text-signal-stopped" strokeWidth={1.75} />}
              title="Uploaded, but it did not validate"
              text="The files are on the server; the dataset cannot be trained on as it stands.">
              {validated.validation?.errors.length ? (
                <ul className="mt-2 flex max-h-40 flex-col gap-1 overflow-y-auto text-left text-sm text-ink-secondary">
                  {validated.validation.errors.slice(0, 6).map((finding) => (
                    <li key={`${finding.code}-${finding.message}`} className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-signal-stopped" strokeWidth={1.75} />
                      <span className="break-words">{finding.message}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </ResultBlock>
          ) : (
            <ResultBlock testId="upload-complete" icon={<CheckCircle2 className="h-8 w-8 text-signal-measured" strokeWidth={1.75} />}
              title={validated?.status === 'ready' ? 'Dataset uploaded and validated' : 'Dataset uploaded'}
              text={validated?.status === 'ready'
                ? `${validated.demonstrationCount} ${validated.demonstrationCount === 1 ? 'episode' : 'episodes'}, `
                  + `${validated.totalFrames.toLocaleString(UI_DATE_LOCALE)} frames.`
                : 'Still validating — it will finish in the background.'}>
              {validated?.validation?.warnings.some((w) => w.code === 'NO_IMAGE_FEATURES') && (
                <Panel variant="inset" padding="sm" data-testid="upload-no-images" className="mt-2 flex items-start gap-2 text-left text-sm text-ink-secondary">
                  <CameraOff className="mt-0.5 h-4 w-4 shrink-0 text-signal-estimated" strokeWidth={1.75} />
                  <span>
                    No camera features. A vision-language-action policy cannot train on this —
                    training fails with &ldquo;All image features are missing from the batch&rdquo;.
                  </span>
                </Panel>
              )}
            </ResultBlock>
          )
        )}

        {error && <p role="alert" className="text-sm text-signal-stopped">{error}</p>}
      </div>
    </Modal>
  );
}

/** Centered result of the upload: icon, headline, one sentence, details. */
function ResultBlock({ testId, icon, title, text, children }: {
  testId: string;
  icon: React.ReactNode;
  title: string;
  text: string;
  children?: React.ReactNode;
}) {
  return (
    <div data-testid={testId} className="flex flex-col items-center gap-2 py-6 text-center">
      {icon}
      <p className="text-base font-medium text-ink-primary">{title}</p>
      <p className="text-sm text-ink-secondary">{text}</p>
      {children}
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

async function uploadFileWithProgress(
  url: string,
  file: File,
  onProgress: (progress: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const progress = Math.round((event.loaded / event.total) * 100);
        onProgress(progress);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Upload failed with status ${xhr.status}`));
      }
    };

    xhr.onerror = () => reject(new Error('Upload failed'));

    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type || 'application/gzip');
    xhr.send(file);
  });
}
