/**
 * @file HFPushModal.tsx
 * @description Modal for pushing a dataset to HuggingFace Hub
 * @feature training
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Modal, Button, Input } from '@/shared/components/ui';
import { trainingApi } from '../api';

export interface HFPushModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  datasetId: string;
  datasetName: string;
}

type PushState = 'form' | 'pushing' | 'done' | 'failed';

/**
 * Modal for pushing a dataset to HuggingFace Hub
 */
export function HFPushModal({
  isOpen,
  onClose,
  onSuccess,
  datasetId,
  datasetName,
}: HFPushModalProps) {
  const [token, setToken] = useState('');
  const [repoId, setRepoId] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [pushState, setPushState] = useState<PushState>('form');
  const [progress, setProgress] = useState('');
  const [resultUrl, setResultUrl] = useState('');
  const [error, setError] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // Cleanup polling on unmount or close
  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  const resetForm = useCallback(() => {
    setToken('');
    setRepoId('');
    setIsPrivate(false);
    setPushState('form');
    setProgress('');
    setResultUrl('');
    setError('');
    stopPolling();
  }, [stopPolling]);

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const startPolling = useCallback(() => {
    pollRef.current = setInterval(async () => {
      try {
        const status = await trainingApi.getPushStatus(datasetId);
        if (status.progress) {
          setProgress(status.progress);
        }
        if (status.status === 'done') {
          setPushState('done');
          setResultUrl(status.url ?? '');
          stopPolling();
          onSuccess?.();
        } else if (status.status === 'failed') {
          setPushState('failed');
          setError(status.error ?? 'Push failed');
          stopPolling();
        }
      } catch {
        // Polling error — keep trying
      }
    }, 2000);
  }, [datasetId, stopPolling, onSuccess]);

  const handleSubmit = async () => {
    if (!token.trim() || !repoId.trim()) return;

    setPushState('pushing');
    setProgress('Starting push...');
    setError('');

    try {
      await trainingApi.pushToHub(datasetId, {
        token: token.trim(),
        repoId: repoId.trim(),
        private: isPrivate,
      });
      startPolling();
    } catch (err) {
      setPushState('failed');
      setError(err instanceof Error ? err.message : 'Failed to start push');
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Push to HuggingFace"
      size="md"
    >
      <div className="space-y-4">
        {pushState === 'form' && (
          <>
            <p className="text-sm text-theme-secondary">
              Push <span className="font-semibold text-theme-primary">{datasetName}</span> to HuggingFace Hub.
            </p>

            <div>
              <label className="block text-sm font-medium text-theme-primary mb-1">
                HF Access Token
              </label>
              <Input
                type="password"
                placeholder="hf_..."
                value={token}
                onChange={(e) => setToken(e.target.value)}
                className="w-full"
              />
              <p className="text-xs text-theme-tertiary mt-1">
                Create a token at huggingface.co/settings/tokens with write access.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-theme-primary mb-1">
                Repository Name
              </label>
              <Input
                placeholder="username/my-so101-dataset"
                value={repoId}
                onChange={(e) => setRepoId(e.target.value)}
                className="w-full"
              />
            </div>

            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="visibility"
                  checked={!isPrivate}
                  onChange={() => setIsPrivate(false)}
                  className="text-primary-500"
                />
                <span className="text-sm text-theme-primary">Public</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="visibility"
                  checked={isPrivate}
                  onChange={() => setIsPrivate(true)}
                  className="text-primary-500"
                />
                <span className="text-sm text-theme-primary">Private</span>
              </label>
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <Button variant="ghost" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={!token.trim() || !repoId.trim()}
              >
                Push Dataset
              </Button>
            </div>
          </>
        )}

        {pushState === 'pushing' && (
          <div className="text-center py-6 space-y-4">
            <div className="animate-spin h-8 w-8 border-4 border-primary-500 border-t-transparent rounded-full mx-auto" />
            <p className="text-sm text-theme-secondary">{progress}</p>
            <p className="text-xs text-theme-tertiary">This may take a few minutes for large datasets.</p>
          </div>
        )}

        {pushState === 'done' && (
          <div className="text-center py-6 space-y-4">
            <div className="text-green-500 text-4xl">&#10003;</div>
            <p className="text-theme-primary font-semibold">Dataset published!</p>
            {resultUrl && (
              <a
                href={resultUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary-500 hover:underline text-sm"
              >
                {resultUrl}
              </a>
            )}
            <div className="pt-4">
              <Button onClick={handleClose}>Close</Button>
            </div>
          </div>
        )}

        {pushState === 'failed' && (
          <div className="text-center py-6 space-y-4">
            <div className="text-red-500 text-4xl">&#10007;</div>
            <p className="text-theme-primary font-semibold">Push failed</p>
            <p className="text-sm text-red-600">{error}</p>
            <div className="flex justify-center gap-3 pt-4">
              <Button variant="ghost" onClick={handleClose}>
                Close
              </Button>
              <Button onClick={() => setPushState('form')}>
                Try Again
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
