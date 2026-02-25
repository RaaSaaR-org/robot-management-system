/**
 * @file MFASetup.tsx
 * @description TOTP MFA setup wizard — generates secret, shows otpauth URL, verifies code
 * @feature auth
 * @regulatory NIS2 Art. 21(2)(j)
 */

import { useState } from 'react';
import { Input, Button, Card } from '@/shared/components/ui';
import { authApi } from '../api/authApi';

// ============================================================================
// TYPES
// ============================================================================

export interface MFASetupProps {
  onComplete?: () => void;
  onCancel?: () => void;
}

type SetupStep = 'init' | 'verify' | 'recovery' | 'done';

// ============================================================================
// COMPONENT
// ============================================================================

export function MFASetup({ onComplete, onCancel }: MFASetupProps) {
  const [step, setStep] = useState<SetupStep>('init');
  const [secret, setSecret] = useState('');
  const [otpauthUrl, setOtpauthUrl] = useState('');
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [savedConfirmed, setSavedConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Step 1: Generate secret
  const handleStartSetup = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await authApi.mfaTotpSetup();
      setSecret(result.secret);
      setOtpauthUrl(result.otpauthUrl);
      setStep('verify');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to start MFA setup';
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  // Step 2: Verify code
  const handleVerifyCode = async () => {
    if (code.length !== 6) {
      setError('Please enter a 6-digit code');
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const result = await authApi.mfaTotpVerify(secret, code);
      setRecoveryCodes(result.recoveryCodes);
      setStep('recovery');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Invalid code. Please try again.';
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  // Step 3: Confirm recovery codes saved
  const handleConfirmSaved = () => {
    setStep('done');
    onComplete?.();
  };

  return (
    <div className="space-y-6">
      {/* Step 1: Init */}
      {step === 'init' && (
        <Card className="p-6">
          <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">
            Set up Two-Factor Authentication
          </h3>
          <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
            Protect your account with TOTP-based two-factor authentication.
            You will need an authenticator app like Google Authenticator, Authy, or 1Password.
          </p>
          {error && (
            <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
              {error}
            </div>
          )}
          <div className="flex gap-3">
            <Button variant="primary" onClick={handleStartSetup} isLoading={isLoading}>
              Start Setup
            </Button>
            {onCancel && (
              <Button variant="secondary" onClick={onCancel}>
                Cancel
              </Button>
            )}
          </div>
        </Card>
      )}

      {/* Step 2: Verify */}
      {step === 'verify' && (
        <Card className="p-6">
          <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">
            Configure Your Authenticator App
          </h3>
          <div className="mb-4 space-y-3">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Add this account to your authenticator app using the URL or manual key below:
            </p>
            <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-800">
              <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
                OTPAuth URL (copy into your app)
              </label>
              <p className="break-all font-mono text-xs text-gray-900 dark:text-gray-200">
                {otpauthUrl}
              </p>
            </div>
            <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-800">
              <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
                Manual Key
              </label>
              <p className="font-mono text-sm font-bold tracking-wider text-gray-900 dark:text-gray-200">
                {secret}
              </p>
            </div>
          </div>

          <div className="mb-4">
            <Input
              id="mfa-code"
              label="Verification Code"
              placeholder="123456"
              value={code}
              onChange={(e) => {
                setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
                setError(null);
              }}
              error={error ?? undefined}
              autoComplete="one-time-code"
              inputMode="numeric"
              maxLength={6}
            />
          </div>

          <div className="flex gap-3">
            <Button
              variant="primary"
              onClick={handleVerifyCode}
              isLoading={isLoading}
              disabled={code.length !== 6}
            >
              Verify &amp; Enable
            </Button>
            {onCancel && (
              <Button variant="secondary" onClick={onCancel}>
                Cancel
              </Button>
            )}
          </div>
        </Card>
      )}

      {/* Step 3: Recovery codes */}
      {step === 'recovery' && (
        <Card className="p-6">
          <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">
            Save Your Recovery Codes
          </h3>
          <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
            Store these recovery codes in a safe place. Each code can only be used once.
            If you lose access to your authenticator app, these codes are the only way to
            recover your account.
          </p>

          <div className="mb-4 grid grid-cols-2 gap-2 rounded-lg bg-gray-50 p-4 dark:bg-gray-800">
            {recoveryCodes.map((rc, i) => (
              <code
                key={i}
                className="rounded bg-white px-2 py-1 text-center font-mono text-sm text-gray-900 dark:bg-gray-700 dark:text-gray-200"
              >
                {rc}
              </code>
            ))}
          </div>

          <label className="mb-4 flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={savedConfirmed}
              onChange={(e) => setSavedConfirmed(e.target.checked)}
              className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            />
            I have saved these recovery codes
          </label>

          <Button
            variant="primary"
            onClick={handleConfirmSaved}
            disabled={!savedConfirmed}
          >
            Done
          </Button>
        </Card>
      )}

      {/* Step 4: Complete */}
      {step === 'done' && (
        <Card className="p-6">
          <div className="text-center">
            <div className="mb-2 text-3xl">&#x2705;</div>
            <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">
              Two-Factor Authentication Enabled
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Your account is now protected with TOTP two-factor authentication.
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}
