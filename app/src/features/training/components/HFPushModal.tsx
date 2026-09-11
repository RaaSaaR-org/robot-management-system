/**
 * @file HFPushModal.tsx
 * @description Push a dataset to the Hugging Face Hub: token and repo form, live progress, result
 * @feature training
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, ExternalLink, XCircle } from 'lucide-react';
import { Button, Checkbox, FormField, Input, Modal, Spinner, toast } from '@/shared/components/ui';
import { getErrorMessage } from '@/shared/utils';
import { trainingApi } from '../api';

export interface HFPushModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  datasetId: string;
  datasetName: string;
}

type PushState = 'form' | 'pushing' | 'done' | 'failed';

export function HFPushModal({ isOpen, onClose, onSuccess, datasetId, datasetName }: HFPushModalProps) {
  const [token, setToken] = useState('');
  const [repoId, setRepoId] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [pushState, setPushState] = useState<PushState>('form');
  const [progress, setProgress] = useState('');
  const [resultUrl, setResultUrl] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ token?: string; repoId?: string }>({});
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);
  useEffect(() => () => stopPolling(), [stopPolling]);

  const handleClose = () => {
    setToken(''); setRepoId(''); setIsPrivate(false); setPushState('form');
    setProgress(''); setResultUrl(''); setError(''); setFieldErrors({});
    stopPolling();
    onClose();
  };

  const startPolling = useCallback(() => {
    pollRef.current = setInterval(async () => {
      try {
        const status = await trainingApi.getPushStatus(datasetId);
        if (status.progress) setProgress(status.progress);
        if (status.status === 'done') {
          setPushState('done');
          setResultUrl(status.url ?? '');
          stopPolling();
          toast.success('Dataset pushed', { description: datasetName });
          onSuccess?.();
        } else if (status.status === 'failed') {
          setPushState('failed');
          setError(status.error ?? 'Push failed');
          stopPolling();
        }
      } catch {
        // A polling hiccup — keep trying
      }
    }, 2000);
  }, [datasetId, datasetName, stopPolling, onSuccess]);

  const handleSubmit = async () => {
    const errors = {
      token: token.trim() ? undefined : 'Paste a token with write access.',
      repoId: /^[^/\s]+\/[^/\s]+$/.test(repoId.trim()) ? undefined : 'Use the form owner/name.',
    };
    setFieldErrors(errors);
    if (errors.token || errors.repoId) return;
    setPushState('pushing');
    setProgress('Starting push…');
    setError('');
    try {
      await trainingApi.pushToHub(datasetId, { token: token.trim(), repoId: repoId.trim(), private: isPrivate });
      startPolling();
    } catch (err) {
      setPushState('failed');
      setError(getErrorMessage(err, 'Failed to start push'));
    }
  };

  const footer =
    pushState === 'form' ? (
      <>
        <Button variant="ghost" onClick={handleClose}>Cancel</Button>
        <Button type="submit">Push dataset</Button>
      </>
    ) : pushState === 'failed' ? (
      <>
        <Button variant="ghost" onClick={handleClose}>Close</Button>
        <Button onClick={() => setPushState('form')}>Try again</Button>
      </>
    ) : pushState === 'done' ? (
      <Button onClick={handleClose}>Close</Button>
    ) : (
      <Button variant="ghost" onClick={handleClose}>Close — keep pushing</Button>
    );

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Push to Hugging Face"
      description={pushState === 'form' ? `Publish ${datasetName} as a dataset repo on the Hub.` : undefined}
      size="md"
      closeOnBackdrop={pushState !== 'form'}
      onSubmit={pushState === 'form' ? (e) => { e.preventDefault(); void handleSubmit(); } : undefined}
      noValidate
      footer={footer}
    >
      {pushState === 'form' && (
        <div className="flex flex-col gap-4">
          <FormField label="Access token" required error={fieldErrors.token} hint="Create one with write access at huggingface.co/settings/tokens.">
            <Input type="password" autoComplete="off" placeholder="hf_…" value={token} onChange={(e) => setToken(e.target.value)} />
          </FormField>
          <FormField label="Repository" required error={fieldErrors.repoId}>
            <Input placeholder="username/my-g1-dataset" value={repoId} onChange={(e) => setRepoId(e.target.value)} />
          </FormField>
          <Checkbox
            label="Private repository"
            description="Only you and your organisation can see it."
            checked={isPrivate}
            onChange={(e) => setIsPrivate(e.target.checked)}
          />
        </div>
      )}
      {pushState === 'pushing' && (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <Spinner size="lg" color="primary" />
          <p className="text-sm text-ink-secondary">{progress}</p>
          <p className="text-xs text-ink-tertiary">Large datasets take a few minutes.</p>
        </div>
      )}
      {pushState === 'done' && (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <CheckCircle2 className="h-8 w-8 text-signal-measured" strokeWidth={1.75} />
          <p className="text-sm font-semibold text-ink-primary">Dataset published</p>
          {resultUrl && (
            <a href={resultUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
              {resultUrl} <ExternalLink className="h-4 w-4" strokeWidth={1.75} />
            </a>
          )}
        </div>
      )}
      {pushState === 'failed' && (
        <div className="flex flex-col items-center gap-3 py-6 text-center" role="alert">
          <XCircle className="h-8 w-8 text-signal-stopped" strokeWidth={1.75} />
          <p className="text-sm font-semibold text-ink-primary">Push failed</p>
          <p className="text-sm text-ink-secondary">{error}</p>
        </div>
      )}
    </Modal>
  );
}
