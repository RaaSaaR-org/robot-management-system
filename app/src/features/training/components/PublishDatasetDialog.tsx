/**
 * @file PublishDatasetDialog.tsx
 * @description Publish a dataset to the Hugging Face Hub with the server's own
 *              account: repo, visibility, license and tags, then live progress
 *              and the link (TASK-394).
 * @feature training
 *
 * Replaces HFPushModal, which asked the operator to paste a write token into
 * the browser and could only publish from RustFS. The server now holds the
 * credentials and reads the dataset straight off its disk, so the dialog asks
 * only what a person must decide: where it goes and who may see it. Private is
 * the default — a public dataset is a publication, and that is a deliberate act.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, XCircle } from 'lucide-react';
import {
  Button, Checkbox, FormField, Input, Modal, Panel, ProgressBar, Select, Spinner, Switch, Textarea, toast,
} from '@/shared/components/ui';
import { getErrorMessage } from '@/shared/utils';
import { trainingApi } from '../api';
import type { DatasetPublishJob, HubPublishStatus } from '../types';
import { formatBytes } from './datasets/datasetFormat';

export interface PublishDatasetDialogProps {
  isOpen: boolean;
  onClose: () => void;
  datasetId: string;
  /** Prefills the repo name; fetched when the caller does not have it. */
  datasetName?: string;
  onPublished?: (job: DatasetPublishJob) => void;
}

type Step = 'form' | 'publishing' | 'done' | 'failed';

const POLL_MS = 1500;

export const LICENSE_OPTIONS = [
  { value: 'apache-2.0', label: 'Apache 2.0' },
  { value: 'mit', label: 'MIT' },
  { value: 'cc-by-4.0', label: 'CC BY 4.0' },
  { value: 'cc-by-sa-4.0', label: 'CC BY-SA 4.0' },
  { value: 'cc-by-nc-4.0', label: 'CC BY-NC 4.0' },
  { value: 'cc0-1.0', label: 'CC0 1.0' },
  { value: 'other', label: 'Other' },
];

const PHASE_LABEL: Record<DatasetPublishJob['phase'], string> = {
  preparing: 'Collecting files',
  creating_repo: 'Preparing the repository',
  uploading: 'Uploading',
  committing: 'Creating the commit',
  done: 'Published',
  failed: 'Failed',
};

/** A Hub repo name from a dataset name: lower case, `-` for anything else, ≤ 96 chars. */
export function repoNameFrom(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/^[-._]+|[-._]+$/g, '')
    .slice(0, 96)
    .replace(/[-._]+$/g, '');
}

const REPO_ID_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,94}[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9._-]{0,94}[A-Za-z0-9])?$/;

function parseTags(value: string): string[] {
  return [...new Set(value.split(',').map((t) => t.trim()).filter(Boolean))];
}

export function PublishDatasetDialog({ isOpen, onClose, datasetId, datasetName, onPublished }: PublishDatasetDialogProps) {
  const [status, setStatus] = useState<HubPublishStatus | null>(null);
  const [statusError, setStatusError] = useState('');
  const [repoId, setRepoId] = useState('');
  const [isPrivate, setIsPrivate] = useState(true);
  const [license, setLicense] = useState('apache-2.0');
  const [tags, setTags] = useState('');
  const [description, setDescription] = useState('');
  const [force, setForce] = useState(false);
  const [degraded, setDegraded] = useState('');
  const [formError, setFormError] = useState('');
  const [repoError, setRepoError] = useState('');
  const [step, setStep] = useState<Step>('form');
  const [submitting, setSubmitting] = useState(false);
  const [job, setJob] = useState<DatasetPublishJob | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onPublishedRef = useRef(onPublished);
  onPublishedRef.current = onPublished;

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);
  useEffect(() => () => stopPolling(), [stopPolling]);

  const follow = useCallback((current: DatasetPublishJob) => {
    setJob(current);
    if (current.status === 'done') {
      stopPolling();
      setStep('done');
      toast.success('Dataset published', { description: current.repoId });
      onPublishedRef.current?.(current);
    } else if (current.status === 'failed') {
      stopPolling();
      setStep('failed');
    } else {
      setStep('publishing');
    }
  }, [stopPolling]);

  const startPolling = useCallback(() => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const state = await trainingApi.getDatasetPublish(datasetId);
        if ('phase' in state) follow(state);
      } catch {
        // A polling hiccup — keep trying.
      }
    }, POLL_MS);
  }, [datasetId, follow, stopPolling]);

  // On open: who the server publishes as, the name to prefill, and whether a
  // publish of this dataset is already running (then show it, not the form).
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    void (async () => {
      const [hub, name, current] = await Promise.all([
        trainingApi.getHubPublishStatus().catch((err: unknown) => {
          if (!cancelled) setStatusError(getErrorMessage(err, 'Could not read the Hugging Face status'));
          return null;
        }),
        datasetName
          ? Promise.resolve(datasetName)
          : trainingApi.getDataset(datasetId).then((d) => d.name).catch(() => ''),
        trainingApi.getDatasetPublish(datasetId).catch(() => null),
      ]);
      if (cancelled) return;
      setStatus(hub);
      const slug = repoNameFrom(name || datasetId);
      const namespace = hub?.defaultNamespace;
      setRepoId((prev) => prev || (namespace ? `${namespace}/${slug}` : slug));
      if (current && 'phase' in current && current.status === 'running') {
        follow(current);
        startPolling();
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, datasetId, datasetName, follow, startPolling]);

  const handleClose = () => {
    stopPolling();
    setStep('form'); setJob(null); setFormError(''); setRepoError(''); setDegraded(''); setForce(false);
    setSubmitting(false);
    onClose();
  };

  const handleSubmit = async () => {
    const trimmed = repoId.trim();
    if (!REPO_ID_RE.test(trimmed) || trimmed.includes('--') || trimmed.includes('..')) {
      setRepoError('Use namespace/name — letters, digits, "-", "_" or ".".');
      return;
    }
    setRepoError('');
    setFormError('');
    setSubmitting(true);
    try {
      const started = await trainingApi.publishDataset(datasetId, {
        repoId: trimmed,
        private: isPrivate,
        license,
        tags: parseTags(tags),
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(force ? { force: true } : {}),
      });
      follow(started);
      startPolling();
    } catch (err) {
      const code = (err as { code?: string }).code;
      const message = getErrorMessage(err, 'Failed to start publishing');
      if (code === 'DATASET_DEGRADED') setDegraded(message);
      else if (code === 'NAMESPACE_FORBIDDEN' || code === 'INVALID_REPO_ID') setRepoError(message);
      else setFormError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const configured = status?.configured === true && !status.error;
  const canSubmit = configured && !submitting && (!degraded || force);

  const footer =
    step === 'form' ? (
      <>
        <Button variant="ghost" onClick={handleClose}>Cancel</Button>
        <Button type="submit" disabled={!canSubmit} isLoading={submitting}>Publish</Button>
      </>
    ) : step === 'failed' ? (
      <>
        <Button variant="ghost" onClick={handleClose}>Close</Button>
        <Button onClick={() => setStep('form')}>Try again</Button>
      </>
    ) : step === 'done' ? (
      <Button onClick={handleClose}>Close</Button>
    ) : (
      <Button variant="ghost" onClick={handleClose}>Close — keep publishing</Button>
    );

  const percent = job && job.bytesTotal > 0 ? Math.round((job.bytesDone / job.bytesTotal) * 100) : 0;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Publish to Hugging Face"
      description={step === 'form' ? 'Upload this dataset to a dataset repository on the Hub.' : undefined}
      size="md"
      closeOnBackdrop={step !== 'form'}
      onSubmit={step === 'form' ? (e) => { e.preventDefault(); void handleSubmit(); } : undefined}
      noValidate
      footer={footer}
      testId="publish-dataset-dialog"
    >
      {step === 'form' && (
        <div className="flex flex-col gap-4">
          {status === null && !statusError ? (
            <div className="flex items-center gap-2 text-[13px] text-ink-tertiary"><Spinner size="sm" /> Checking the Hub account…</div>
          ) : configured ? (
            <p className="text-[13px] text-ink-secondary" data-testid="publish-account">
              Publishing as <span className="font-medium text-ink-primary">{status?.user ?? 'unknown'}</span>
              {status && status.orgs.length > 0 && <> · member of {status.orgs.join(', ')}</>}
            </p>
          ) : (
            <Panel variant="inset" padding="sm" className="flex items-start gap-3" role="alert" data-testid="publish-not-configured">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-signal-unknown" strokeWidth={1.75} />
              <p className="text-[13px] text-ink-secondary">
                {status?.error || statusError ||
                  'The server has no Hugging Face token. Run `hf auth login` on the server host, or set HF_TOKEN, then open this again.'}
              </p>
            </Panel>
          )}

          <FormField label="Repository" required error={repoError} hint="namespace/name — the repo is created if it does not exist.">
            <Input value={repoId} onChange={(e) => setRepoId(e.target.value)} placeholder="zemarobotik/g1-pick-apple" spellCheck={false} />
          </FormField>
          <Switch
            checked={isPrivate}
            onCheckedChange={setIsPrivate}
            label="Private repository"
            description={isPrivate ? 'Only you and members of the namespace can see it.' : 'Anyone on the Hub can see and download it.'}
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="License">
              <Select value={license} onChange={(e) => setLicense(e.target.value)} options={LICENSE_OPTIONS} />
            </FormField>
            <FormField label="Tags" hint="Comma separated">
              <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="pick-and-place, apple" />
            </FormField>
          </div>
          <FormField label="Description" hint="Optional — the card's opening line.">
            <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
          </FormField>

          {degraded && (
            <Panel variant="inset" padding="sm" className="flex flex-col gap-2" data-testid="publish-degraded">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-signal-unknown" strokeWidth={1.75} />
                <p className="text-[13px] text-ink-secondary">{degraded}</p>
              </div>
              <Checkbox label="Publish anyway" checked={force} onChange={(e) => setForce(e.target.checked)} />
            </Panel>
          )}
          {formError && <p className="text-[13px] text-signal-stopped" role="alert">{formError}</p>}
        </div>
      )}

      {step === 'publishing' && job && (
        <div className="flex flex-col gap-3 py-2" data-testid="publish-progress">
          <p className="text-sm text-ink-primary">
            {PHASE_LABEL[job.phase]} <span className="font-mono text-ink-tertiary">{job.repoId}</span>
          </p>
          <ProgressBar
            value={percent}
            indeterminate={job.phase !== 'uploading' || job.bytesTotal === 0}
            showValue={job.phase === 'uploading'}
            label="Upload progress"
          />
          <p className="text-xs text-ink-tertiary">
            {job.filesTotal > 0
              ? `${job.filesDone} of ${job.filesTotal} files · ${formatBytes(job.bytesDone)} of ${formatBytes(job.bytesTotal)}`
              : job.message}
          </p>
          <p className="text-xs text-ink-tertiary">Closing this keeps the upload running on the server.</p>
        </div>
      )}

      {step === 'done' && job && (
        <div className="flex flex-col items-center gap-3 py-6 text-center" data-testid="publish-done">
          <CheckCircle2 className="h-8 w-8 text-signal-measured" strokeWidth={1.75} />
          <p className="text-sm font-semibold text-ink-primary">
            Published {job.private ? 'privately ' : ''}to {job.repoId}
          </p>
          <a href={job.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
            {job.url} <ExternalLink className="h-4 w-4" strokeWidth={1.75} />
          </a>
          {job.warnings.length > 0 && (
            <ul className="text-left text-xs text-ink-tertiary">
              {job.warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
          )}
        </div>
      )}

      {step === 'failed' && (
        <div className="flex flex-col items-center gap-3 py-6 text-center" role="alert">
          <XCircle className="h-8 w-8 text-signal-stopped" strokeWidth={1.75} />
          <p className="text-sm font-semibold text-ink-primary">Publish failed</p>
          <p className="text-sm text-ink-secondary">{job?.error ?? 'The upload stopped without a reason.'}</p>
        </div>
      )}
    </Modal>
  );
}
