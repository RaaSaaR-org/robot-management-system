/**
 * @file ForgotPasswordForm.tsx
 * @description Forgot-password form: one email field, one primary submit. The page shows the sent state.
 * @feature auth
 */

import { useState, type FormEvent } from 'react';
import { Button, FormField, Input, errorMessage } from '@/shared/components/ui';
import { useAuthStore } from '../store/authStore';
import { AuthFormError } from './AuthLayout';

export interface ForgotPasswordFormProps {
  /** Called once the request went out (resetToken is only returned in dev) */
  onSuccess?: (resetToken?: string) => void;
  /** Called with the address the link went to */
  onRequested?: (email: string) => void;
  /** Callback on error */
  onError?: (error: string) => void;
}

export function ForgotPasswordForm({ onSuccess, onRequested, onError }: ForgotPasswordFormProps) {
  // The store throws on failure (the usePasswordReset hook swallows it), so success only runs on success.
  const requestReset = useAuthStore((s) => s.forgotPassword);
  const isLoading = useAuthStore((s) => s.isLoading);
  const error = useAuthStore((s) => s.error);
  const clearError = useAuthStore((s) => s.clearError);
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string>();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    clearError();
    if (!email.trim()) return setEmailError('Enter your email.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setEmailError('Enter a valid email address.');
    try {
      const resetToken = await requestReset(email);
      onRequested?.(email);
      onSuccess?.(resetToken);
    } catch (err) {
      onError?.(errorMessage(err, 'Request failed'));
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      <FormField label="Email" error={emailError}>
        <Input
          id="forgot-email"
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setEmailError(undefined);
            if (error) clearError();
          }}
          disabled={isLoading}
          autoComplete="email"
          required
        />
      </FormField>

      {error && <AuthFormError>{error}</AuthFormError>}

      <Button type="submit" size="lg" fullWidth isLoading={isLoading} loadingText="Sending…">
        Send reset link
      </Button>
    </form>
  );
}
