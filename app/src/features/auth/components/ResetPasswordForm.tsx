/**
 * @file ResetPasswordForm.tsx
 * @description Set a new password from a reset token; the page shows the done state
 * @feature auth
 */

import { useState, type FormEvent } from 'react';
import { Button, FormField, Input, errorMessage } from '@/shared/components/ui';
import { useAuthStore } from '../store/authStore';
import { AuthFormError } from './AuthLayout';
import { PASSWORD_HINT, validateNewPassword } from './passwordRules';

export interface ResetPasswordFormProps {
  /** Password reset token from URL */
  token: string;
  /** Callback when password is reset */
  onSuccess?: () => void;
  /** Callback on error */
  onError?: (error: string) => void;
}

type FieldErrors = { password?: string; confirmPassword?: string };

export function ResetPasswordForm({ token, onSuccess, onError }: ResetPasswordFormProps) {
  // The store throws on failure (the usePasswordReset hook swallows it), so onSuccess only runs on success.
  const resetPassword = useAuthStore((s) => s.resetPassword);
  const isLoading = useAuthStore((s) => s.isLoading);
  const error = useAuthStore((s) => s.error);
  const clearError = useAuthStore((s) => s.clearError);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    clearError();
    const next: FieldErrors = {};
    const pw = validateNewPassword(password);
    if (pw) next.password = pw;
    if (!confirmPassword) next.confirmPassword = 'Repeat the password.';
    else if (password !== confirmPassword) next.confirmPassword = "Passwords don't match.";
    setErrors(next);
    if (Object.keys(next).length) return;
    try {
      await resetPassword(token, password);
      onSuccess?.();
    } catch (err) {
      onError?.(errorMessage(err, 'Reset failed'));
    }
  };

  const clear = (field: keyof FieldErrors) => {
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
    if (error) clearError();
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      <FormField label="New password" hint={PASSWORD_HINT} error={errors.password}>
        <Input
          id="reset-password"
          type="password"
          value={password}
          onChange={(e) => { setPassword(e.target.value); clear('password'); }}
          disabled={isLoading}
          autoComplete="new-password"
          required
        />
      </FormField>
      <FormField label="Confirm new password" error={errors.confirmPassword}>
        <Input
          id="reset-confirm-password"
          type="password"
          value={confirmPassword}
          onChange={(e) => { setConfirmPassword(e.target.value); clear('confirmPassword'); }}
          disabled={isLoading}
          autoComplete="new-password"
          required
        />
      </FormField>

      {error && <AuthFormError>{error}</AuthFormError>}

      <Button type="submit" size="lg" fullWidth isLoading={isLoading} loadingText="Saving…">
        Set new password
      </Button>
    </form>
  );
}
