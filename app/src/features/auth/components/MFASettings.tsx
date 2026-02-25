/**
 * @file MFASettings.tsx
 * @description MFA settings panel — view active methods, manage recovery codes, disable MFA
 * @feature auth
 */

import { useState, useEffect } from 'react';
import { Button } from '@/shared/components/ui';
import { mfaApi } from '../api/mfaApi';
import type { MFAStatus, RecoveryCodeInfo } from '../types/auth.types';
import { MFAEnrollment } from './MFAEnrollment';

// ============================================================================
// TYPES
// ============================================================================

export interface MFASettingsProps {
  className?: string;
}

// ============================================================================
// COMPONENT
// ============================================================================

export function MFASettings({ className = '' }: MFASettingsProps) {
  const [status, setStatus] = useState<MFAStatus | null>(null);
  const [recoveryInfo, setRecoveryInfo] = useState<RecoveryCodeInfo | null>(null);
  const [showEnrollment, setShowEnrollment] = useState(false);
  const [newRecoveryCodes, setNewRecoveryCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadStatus = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [mfaStatus, recovCodes] = await Promise.all([
        mfaApi.getStatus(),
        mfaApi.getRecoveryCodes(),
      ]);
      setStatus(mfaStatus);
      setRecoveryInfo(recovCodes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load MFA status');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();
  }, []);

  const handleRemoveCredential = async (credentialId: string) => {
    try {
      await mfaApi.removeCredential(credentialId);
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove credential');
    }
  };

  const handleGenerateRecoveryCodes = async () => {
    try {
      const result = await mfaApi.generateRecoveryCodes();
      setNewRecoveryCodes(result.codes);
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate recovery codes');
    }
  };

  if (showEnrollment) {
    return (
      <div className={className}>
        <MFAEnrollment
          onSuccess={() => {
            setShowEnrollment(false);
            loadStatus();
          }}
          onCancel={() => setShowEnrollment(false)}
        />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className={`${className} flex items-center justify-center py-8`}>
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className={`${className} space-y-6`}>
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Two-Factor Authentication
        </h3>
        {status?.enabled ? (
          <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
            Enabled
          </span>
        ) : (
          <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
            Disabled
          </span>
        )}
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Active methods */}
      {status?.methods && status.methods.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Active Methods
          </h4>
          {status.methods.map((method) => (
            <div
              key={method.id}
              className="flex items-center justify-between rounded-lg border border-zinc-200 p-3 dark:border-zinc-700"
            >
              <div>
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  {method.name}
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {method.type.toUpperCase()} &middot; Added{' '}
                  {new Date(method.createdAt).toLocaleDateString()}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleRemoveCredential(method.id)}
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Recovery codes info */}
      {recoveryInfo && status?.enabled && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Recovery Codes
          </h4>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {recoveryInfo.remaining} of {recoveryInfo.total} recovery codes remaining.
          </p>
          <Button variant="secondary" size="sm" onClick={handleGenerateRecoveryCodes}>
            Generate New Codes
          </Button>
        </div>
      )}

      {/* Display newly generated recovery codes */}
      {newRecoveryCodes && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-yellow-700 dark:text-yellow-400">
            New Recovery Codes — Save these now!
          </h4>
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-zinc-100 p-4 dark:bg-zinc-800">
            {newRecoveryCodes.map((code, i) => (
              <code key={i} className="font-mono text-sm text-zinc-900 dark:text-zinc-100">
                {code}
              </code>
            ))}
          </div>
          <Button variant="ghost" size="sm" onClick={() => setNewRecoveryCodes(null)}>
            Dismiss
          </Button>
        </div>
      )}

      {/* Enable/Setup button */}
      {!status?.enabled && (
        <Button variant="primary" onClick={() => setShowEnrollment(true)}>
          Enable Two-Factor Authentication
        </Button>
      )}
    </div>
  );
}
