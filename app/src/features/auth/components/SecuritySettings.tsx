/**
 * @file SecuritySettings.tsx
 * @description MFA security settings panel — enable/disable TOTP, view status
 * @feature auth
 * @regulatory NIS2 Art. 21(2)(j)
 */

import { useState, useEffect, useCallback } from 'react';
import { Card, Button } from '@/shared/components/ui';
import { authApi } from '../api/authApi';
import type { MFAStatus } from '../types/auth.types';
import { MFASetup } from './MFASetup';

// ============================================================================
// COMPONENT
// ============================================================================

export function SecuritySettings() {
  const [mfaStatus, setMfaStatus] = useState<MFAStatus | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const status = await authApi.mfaGetStatus();
      setMfaStatus(status);
    } catch {
      setError('Failed to load MFA status');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleDisableMFA = async () => {
    if (!confirm('Are you sure you want to disable two-factor authentication? This will make your account less secure.')) {
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      await authApi.mfaDisableTotp();
      await fetchStatus();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to disable MFA';
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSetupComplete = async () => {
    setShowSetup(false);
    setIsLoading(true);
    await fetchStatus();
  };

  if (showSetup) {
    return (
      <MFASetup
        onComplete={handleSetupComplete}
        onCancel={() => setShowSetup(false)}
      />
    );
  }

  return (
    <Card className="p-6">
      <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">
        Two-Factor Authentication
      </h2>

      {error && (
        <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">Loading...</p>
      ) : mfaStatus?.mfaEnabled ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-green-500" />
            <span className="text-sm font-medium text-green-700 dark:text-green-400">
              Enabled
            </span>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Your account is protected with TOTP two-factor authentication.
          </p>
          <Button
            variant="secondary"
            onClick={handleDisableMFA}
            isLoading={isLoading}
          >
            Disable 2FA
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-gray-400" />
            <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
              Not Enabled
            </span>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Add an extra layer of security to your account by enabling two-factor authentication.
          </p>
          <Button variant="primary" onClick={() => setShowSetup(true)}>
            Set Up 2FA
          </Button>
        </div>
      )}
    </Card>
  );
}
