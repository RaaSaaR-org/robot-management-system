/**
 * @file MFAChallenge.tsx
 * @description MFA challenge input during login — TOTP code or recovery code
 * @feature auth
 * @regulatory NIS2 Art. 21(2)(j)
 */

import { useState } from 'react';
import { Input, Button, Card } from '@/shared/components/ui';
import { authApi } from '../api/authApi';
import type { LoginResponse } from '../types/auth.types';

// ============================================================================
// TYPES
// ============================================================================

export interface MFAChallengeProps {
  userId: string;
  mfaToken: string;
  onSuccess: (response: LoginResponse) => void;
  onCancel?: () => void;
}

type ChallengeMode = 'totp' | 'recovery';

// ============================================================================
// COMPONENT
// ============================================================================

export function MFAChallenge({ userId, mfaToken, onSuccess, onCancel }: MFAChallengeProps) {
  const [mode, setMode] = useState<ChallengeMode>('totp');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!code.trim()) {
      setError(mode === 'totp' ? 'Enter your 6-digit code' : 'Enter a recovery code');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      let response: LoginResponse;

      if (mode === 'totp') {
        response = await authApi.mfaTotpValidate(userId, code, mfaToken);
      } else {
        response = await authApi.mfaUseRecoveryCode(userId, code, mfaToken);
      }

      onSuccess(response);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Invalid code';
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleMode = () => {
    setMode((prev) => (prev === 'totp' ? 'recovery' : 'totp'));
    setCode('');
    setError(null);
  };

  return (
    <Card className="mx-auto max-w-md p-6">
      <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">
        {mode === 'totp' ? 'Two-Factor Authentication' : 'Recovery Code'}
      </h3>
      <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
        {mode === 'totp'
          ? 'Enter the 6-digit code from your authenticator app.'
          : 'Enter one of your recovery codes.'}
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          id="mfa-challenge-code"
          label={mode === 'totp' ? 'Authentication Code' : 'Recovery Code'}
          placeholder={mode === 'totp' ? '123456' : 'ABCDEF1234'}
          value={code}
          onChange={(e) => {
            if (mode === 'totp') {
              setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
            } else {
              setCode(e.target.value.toUpperCase().slice(0, 10));
            }
            setError(null);
          }}
          error={error ?? undefined}
          autoComplete="one-time-code"
          inputMode={mode === 'totp' ? 'numeric' : undefined}
          autoFocus
        />

        <Button
          type="submit"
          variant="primary"
          fullWidth
          isLoading={isLoading}
          disabled={isLoading || !code.trim()}
        >
          {isLoading ? 'Verifying...' : 'Verify'}
        </Button>

        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={toggleMode}
            className="text-sm text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
          >
            {mode === 'totp' ? 'Use a recovery code instead' : 'Use authenticator app instead'}
          </button>

          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
            >
              Cancel
            </button>
          )}
        </div>
      </form>
    </Card>
  );
}
