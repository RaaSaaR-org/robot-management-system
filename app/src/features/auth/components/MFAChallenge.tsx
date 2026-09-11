/**
 * @file MFAChallenge.tsx
 * @description MFA challenge during login — TOTP code or recovery code. Renders
 * inside the AuthLayout panel, whose h1 names the step.
 * @feature auth
 * @regulatory NIS2 Art. 21(2)(j)
 */

import { useState, type FormEvent } from 'react';
import { Button, FormField, Input } from '@/shared/components/ui';
import { authApi } from '../api/authApi';
import type { LoginResponse } from '../types/auth.types';
import { authLinkClass } from './AuthLayout';

export interface MFAChallengeProps {
  userId: string;
  mfaToken: string;
  onSuccess: (response: LoginResponse) => void;
  onCancel?: () => void;
}

type ChallengeMode = 'totp' | 'recovery';

export function MFAChallenge({ userId, mfaToken, onSuccess, onCancel }: MFAChallengeProps) {
  const [mode, setMode] = useState<ChallengeMode>('totp');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const totp = mode === 'totp';

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!code.trim()) {
      setError(totp ? 'Enter your 6-digit code.' : 'Enter a recovery code.');
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const response = totp
        ? await authApi.mfaTotpValidate(userId, code, mfaToken)
        : await authApi.mfaUseRecoveryCode(userId, code, mfaToken);
      onSuccess(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid code');
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
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      <p className="text-sm text-ink-secondary">
        {totp ? 'Enter the 6-digit code from your authenticator app.' : 'Enter one of your recovery codes.'}
      </p>

      <FormField label={totp ? 'Authentication code' : 'Recovery code'} error={error ?? undefined}>
        <Input
          id="mfa-challenge-code"
          className="font-mono tracking-widest"
          placeholder={totp ? '123456' : 'ABCDEF1234'}
          value={code}
          onChange={(e) => {
            setCode(totp ? e.target.value.replace(/\D/g, '').slice(0, 6) : e.target.value.toUpperCase().slice(0, 10));
            setError(null);
          }}
          autoComplete="one-time-code"
          inputMode={totp ? 'numeric' : undefined}
          autoFocus
        />
      </FormField>

      <Button type="submit" size="lg" fullWidth isLoading={isLoading} loadingText="Verifying…" disabled={!code.trim()}>
        Verify
      </Button>

      <div className="flex items-center justify-between gap-3 text-[13px]">
        <button type="button" onClick={toggleMode} className={authLinkClass}>
          {totp ? 'Use a recovery code instead' : 'Use authenticator app instead'}
        </button>
        {onCancel && (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
