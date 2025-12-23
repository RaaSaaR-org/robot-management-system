/**
 * @file RegistrationForm.tsx
 * @description Registration form component with email/password/name
 * @feature auth
 * @dependencies @/shared/components/ui, @/features/auth/hooks
 */

import { useState, type FormEvent, type ChangeEvent } from 'react';
import { Input, Button } from '@/shared/components/ui';
import { useRegistration } from '../hooks/useRegistration';

export interface RegistrationFormProps {
  /** Callback when registration succeeds */
  onSuccess?: () => void;
  /** Callback when registration fails */
  onError?: (error: string) => void;
}

/**
 * Registration form with email, password, and name fields.
 */
export function RegistrationForm({ onSuccess, onError }: RegistrationFormProps) {
  const { register, isLoading, error, clearError } = useRegistration();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [name, setName] = useState('');
  const [validationErrors, setValidationErrors] = useState<{
    email?: string;
    password?: string;
    confirmPassword?: string;
    name?: string;
  }>({});

  const validate = (): boolean => {
    const errors: typeof validationErrors = {};

    if (!name.trim()) {
      errors.name = 'Name is required';
    } else if (name.trim().length < 2) {
      errors.name = 'Name must be at least 2 characters';
    }

    if (!email.trim()) {
      errors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.email = 'Please enter a valid email address';
    }

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
      await register(email, password, name);
      onSuccess?.();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Registration failed';
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

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      <Input
        id="register-name"
        type="text"
        label="Full Name"
        placeholder="John Doe"
        value={name}
        onChange={handleFieldChange(setName, 'name')}
        error={validationErrors.name}
        disabled={isLoading}
        autoComplete="name"
        required
      />

      <Input
        id="register-email"
        type="email"
        label="Email"
        placeholder="you@example.com"
        value={email}
        onChange={handleFieldChange(setEmail, 'email')}
        error={validationErrors.email}
        disabled={isLoading}
        autoComplete="email"
        required
      />

      <Input
        id="register-password"
        type="password"
        label="Password"
        placeholder="Create a password"
        value={password}
        onChange={handleFieldChange(setPassword, 'password')}
        error={validationErrors.password}
        disabled={isLoading}
        autoComplete="new-password"
        required
      />

      <Input
        id="register-confirm-password"
        type="password"
        label="Confirm Password"
        placeholder="Confirm your password"
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
        {isLoading ? 'Creating account...' : 'Create account'}
      </Button>
    </form>
  );
}
