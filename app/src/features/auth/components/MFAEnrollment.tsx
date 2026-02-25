/**
 * @file MFAEnrollment.tsx
 * @description TOTP MFA enrollment flow — generates secret, shows QR URL, verifies first code
 * @feature auth
 */

import { useState } from 'react';
import { Input, Button } from '@/shared/components/ui';
import { mfaApi } from '../api/mfaApi';
import type { TOTPSetupResponse } from '../types/auth.types';

// ============================================================================
// TYPES
// ============================================================================

export interface MFAEnrollmentProps {
  onSuccess?: (recoveryCodes: string[]) => void;
  onCancel?: () => void;
}

// ============================================================================
// COMPONENT
// ============================================================================

export function MFAEnrollment({ onSuccess, onCancel }: MFAEnrollmentProps) {
  const [step, setStep] = useState<'init' | 'verify' | 'done'>('init');
  const [setup, setSetup] = useState<TOTPSetupResponse | null>(null);
  const [token, setToken] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleStartSetup = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await mfaApi.setupTOTP();
      setSetup(result);
      setStep('verify');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start TOTP setup');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerify = async () => {
    if (!setup || !token.trim()) return;

    setIsLoading(true);
    setError(null);
    try {
      const result = await mfaApi.verifySetupTOTP(setup.secret, token.trim());
      setRecoveryCodes(result.recoveryCodes);
      setStep('done');
      onSuccess?.(result.recoveryCodes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid code. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  // Step 1: Initiate setup
  if (step === 'init') {
    return (
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Enable Two-Factor Authentication
        </h3>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Add an extra layer of security to your account using a TOTP authenticator app.
        </p>
        {error && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
            {error}
          </div>
        )}
        <div className="flex gap-3">
          <Button variant="primary" onClick={handleStartSetup} isLoading={isLoading}>
            Set up TOTP
          </Button>
          {onCancel && (
            <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          )}
        </div>
      </div>
    );
  }

  // Step 2: Show secret + verify code
  if (step === 'verify' && setup) {
    return (
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Scan QR Code
        </h3>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Scan the QR code below with your authenticator app (Google Authenticator, Authy, etc.),
          or manually enter the secret key.
        </p>

        {/* QR Code */}
        <div className="flex justify-center">
          <img
            src={setup.qrCodeUrl}
            alt="TOTP QR Code"
            className="h-48 w-48 rounded-lg border border-zinc-200 dark:border-zinc-700"
          />
        </div>

        {/* Secret key for manual entry */}
        <div className="rounded-lg bg-zinc-100 p-3 dark:bg-zinc-800">
          <p className="mb-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Manual entry key:
          </p>
          <code className="break-all text-sm font-mono text-zinc-900 dark:text-zinc-100">
            {setup.secret}
          </code>
        </div>

        {/* Verification input */}
        <Input
          id="totp-verify"
          type="text"
          label="Verification code"
          placeholder="Enter 6-digit code"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          maxLength={6}
          pattern="[0-9]*"
          inputMode="numeric"
          autoComplete="one-time-code"
          disabled={isLoading}
        />

        {error && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <Button
            variant="primary"
            onClick={handleVerify}
            isLoading={isLoading}
            disabled={token.length < 6}
          >
            Verify & Enable
          </Button>
          {onCancel && (
            <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          )}
        </div>
      </div>
    );
  }

  // Step 3: Show recovery codes
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-green-700 dark:text-green-400">
        Two-Factor Authentication Enabled
      </h3>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Save these recovery codes in a safe place. Each code can only be used once.
      </p>
      <div className="grid grid-cols-2 gap-2 rounded-lg bg-zinc-100 p-4 dark:bg-zinc-800">
        {recoveryCodes.map((code, i) => (
          <code key={i} className="font-mono text-sm text-zinc-900 dark:text-zinc-100">
            {code}
          </code>
        ))}
      </div>
      <Button variant="primary" onClick={onCancel}>
        Done
      </Button>
    </div>
  );
}
