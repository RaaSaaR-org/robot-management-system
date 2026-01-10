/**
 * @file IntegrityStatus.tsx
 * @description Component for displaying hash chain verification status
 * @feature compliance
 */

import { cn } from '@/shared/utils/cn';
import { Card } from '@/shared/components/ui/Card';
import { Button } from '@/shared/components/ui/Button';
import type { HashChainVerificationResult } from '../types';

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export interface IntegrityStatusProps {
  result: HashChainVerificationResult | null;
  isVerifying?: boolean;
  onVerify?: () => void;
  className?: string;
}

/**
 * Displays hash chain verification status
 */
export function IntegrityStatus({
  result,
  isVerifying,
  onVerify,
  className,
}: IntegrityStatusProps) {
  return (
    <div className={cn('space-y-4', className)}>
      {/* Verification Control */}
      <Card className="glass-card p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-medium text-theme-primary">Hash Chain Verification</h3>
            <p className="text-sm text-theme-tertiary mt-1">
              Verify the integrity of all compliance logs using cryptographic hash chains.
            </p>
          </div>
          <Button
            onClick={() => onVerify?.()}
            disabled={isVerifying}
            variant="primary"
          >
            {isVerifying ? 'Verifying...' : 'Verify Integrity'}
          </Button>
        </div>
      </Card>

      {/* Results */}
      {result && (
        <>
          {/* Status Summary */}
          <Card
            className={cn(
              'glass-card p-6',
              result.isValid
                ? 'border-green-500/50 bg-green-500/10'
                : 'border-red-500/50 bg-red-500/10'
            )}
          >
            <div className="flex items-center gap-4">
              {result.isValid ? (
                <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center">
                  <svg
                    className="w-10 h-10 text-green-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                    />
                  </svg>
                </div>
              ) : (
                <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center">
                  <svg
                    className="w-10 h-10 text-red-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                </div>
              )}
              <div>
                <h4 className={cn(
                  'text-xl font-bold',
                  result.isValid ? 'text-green-400' : 'text-red-400'
                )}>
                  {result.isValid ? 'Integrity Verified' : 'Integrity Compromised'}
                </h4>
                <p className={cn(
                  'text-sm mt-1',
                  result.isValid ? 'text-green-300/80' : 'text-red-300/80'
                )}>
                  {result.isValid
                    ? 'All logs have valid hash chain links. No tampering detected.'
                    : `${result.brokenLinks.length} broken link(s) detected in the hash chain.`}
                </p>
              </div>
            </div>
          </Card>

          {/* Statistics */}
          <Card className="glass-card p-4">
            <h4 className="font-medium text-theme-primary mb-4">Verification Details</h4>
            <dl className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center p-3 bg-gray-800/50 rounded-lg">
                <dt className="text-2xl font-bold text-theme-primary">{result.totalLogs}</dt>
                <dd className="text-sm text-theme-tertiary">Total Logs</dd>
              </div>
              <div className="text-center p-3 bg-gray-800/50 rounded-lg">
                <dt className="text-2xl font-bold text-green-400">{result.verifiedLogs}</dt>
                <dd className="text-sm text-theme-tertiary">Verified</dd>
              </div>
              <div className="text-center p-3 bg-gray-800/50 rounded-lg">
                <dt className="text-2xl font-bold text-red-400">{result.brokenLinks.length}</dt>
                <dd className="text-sm text-theme-tertiary">Broken Links</dd>
              </div>
              <div className="text-center p-3 bg-gray-800/50 rounded-lg">
                <dt className="text-sm font-mono text-theme-primary">
                  {formatDate(result.verifiedAt)}
                </dt>
                <dd className="text-sm text-theme-tertiary">Last Verified</dd>
              </div>
            </dl>
          </Card>

          {/* Date Range */}
          {result.firstLogTimestamp && result.lastLogTimestamp && (
            <Card className="glass-card p-4">
              <h4 className="font-medium text-theme-primary mb-3">Log Coverage</h4>
              <dl className="flex items-center gap-4 text-sm">
                <div>
                  <dt className="text-theme-tertiary">First Log</dt>
                  <dd className="text-theme-secondary">{formatDate(result.firstLogTimestamp)}</dd>
                </div>
                <div className="text-theme-tertiary">to</div>
                <div>
                  <dt className="text-theme-tertiary">Last Log</dt>
                  <dd className="text-theme-secondary">{formatDate(result.lastLogTimestamp)}</dd>
                </div>
              </dl>
            </Card>
          )}

          {/* Broken Links (if any) */}
          {result.brokenLinks.length > 0 && (
            <Card className="glass-card p-4 border-red-500/50">
              <h4 className="font-medium text-red-400 mb-3">Broken Links Detected</h4>
              <p className="text-sm text-theme-tertiary mb-4">
                The following logs have hash chain inconsistencies, indicating potential tampering:
              </p>
              <div className="space-y-3">
                {result.brokenLinks.map((link, index) => (
                  <div key={index} className="bg-red-900/20 p-3 rounded-lg text-sm">
                    <div className="flex justify-between items-start mb-2">
                      <span className="font-mono text-red-300">{link.logId}</span>
                      <span className="text-theme-tertiary">{formatDate(link.timestamp)}</span>
                    </div>
                    <dl className="space-y-1 text-xs">
                      <div>
                        <dt className="text-theme-tertiary inline">Expected: </dt>
                        <dd className="font-mono text-red-400 inline break-all">
                          {link.expectedHash.slice(0, 32)}...
                        </dd>
                      </div>
                      <div>
                        <dt className="text-theme-tertiary inline">Actual: </dt>
                        <dd className="font-mono text-red-400 inline break-all">
                          {link.actualPreviousHash.slice(0, 32)}...
                        </dd>
                      </div>
                    </dl>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}

      {/* Empty state */}
      {!result && !isVerifying && (
        <Card className="glass-card p-6 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gray-800/50 flex items-center justify-center">
            <svg
              className="w-8 h-8 text-theme-tertiary"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
              />
            </svg>
          </div>
          <p className="text-theme-secondary">Click "Verify Integrity" to check the hash chain</p>
          <p className="text-theme-tertiary text-sm mt-2">
            This verifies that no logs have been tampered with since creation.
          </p>
        </Card>
      )}
    </div>
  );
}
