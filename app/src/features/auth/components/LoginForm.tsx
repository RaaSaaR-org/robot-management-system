/**
 * @file LoginForm.tsx
 * @description Login form component with email/password authentication
 * @feature auth
 * @dependencies @/shared/components/ui, @/features/auth/hooks
 * @stateAccess useAuth (read/write)
 */

import { useState, type FormEvent, type ChangeEvent } from 'react';
import { Input, Button } from '@/shared/components/ui';
import { useAuth } from '../hooks/useAuth';

// ============================================================================
// TYPES
// ============================================================================

export interface LoginFormProps {
  /** Callback when login succeeds */
  onSuccess?: () => void;
  /** Callback when login fails */
  onError?: (error: string) => void;
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Login form with email and password fields.
 * Handles validation and displays error messages.
 *
 * @example
 * ```tsx
 * function LoginPage() {
 *   const navigate = useNavigate();
 *   return (
 *     <LoginForm
 *       onSuccess={() => navigate('/dashboard')}
 *       onError={(error) => console.error(error)}
 *     />
 *   );
 * }
 * ```
 */
export function LoginForm({ onSuccess, onError }: LoginFormProps) {
  const { login, isLoading, error, clearError } = useAuth();

  // Form state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [validationErrors, setValidationErrors] = useState<{
    email?: string;
    password?: string;
  }>({});

  // Validate form fields
  const validate = (): boolean => {
    const errors: { email?: string; password?: string } = {};

    if (!email.trim()) {
      errors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.email = 'Please enter a valid email address';
    }

    if (!password) {
      errors.password = 'Password is required';
    } else if (password.length < 6) {
      errors.password = 'Password must be at least 6 characters';
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Handle form submission
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    // Clear previous errors
    clearError();
    setValidationErrors({});

    // Validate
    if (!validate()) {
      return;
    }

    try {
      await login(email, password);
      onSuccess?.();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Login failed';
      onError?.(errorMessage);
    }
  };

  // Clear error when user starts typing
  const handleEmailChange = (e: ChangeEvent<HTMLInputElement>) => {
    setEmail(e.target.value);
    if (validationErrors.email) {
      setValidationErrors((prev) => ({ ...prev, email: undefined }));
    }
    if (error) {
      clearError();
    }
  };

  const handlePasswordChange = (e: ChangeEvent<HTMLInputElement>) => {
    setPassword(e.target.value);
    if (validationErrors.password) {
      setValidationErrors((prev) => ({ ...prev, password: undefined }));
    }
    if (error) {
      clearError();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      {/* Email field */}
      <Input
        id="login-email"
        type="email"
        label="Email"
        placeholder="you@example.com"
        value={email}
        onChange={handleEmailChange}
        error={validationErrors.email}
        disabled={isLoading}
        autoComplete="email"
        required
        aria-describedby={validationErrors.email ? 'login-email-error' : undefined}
      />

      {/* Password field */}
      <Input
        id="login-password"
        type="password"
        label="Password"
        placeholder="Enter your password"
        value={password}
        onChange={handlePasswordChange}
        error={validationErrors.password}
        disabled={isLoading}
        autoComplete="current-password"
        required
        aria-describedby={validationErrors.password ? 'login-password-error' : undefined}
      />

      {/* API error message */}
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400"
        >
          {error}
        </div>
      )}

      {/* Submit button */}
      <Button
        type="submit"
        variant="primary"
        size="lg"
        fullWidth
        isLoading={isLoading}
        disabled={isLoading}
      >
        {isLoading ? 'Signing in...' : 'Sign in'}
      </Button>
    </form>
  );
}
