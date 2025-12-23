/**
 * @file ChangePasswordForm.tsx
 * @description Change password form for authenticated users
 * @feature auth
 * @dependencies @/shared/components/ui, @/features/auth/hooks
 */

import { useState, type FormEvent, type ChangeEvent } from 'react';
import { Input, Button } from '@/shared/components/ui';
import { useAccountSettings } from '../hooks/useAccountSettings';

export interface ChangePasswordFormProps {
  /** Callback when password is changed */
  onSuccess?: () => void;
  /** Callback on error */
  onError?: (error: string) => void;
}

/**
 * Change password form for authenticated users.
 */
export function ChangePasswordForm({ onSuccess, onError }: ChangePasswordFormProps) {
  const { changePassword, isLoading, error, isSuccess, clearError, clearSuccess } =
    useAccountSettings();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [validationErrors, setValidationErrors] = useState<{
    currentPassword?: string;
    newPassword?: string;
    confirmPassword?: string;
  }>({});

  const validate = (): boolean => {
    const errors: typeof validationErrors = {};

    if (!currentPassword) {
      errors.currentPassword = 'Current password is required';
    }

    if (!newPassword) {
      errors.newPassword = 'New password is required';
    } else if (newPassword.length < 8) {
      errors.newPassword = 'Password must be at least 8 characters';
    } else if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(newPassword)) {
      errors.newPassword = 'Password must include uppercase, lowercase, and number';
    } else if (newPassword === currentPassword) {
      errors.newPassword = 'New password must be different from current password';
    }

    if (!confirmPassword) {
      errors.confirmPassword = 'Please confirm your new password';
    } else if (newPassword !== confirmPassword) {
      errors.confirmPassword = 'Passwords do not match';
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    clearError();
    clearSuccess();
    setValidationErrors({});

    if (!validate()) {
      return;
    }

    try {
      await changePassword(currentPassword, newPassword);
      // Clear form on success
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      onSuccess?.();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Change failed';
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
      if (isSuccess) {
        clearSuccess();
      }
    };
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      <Input
        id="change-current-password"
        type="password"
        label="Current Password"
        placeholder="Enter current password"
        value={currentPassword}
        onChange={handleFieldChange(setCurrentPassword, 'currentPassword')}
        error={validationErrors.currentPassword}
        disabled={isLoading}
        autoComplete="current-password"
        required
      />

      <Input
        id="change-new-password"
        type="password"
        label="New Password"
        placeholder="Enter new password"
        value={newPassword}
        onChange={handleFieldChange(setNewPassword, 'newPassword')}
        error={validationErrors.newPassword}
        disabled={isLoading}
        autoComplete="new-password"
        required
      />

      <Input
        id="change-confirm-password"
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

      {isSuccess && (
        <div
          role="status"
          className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-400"
        >
          Password changed successfully!
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
        {isLoading ? 'Changing password...' : 'Change password'}
      </Button>
    </form>
  );
}
