/**
 * @file RunExportNotice.tsx
 * @description What an exported run manifest says will not travel with the run
 * @feature training
 */

import { AlertTriangle } from 'lucide-react';

export interface RunExportNoticeProps {
  warnings: string[] | null;
  error: string | null;
}

export function RunExportNotice({ warnings, error }: RunExportNoticeProps) {
  return (
    <>
      {warnings && warnings.length > 0 && (
        <div
          data-testid="export-warnings"
          role="alert"
          className="flex items-start gap-2 rounded-control border border-signal-unknown/30 bg-signal-unknown/10 px-3 py-2 text-sm text-ink-primary"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-signal-unknown" strokeWidth={1.75} />
          <ul className="flex min-w-0 flex-col gap-1">
            {warnings.map((warning) => (
              <li key={warning} className="break-words">{warning}</li>
            ))}
          </ul>
        </div>
      )}
      {warnings && warnings.length === 0 && (
        <p data-testid="export-clean" className="text-sm text-ink-tertiary">
          Exported. Every dataset in this run is reachable from another machine.
        </p>
      )}
      {error && (
        <div
          role="alert"
          className="rounded-control border border-signal-stopped/30 bg-signal-stopped/10 px-3 py-2 text-sm text-ink-primary"
        >
          {error}
        </div>
      )}
    </>
  );
}
