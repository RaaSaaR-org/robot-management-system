/**
 * @file MFASetup.tsx
 * @description TOTP setup steps (start, add to app + verify, save recovery codes). Rendered
 * inside the kit Modal on /account; each step ends in one primary action.
 * @feature auth
 * @regulatory NIS2 Art. 21(2)(j)
 */

import { useState } from 'react';
import { Button, Checkbox, FormField, Input } from '@/shared/components/ui';
import { authApi } from '../api/authApi';
import { AuthFormError } from './AuthLayout';

export interface MFASetupProps {
  onComplete?: () => void;
  onCancel?: () => void;
}

type SetupStep = 'init' | 'verify' | 'recovery';

function StepTitle({ children }: { children: string }) {
  return <h3 className="text-sm font-semibold text-ink-primary">{children}</h3>;
}

function Actions({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap justify-end gap-2 pt-2">{children}</div>;
}

export function MFASetup({ onComplete, onCancel }: MFASetupProps) {
  const [step, setStep] = useState<SetupStep>('init');
  const [secret, setSecret] = useState('');
  const [otpauthUrl, setOtpauthUrl] = useState('');
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [savedConfirmed, setSavedConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const cancel = onCancel && (
    <Button variant="ghost" onClick={onCancel}>
      Cancel
    </Button>
  );

  const handleStartSetup = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await authApi.mfaTotpSetup();
      setSecret(result.secret);
      setOtpauthUrl(result.otpauthUrl);
      setStep('verify');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start setup');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyCode = async () => {
    if (code.length !== 6) {
      setError('Enter the 6-digit code.');
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const result = await authApi.mfaTotpVerify(secret, code);
      setRecoveryCodes(result.recoveryCodes);
      setStep('recovery');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid code. Try again.');
    } finally {
      setIsLoading(false);
    }
  };

  if (step === 'init') {
    return (
      <div className="flex flex-col gap-4">
        <StepTitle>Protect your account with a second step</StepTitle>
        <p className="text-sm text-ink-secondary">
          You need an authenticator app such as 1Password, Authy or Google Authenticator. After your password,
          sign-in asks for the code it shows.
        </p>
        {error && <AuthFormError>{error}</AuthFormError>}
        <Actions>
          {cancel}
          <Button onClick={handleStartSetup} isLoading={isLoading}>
            Start setup
          </Button>
        </Actions>
      </div>
    );
  }

  if (step === 'verify') {
    return (
      <div className="flex flex-col gap-4">
        <StepTitle>Add NeoDEM to your authenticator app</StepTitle>
        <p className="text-sm text-ink-secondary">Paste the setup URL into your app, or type the key by hand.</p>
        <div className="flex flex-col gap-3 rounded-control border border-line-subtle bg-inset p-3">
          <div>
            <div className="text-xs text-ink-tertiary">Setup URL</div>
            <code className="block break-all font-mono text-xs text-ink-primary">{otpauthUrl}</code>
          </div>
          <div>
            <div className="text-xs text-ink-tertiary">Key</div>
            <code className="block break-all font-mono text-sm tracking-wider text-ink-primary">{secret}</code>
          </div>
        </div>
        <FormField label="Verification code" hint="The 6-digit code your app shows now." error={error ?? undefined}>
          <Input
            id="mfa-code"
            className="font-mono tracking-widest"
            placeholder="123456"
            value={code}
            onChange={(e) => {
              setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
              setError(null);
            }}
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={6}
          />
        </FormField>
        <Actions>
          {cancel}
          <Button onClick={handleVerifyCode} isLoading={isLoading} disabled={code.length !== 6}>
            Verify and turn on
          </Button>
        </Actions>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <StepTitle>Save your recovery codes</StepTitle>
      <p className="text-sm text-ink-secondary">
        Each code works once. If you lose your authenticator app, these codes are the only way back into your
        account. They are shown only now.
      </p>
      <div className="grid grid-cols-2 gap-2 rounded-control border border-line-subtle bg-inset p-3">
        {recoveryCodes.map((rc) => (
          <code key={rc} className="rounded-tag bg-panel px-2 py-1 text-center font-mono text-sm text-ink-primary">
            {rc}
          </code>
        ))}
      </div>
      <Checkbox
        label="I have saved these recovery codes"
        checked={savedConfirmed}
        onChange={(e) => setSavedConfirmed(e.target.checked)}
      />
      <Actions>
        <Button onClick={() => onComplete?.()} disabled={!savedConfirmed}>
          Done
        </Button>
      </Actions>
    </div>
  );
}
