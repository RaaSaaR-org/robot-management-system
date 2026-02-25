/**
 * @file MFAChallenge.tsx
 * @description MFA challenge during login — 6-digit TOTP code or recovery code input
 * @feature auth
 */

import { useState } from 'react';
import { Input, Button } from '@/shared/components/ui';
import { mfaApi } from '../api/mfaApi';

// ============================================================================
// TYPES
// ============================================================================

export interface MFAChallengeProps {
  /** User ID to verify MFA for */
  userId: string;
  /** Called on successful MFA verification */
  onSuccess: () => void;
  /** Called when user wants to go back to login */
  onCancel?: () => void;
}

// ============================================================================
// COMPONENT
// ============================================================================

export function MFAChallenge({ userId, onSuccess, onCancel }: MFAChallengeProps) {
  const [mode, setMode] = useState<'totp' | 'recovery'>('totp');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleVerify = async () => {
    if (!code.trim()) return;

    setIsLoading(true);
    setError(null);

    try {
      if (mode === 'totp') {
        const result = await mfaApi.verifyTOTP(userId, code.trim());
        if (result.verified) {
          onSuccess();
        }
      } else {
        const result = await mfaApi.verifyRecoveryCode(userId, code.trim());
        if (result.verified) {
          onSuccess();
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Verification failed';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && code.trim()) {
      handleVerify();
    }
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
        Two-Factor Authentication
      </h3>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {mode === 'totp'
          ? 'Enter the 6-digit code from your authenticator app.'
          : 'Enter one of your recovery codes.'}
      </p>

      <Input
        id="mfa-code"
        type="text"
        label={mode === 'totp' ? 'Authentication code' : 'Recovery code'}
        placeholder={mode === 'totp' ? '000000' : 'Enter recovery code'}
        value={code}
        onChange={(e) => {
          setCode(e.target.value);
          if (error) setError(null);
        }}
        onKeyDown={handleKeyDown}
        maxLength={mode === 'totp' ? 6 : 20}
        inputMode={mode === 'totp' ? 'numeric' : 'text'}
        pattern={mode === 'totp' ? '[0-9]*' : undefined}
        autoComplete="one-time-code"
        disabled={isLoading}
        autoFocus
      />

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400"
        >
          {error}
        </div>
      )}

      <Button
        variant="primary"
        fullWidth
        onClick={handleVerify}
        isLoading={isLoading}
        disabled={!code.trim() || isLoading}
      >
        Verify
      </Button>

      <div className="flex items-center justify-between text-sm">
        <button
          type="button"
          onClick={() => {
            setMode(mode === 'totp' ? 'recovery' : 'totp');
            setCode('');
            setError(null);
          }}
          className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
        >
          {mode === 'totp' ? 'Use a recovery code' : 'Use authenticator app'}
        </button>

        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300"
          >
            Back to login
          </button>
        )}
      </div>
    </div>
  );
}
