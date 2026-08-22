/**
 * @file DatasetUploadModal.tsx
 * @description Modal for uploading new datasets with drag-and-drop
 * @feature training
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { AlertTriangle, CameraOff, CheckCircle2, XCircle } from 'lucide-react';
import { Modal, Button, Input, ProgressBar, Spinner } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
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

  // The select had no source. `robotTypes` defaults to `[]`, `DatasetsPage`
  // never passed it, and `robotTypeId` is required — so the modal could not be
  // completed from the page that opens it, whatever the server did.
  useEffect(() => {
    if (!isOpen || robotTypes.length > 0) return;
    let cancelled = false;
    trainingApi.listRobotTypes()
      .then((types) => { if (!cancelled) setFetchedTypes(types); })
      .catch(() => { if (!cancelled) setFetchedTypes([]); });
    return () => { cancelled = true; };
  }, [isOpen, robotTypes.length]);

  const availableTypes = robotTypes.length > 0 ? robotTypes : fetchedTypes;

  const resetForm = useCallback(() => {
    setStep('metadata');
    setForm({ name: '', description: '', robotTypeId: '' });
    setFile(null);
    setUploadProgress(0);
    setError(null);
    setValidated(null);
    setDatasetId(null); // eslint-disable-line @typescript-eslint/no-unused-vars
  }, []);

  const handleClose = useCallback(() => {
    resetForm();
    onClose();
  }, [resetForm, onClose]);

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
    if (!form.name || !form.robotTypeId) {
      setError('Please fill in all required fields');
      return;
    }

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
  const pollValidation = useCallback(async (id: string): Promise<Dataset | null> => {
    const deadline = Date.now() + VALIDATION_TIMEOUT_MS;
    for (;;) {
      try {
        const dataset = await trainingApi.getDataset(id);
        if (dataset.status !== 'validating' && dataset.status !== 'uploading') return dataset;
        if (Date.now() > deadline) return dataset;
      } catch {
        if (Date.now() > deadline) return null;
      }
      await new Promise((r) => setTimeout(r, VALIDATION_POLL_MS));
    }
  }, []);

  const handleUpload = useCallback(async () => {
    if (!file) {
      setError('Please select a file');
      return;
    }

    setError(null);
    setUploadProgress(0);

    try {
      // Create dataset record
      const dataset = await trainingApi.createDataset({
        name: form.name,
        description: form.description || undefined,
        robotTypeId: form.robotTypeId,
      });

      setDatasetId(dataset.id);

      // Get presigned upload URL
      const { uploadUrl } = await trainingApi.initiateUpload(
        dataset.id,
        file.type || 'application/gzip',
        file.size
      );

      // Upload file with progress tracking
      await uploadFileWithProgress(uploadUrl, file, setUploadProgress);

      // Mark upload as complete
      await trainingApi.completeUpload(dataset.id);

      setStep('validating');

      // POLL the real thing. This used to be `setTimeout(2000)` with a comment
      // saying "in reality, would poll", followed unconditionally by a green
      // tick and "your dataset will be ready for training soon" — including for
      // a dataset that had just failed. Validation now opens every file the
      // manifest names, so it has something to say and the operator should see
      // it here rather than find out during a training run.
      const finished = await pollValidation(dataset.id);
      setValidated(finished);
      setStep('complete');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    }
  }, [file, form]);

  const handleComplete = useCallback(() => {
    onSuccess?.();
    handleClose();
  }, [onSuccess, handleClose]);

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Upload Dataset" size="lg">
      <div className="space-y-6">
        {/* Step indicator */}
        <div className="flex items-center justify-center gap-2 text-sm">
          {(['metadata', 'upload', 'validating', 'complete'] as Step[]).map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div
                className={cn(
                  'w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium',
                  step === s
                    ? 'bg-cobalt-500 text-white'
                    : i < ['metadata', 'upload', 'validating', 'complete'].indexOf(step)
                      ? 'bg-green-500 text-white'
                      : 'bg-theme-secondary/20 text-theme-secondary'
                )}
              >
                {i + 1}
              </div>
              {i < 3 && <div className="w-8 h-0.5 bg-theme-secondary/20" />}
            </div>
          ))}
        </div>

        {/* Step content */}
        {step === 'metadata' && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-theme-primary mb-1">
                Dataset Name *
              </label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g., pick-and-place-v1"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-theme-primary mb-1">
                Description
              </label>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Describe the dataset..."
                className="w-full px-3 py-2 rounded-brand border border-theme-secondary/30 bg-theme-primary text-theme-primary focus:outline-none focus:ring-2 focus:ring-cobalt-500"
                rows={3}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-theme-primary mb-1">
                Robot Type *
              </label>
              <select
                value={form.robotTypeId}
                onChange={(e) => setForm({ ...form, robotTypeId: e.target.value })}
                className="w-full px-3 py-2 rounded-brand border border-theme-secondary/30 bg-theme-primary text-theme-primary focus:outline-none focus:ring-2 focus:ring-cobalt-500"
              >
                <option value="">Select robot type...</option>
                {availableTypes.map((rt) => (
                  <option key={rt.id} value={rt.id}>
                    {rt.name} ({rt.manufacturer})
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {step === 'upload' && (
          <div className="space-y-4">
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                'border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors',
                isDragging
                  ? 'border-cobalt-500 bg-cobalt-500/10'
                  : 'border-theme-secondary/30 hover:border-cobalt-500/50'
              )}
            >
              <input
                ref={fileInputRef}
                type="file"
                onChange={handleFileSelect}
                accept=".tar.gz,.tgz,.zip"
                className="hidden"
              />

              {file ? (
                <div>
                  <p className="font-medium text-theme-primary">{file.name}</p>
                  <p className="text-sm text-theme-secondary mt-1">
                    {formatFileSize(file.size)}
                  </p>
                </div>
              ) : (
                <div>
                  <p className="text-theme-primary">
                    Drag and drop your dataset here, or click to browse
                  </p>
                  <p className="text-sm text-theme-secondary mt-1">
                    Supports .tar.gz and .zip files (LeRobot v3 format)
                  </p>
                </div>
              )}
            </div>

            {uploadProgress > 0 && uploadProgress < 100 && (
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span>Uploading...</span>
                  <span>{uploadProgress}%</span>
                </div>
                <ProgressBar value={uploadProgress} />
              </div>
            )}
          </div>
        )}

        {step === 'validating' && (
          <div className="text-center py-8">
            <Spinner size="lg" />
            <p className="mt-4 text-theme-primary">Validating dataset...</p>
            <p className="text-sm text-theme-secondary mt-1">
              Checking LeRobot format and computing statistics
            </p>
          </div>
        )}

        {step === 'complete' && (
          <div className="py-8">
            {/* What the server ACTUALLY found. This step used to show a green
                tick and "will be ready for training soon" unconditionally, two
                seconds after the upload, including for a dataset that had just
                failed validation — and before TASK-217 the upload path could
                not succeed at all, so that was the only thing it ever showed. */}
            {validated?.status === 'failed' ? (
              <div className="text-center" data-testid="upload-failed">
                <div className="w-16 h-16 bg-red-100 dark:bg-red-500/15 rounded-full flex items-center justify-center mx-auto">
                  <XCircle className="w-8 h-8 text-red-600 dark:text-red-400" />
                </div>
                <p className="mt-4 text-lg font-medium text-theme-primary">
                  Uploaded, but it did not validate
                </p>
                <p className="text-sm text-theme-secondary mt-1">
                  The files are on the server; the dataset cannot be trained on as it stands.
                </p>
                {validated.validation?.errors.length ? (
                  <ul className="mt-4 text-left text-sm text-red-700 dark:text-red-300 space-y-1 max-h-40 overflow-y-auto">
                    {validated.validation.errors.slice(0, 6).map((finding) => (
                      <li key={`${finding.code}-${finding.message}`} className="flex items-start gap-2">
                        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                        <span className="break-words">{finding.message}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : (
              <div className="text-center" data-testid="upload-complete">
                <div className="w-16 h-16 bg-green-100 dark:bg-green-500/15 rounded-full flex items-center justify-center mx-auto">
                  <CheckCircle2 className="w-8 h-8 text-green-600 dark:text-green-400" />
                </div>
                <p className="mt-4 text-lg font-medium text-theme-primary">
                  {validated?.status === 'ready' ? 'Dataset uploaded and validated' : 'Dataset uploaded'}
                </p>
                <p className="text-sm text-theme-secondary mt-1">
                  {validated?.status === 'ready'
                    ? `${validated.demonstrationCount} episodes, ${validated.totalFrames.toLocaleString()} frames.`
                    : 'Still validating — it will finish in the background.'}
                </p>
                {validated?.validation?.warnings.some((w) => w.code === 'NO_IMAGE_FEATURES') && (
                  <div
                    data-testid="upload-no-images"
                    className="mt-4 flex items-start gap-2 rounded-md bg-amber-50 dark:bg-amber-500/10 px-3 py-2 text-left text-sm text-amber-800 dark:text-amber-300"
                  >
                    <CameraOff className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>
                      No camera features. A vision-language-action policy cannot train on this —
                      training fails with &ldquo;All image features are missing from the batch&rdquo;.
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className="p-3 bg-red-100 text-red-700 rounded-lg text-sm">{error}</div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-3">
          {step !== 'complete' && (
            <Button variant="ghost" onClick={handleClose}>
              Cancel
            </Button>
          )}

          {step === 'metadata' && (
            <Button onClick={handleMetadataSubmit}>Continue</Button>
          )}

          {step === 'upload' && (
            <Button onClick={handleUpload} isLoading={uploadProgress > 0 && uploadProgress < 100}>
              Upload
            </Button>
          )}

          {step === 'complete' && <Button onClick={handleComplete}>Done</Button>}
        </div>
      </div>
    </Modal>
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
