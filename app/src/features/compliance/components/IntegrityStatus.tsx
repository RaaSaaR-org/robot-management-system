/**
 * @file IntegrityStatus.tsx
 * @description Integrity view: verifies the tamper-evident hash chain of the
 *              audit log and lists every broken link it finds.
 * @feature compliance
 */

import { Link2Off, ShieldCheck } from 'lucide-react';
import {
  Button, DataTable, EmptyState, KeyValueList, Panel, ProgressBar, StatusTag, type DataTableColumn,
} from '@/shared/components/ui';
import type { HashChainVerificationResult } from '../types';
import { formatDateTime } from './complianceFormat';

export interface IntegrityStatusProps {
  result: HashChainVerificationResult | null;
  isVerifying?: boolean;
  onVerify?: () => void;
  className?: string;
}

type BrokenLink = HashChainVerificationResult['brokenLinks'][number];

const LINK_COLUMNS: DataTableColumn<BrokenLink>[] = [
  { key: 'timestamp', header: 'Time', sortable: true, sortValue: (l) => new Date(l.timestamp),
    cell: (l) => <span className="whitespace-nowrap text-[13px] text-ink-tertiary">{formatDateTime(l.timestamp)}</span> },
  { key: 'logId', header: 'Log ID', cell: (l) => <span className="font-mono text-[13px] text-ink-secondary">{l.logId}</span> },
  { key: 'expectedHash', header: 'Expected previous hash', hideBelow: 'lg',
    cell: (l) => <span className="font-mono text-[13px] text-ink-tertiary" title={l.expectedHash}>{l.expectedHash.slice(0, 16)}…</span> },
  { key: 'actualPreviousHash', header: 'Found', hideBelow: 'lg',
    cell: (l) => <span className="font-mono text-[13px] text-ink-tertiary" title={l.actualPreviousHash}>{l.actualPreviousHash.slice(0, 16)}…</span> },
];

/** Hash-chain verification: status, coverage and broken links. */
export function IntegrityStatus({ result, isVerifying, onVerify, className }: IntegrityStatusProps) {
  const verifyButton = (
    <Button
      variant={result ? 'secondary' : 'primary'}
      leftIcon={<ShieldCheck className="h-4 w-4" strokeWidth={1.75} />}
      isLoading={isVerifying}
      loadingText="Verifying…"
      onClick={() => onVerify?.()}
    >
      Verify now
    </Button>
  );

  return (
    <div className={className ? `flex flex-col gap-4 ${className}` : 'flex flex-col gap-4'}>
      <Panel>
        <Panel.Header
          title="Hash chain"
          description="Every entry carries the hash of the one before it, so any edit or deletion breaks the chain."
          actions={verifyButton}
        />
        <Panel.Body>
          {!result ? (
            <EmptyState
              size="sm"
              icon={<ShieldCheck />}
              title="Not verified yet"
              description="Verification recomputes every hash in the log. It takes a few seconds."
            />
          ) : (
            <div className="flex flex-col gap-5">
              <div className="flex flex-wrap items-center gap-3">
                <StatusTag tone={result.isValid ? 'live' : 'stopped'} dot>
                  {result.isValid ? 'Chain intact' : 'Chain broken'}
                </StatusTag>
                <span className="text-[13px] text-ink-tertiary">Verified {formatDateTime(result.verifiedAt)}</span>
              </div>
              <ProgressBar
                value={result.verifiedLogs}
                max={Math.max(result.totalLogs, 1)}
                variant={result.isValid ? 'success' : 'warning'}
                label={`${result.verifiedLogs.toLocaleString()} of ${result.totalLogs.toLocaleString()} entries verified`}
              />
              <KeyValueList
                columns={3}
                items={[
                  { label: 'First entry', value: formatDateTime(result.firstLogTimestamp) },
                  { label: 'Last entry', value: formatDateTime(result.lastLogTimestamp) },
                  { label: 'Broken links', value: result.brokenLinks.length.toLocaleString() },
                ]}
              />
            </div>
          )}
        </Panel.Body>
      </Panel>

      {result && result.brokenLinks.length > 0 && (
        <Panel padding="none">
          <Panel.Header
            title="Broken links"
            description="Entries whose stored previous hash does not match the entry before them. Investigate before relying on this period."
          />
          <DataTable
            caption="Broken hash chain links"
            columns={LINK_COLUMNS}
            rows={result.brokenLinks}
            getRowId={(l) => l.logId}
            defaultSort={{ key: 'timestamp', direction: 'desc' }}
            dense
            empty={<EmptyState size="sm" icon={<Link2Off />} title="No broken links" />}
          />
        </Panel>
      )}
    </div>
  );
}
