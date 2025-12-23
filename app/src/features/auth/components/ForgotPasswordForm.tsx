/**
 * @file ForgotPasswordForm.tsx
 * @description Forgot password form component
 * @feature auth
 * @dependencies @/shared/components/ui, @/features/auth/hooks
 */

import { useState, type FormEvent, type ChangeEvent } from 'react';
import { Input, Button } from '@/shared/components/ui';
import { usePasswordReset } from '../hooks/usePasswordReset';

export interface ForgotPasswordFormProps {
  /** Callback when reset is requested */
  onSuccess?: (resetToken?: string) => void;
  /** Callback on error */
  onError?: (error: string) => void;
}

/**
 * Forgot password form with email field.
 */
export function ForgotPasswordForm({ onSuccess, onError }: ForgotPasswordFormProps) {
  const { requestReset, isLoading, error, isResetRequested, clearError } =
    usePasswordReset();

  const [email, setEmail] = useState('');
  const [validationErrors, setValidationErrors] = useState<{
    email?: string;
  }>({});

  const validate = (): boolean => {
    const errors: typeof validationErrors = {};

    if (!email.trim()) {
      errors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.email = 'Please enter a valid email address';
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    clearError();
    setValidationErrors({});

    if (!validate()) {
      return;
    }

    try {
      const resetToken = await requestReset(email);
      onSuccess?.(resetToken);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Request failed';
      onError?.(errorMessage);
    }
  };

  const handleEmailChange = (e: ChangeEvent<HTMLInputElement>) => {
    setEmail(e.target.value);
    if (validationErrors.email) {
      setValidationErrors({});
    }
    if (error) {
      clearError();
    }
  };

  if (isResetRequested) {
    return (
      <div className="space-y-4 text-center">
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-400">
          <h3 className="font-medium">Check your email</h3>
          <p className="mt-1 text-sm">
            If an account exists with <strong>{email}</strong>, you will receive password
            reset instructions.
          </p>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      <div className="text-center text-sm text-gray-600 dark:text-gray-400">
        Enter your email address and we&apos;ll send you instructions to reset your
        password.
      </div>

      <Input
        id="forgot-email"
        type="email"
        label="Email"
        placeholder="you@example.com"
        value={email}
        onChange={handleEmailChange}
        error={validationErrors.email}
        disabled={isLoading}
        autoComplete="email"
        required
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
        type="submit"
        variant="primary"
        size="lg"
        fullWidth
        isLoading={isLoading}
        disabled={isLoading}
      >
        {isLoading ? 'Sending...' : 'Send reset instructions'}
      </Button>
    </form>
  );
}
