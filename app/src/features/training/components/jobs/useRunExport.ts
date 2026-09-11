/**
 * @file useRunExport.ts
 * @description Export a training run's manifest as a JSON file and keep what the manifest warns about
 * @feature training
 */

import { useCallback, useState } from 'react';
import { trainingApi } from '../../api';
import { getErrorMessage } from '@/shared/utils';

export interface RunExportState {
  isExporting: boolean;
  /** null until an export ran; [] means every dataset travels with the run. */
  warnings: string[] | null;
  error: string | null;
  exportRun: () => Promise<void>;
}

export function useRunExport(jobId: string): RunExportState {
  const [isExporting, setIsExporting] = useState(false);
  const [warnings, setWarnings] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const exportRun = useCallback(async () => {
    setIsExporting(true);
    setError(null);
    try {
      const manifest = await trainingApi.exportTrainingRun(jobId);
      // Shown on screen, not only inside the file: "this dataset lives on one
      // laptop and the cluster cannot reach it" is exactly the thing nobody
      // discovers by opening a downloaded JSON.
      setWarnings(manifest.warnings ?? []);
      downloadJson(manifest, `neodem-run-${jobId}.json`);
    } catch (err) {
      setError(getErrorMessage(err, 'Could not export this run'));
    } finally {
      setIsExporting(false);
    }
  }, [jobId]);

  return { isExporting, warnings, error, exportRun };
}

/**
 * Hand the manifest to the browser as a file.
 *
 * The warnings are set before this runs, so a browser that refuses the
 * download costs the file and not what the file had to say.
 */
export function downloadJson(payload: unknown, filename: string): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  // IN the document before it is clicked: a detached anchor's `click()` is a
  // no-op in Firefox, which downloads nothing and says nothing.
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    // NOT synchronously: revoking in the same tick pulls the bytes out from
    // under a fetch that has not happened yet, and the browser cancels it.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
