/**
 * @file ResetPasswordForm.tsx
 * @description Reset password form component with token validation
 * @feature auth
 * @dependencies @/shared/components/ui, @/features/auth/hooks
 */

import { useState, type FormEvent, type ChangeEvent } from 'react';
import { Input, Button } from '@/shared/components/ui';
import { usePasswordReset } from '../hooks/usePasswordReset';

export interface ResetPasswordFormProps {
  /** Password reset token from URL */
  token: string;
  /** Callback when password is reset */
  onSuccess?: () => void;
  /** Callback on error */
  onError?: (error: string) => void;
}

/**
 * Reset password form with new password fields.
 */
export function ResetPasswordForm({ token, onSuccess, onError }: ResetPasswordFormProps) {
  const { resetPassword, isLoading, error, isResetComplete, clearError } =
    usePasswordReset();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [validationErrors, setValidationErrors] = useState<{
    password?: string;
    confirmPassword?: string;
  }>({});

  const validate = (): boolean => {
    const errors: typeof validationErrors = {};

    if (!password) {
      errors.password = 'Password is required';
    } else if (password.length < 8) {
      errors.password = 'Password must be at least 8 characters';
    } else if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)) {
      errors.password = 'Password must include uppercase, lowercase, and number';
    }

    if (!confirmPassword) {
      errors.confirmPassword = 'Please confirm your password';
    } else if (password !== confirmPassword) {
      errors.confirmPassword = 'Passwords do not match';
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
      await resetPassword(token, password);
      onSuccess?.();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Reset failed';
      onError?.(errorMessage);
    }
  };

  const handleFieldChange = (
    setter: (value: string) => void,
    field: keyof typeof validationErrors
  ) => {
    return (e: ChangeEvent<HTMLInputElement>) => {
      setter(e.target.value);
      if (validationErrors[field]) {
        setValidationErrors((prev) => ({ ...prev, [field]: undefined }));
      }
      if (error) {
        clearError();
      }
    };
  };

  if (isResetComplete) {
    return (
      <div className="space-y-4 text-center">
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-400">
          <h3 className="font-medium">Password reset successful!</h3>
          <p className="mt-1 text-sm">
            Your password has been updated. You can now sign in with your new password.
          </p>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      <div className="text-center text-sm text-gray-600 dark:text-gray-400">
        Enter your new password below.
      </div>

      <Input
        id="reset-password"
        type="password"
        label="New Password"
        placeholder="Enter new password"
        value={password}
        onChange={handleFieldChange(setPassword, 'password')}
        error={validationErrors.password}
        disabled={isLoading}
        autoComplete="new-password"
        required
      />

      <Input
        id="reset-confirm-password"
        type="password"
        label="Confirm New Password"
        placeholder="Confirm new password"
        value={confirmPassword}
        onChange={handleFieldChange(setConfirmPassword, 'confirmPassword')}
        error={validationErrors.confirmPassword}
        disabled={isLoading}
        autoComplete="new-password"
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
        {isLoading ? 'Resetting...' : 'Reset password'}
      </Button>
    </form>
  );
}
