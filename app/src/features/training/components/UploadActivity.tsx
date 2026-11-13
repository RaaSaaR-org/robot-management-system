/**
 * @file UploadActivity.tsx
 * @description The dataset upload this tab is running, in the top bar
 *              (TASK-481): a chip with the percentage that brings the upload
 *              dialog back from any page. It is what makes "the dialog is
 *              closed but the upload is still going" visible. Nothing renders
 *              while nothing is uploading.
 * @feature training
 */

import { AlertTriangle, Loader2, UploadCloud } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/shared/components/ui';
import { uploadPercent, useDatasetUploadStore, type UploadJob } from '../store/datasetUploadStore';

/** What the chip says, and its accessible name. */
export function describeUploadChip(job: UploadJob): { text: string; label: string } {
  switch (job.phase) {
    case 'failed':
      return { text: 'Upload stopped', label: `The upload of ${job.name} stopped — open it to try again` };
    case 'cancelling':
      return { text: 'Cancelling', label: `Cancelling the upload of ${job.name}` };
    case 'processing':
      return { text: 'Verifying', label: `${job.name} is uploaded; the server is verifying it` };
    case 'validating':
      return { text: 'Validating', label: `${job.name} is uploaded; the server is validating it` };
    default: {
      const percent = Math.floor(uploadPercent(job) ?? 0);
      return { text: `${percent}%`, label: `Uploading ${job.name}: ${percent}%` };
    }
  }
}

export function UploadActivity() {
  const job = useDatasetUploadStore((state) => state.job);
  const openDialog = useDatasetUploadStore((state) => state.openDialog);
  const navigate = useNavigate();
  const location = useLocation();
  if (!job) return null;

  const { text, label } = describeUploadChip(job);
  const failed = job.phase === 'failed';
  const sending = job.phase === 'starting' || job.phase === 'uploading' || job.phase === 'finishing';
  const Icon = failed ? AlertTriangle : sending ? UploadCloud : Loader2;

  return (
    <Button
      variant="ghost"
      title={label}
      aria-label={label}
      className="gap-1.5 px-2"
      data-testid="upload-activity-button"
      onClick={() => {
        // The dialog lives on the datasets page.
        if (location.pathname !== '/datasets') navigate('/datasets');
        openDialog();
      }}
    >
      <Icon
        className={failed ? 'h-5 w-5 text-signal-stopped' : sending ? 'h-5 w-5' : 'h-5 w-5 animate-spin'}
        strokeWidth={1.75}
      />
      <span className="hidden text-xs font-medium tabular-nums text-ink-primary sm:inline">{text}</span>
    </Button>
  );
}
