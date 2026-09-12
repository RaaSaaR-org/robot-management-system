/**
 * @file LoginForm.tsx
 * @description Login form: email + password, field errors inline, one primary submit.
 * Hands an MFA challenge up to the page instead of failing.
 * @feature auth
 * @stateAccess useAuth (read/write)
 */

import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Button, FormField, Input, errorMessage } from '@/shared/components/ui';
import { useAuth } from '../hooks/useAuth';
import { AuthFormError, authLinkClass } from './AuthLayout';

export interface MFAChallengeRequest {
  userId: string;
  mfaToken: string;
}

export interface LoginFormProps {
  /** Callback when login succeeds */
  onSuccess?: () => void;
  /** Callback when login fails */
  onError?: (error: string) => void;
  /** Called when the server asks for a second factor */
  onMfaRequired?: (challenge: MFAChallengeRequest) => void;
}

type FieldErrors = { email?: string; password?: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function LoginForm({ onSuccess, onError, onMfaRequired }: LoginFormProps) {
  const { login, isLoading, error, clearError } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});

  const validate = (): boolean => {
    const next: FieldErrors = {};
    if (!email.trim()) next.email = 'Enter your email.';
    else if (!EMAIL_RE.test(email)) next.email = 'Enter a valid email address.';
    if (!password) next.password = 'Enter your password.';
    else if (password.length < 6) next.password = 'Passwords are at least 6 characters.';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    clearError();
    if (!validate()) return;
    try {
      await login(email, password);
      onSuccess?.();
    } catch (err) {
      const mfa = err as Error & Partial<MFAChallengeRequest>;
      if (mfa?.message === 'MFA_REQUIRED' && mfa.userId && mfa.mfaToken) {
        clearError();
        onMfaRequired?.({ userId: mfa.userId, mfaToken: mfa.mfaToken });
        return;
      }
      onError?.(errorMessage(err, 'Login failed'));
    }
  };

  const clearField = (field: keyof FieldErrors) => {
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
    if (error) clearError();
  };

  const showError = error && error !== 'MFA_REQUIRED' ? error : null;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      <FormField label="Email" error={errors.email}>
        <Input
          id="login-email"
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => { setEmail(e.target.value); clearField('email'); }}
          disabled={isLoading}
          autoComplete="email"
          required
        />
      </FormField>

      <FormField
        label="Password"
        error={errors.password}
        aside={<Link to="/forgot-password" className={authLinkClass}>Forgot password?</Link>}
      >
        <Input
          id="login-password"
          type="password"
          placeholder="Your password"
          value={password}
          onChange={(e) => { setPassword(e.target.value); clearField('password'); }}
          disabled={isLoading}
          autoComplete="current-password"
          required
        />
      </FormField>

      {showError && <AuthFormError>{showError}</AuthFormError>}

      <Button type="submit" size="lg" fullWidth isLoading={isLoading} loadingText="Signing in…">
        Sign in
      </Button>
    </form>
  );
}
