/**
 * @file RegistrationForm.tsx
 * @description Registration form: name, email, password, confirm — on FormField, one primary submit
 * @feature auth
 */

import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Button, FormField, Input } from '@/shared/components/ui';
import { useRegistration } from '../hooks/useRegistration';
import { AuthFormError } from './AuthLayout';
import { PASSWORD_HINT, validateNewPassword } from './passwordRules';

export interface RegistrationFormProps {
  /** Callback when registration succeeds */
  onSuccess?: () => void;
  /** Callback when registration fails */
  onError?: (error: string) => void;
}

type Field = 'name' | 'email' | 'password' | 'confirmPassword';
type FieldErrors = Partial<Record<Field, string>>;

export function RegistrationForm({ onSuccess, onError }: RegistrationFormProps) {
  const { register, isLoading, error, clearError } = useRegistration();
  const [values, setValues] = useState<Record<Field, string>>({ name: '', email: '', password: '', confirmPassword: '' });
  const [errors, setErrors] = useState<FieldErrors>({});

  const validate = (): boolean => {
    const next: FieldErrors = {};
    const name = values.name.trim();
    if (!name) next.name = 'Enter your name.';
    else if (name.length < 2) next.name = 'Names are at least 2 characters.';
    if (!values.email.trim()) next.email = 'Enter your email.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) next.email = 'Enter a valid email address.';
    const pw = validateNewPassword(values.password);
    if (pw) next.password = pw;
    if (!values.confirmPassword) next.confirmPassword = 'Repeat the password.';
    else if (values.password !== values.confirmPassword) next.confirmPassword = "Passwords don't match.";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    clearError();
    if (!validate()) return;
    try {
      await register(values.email, values.password, values.name);
      onSuccess?.();
    } catch (err) {
      onError?.(err instanceof Error ? err.message : 'Registration failed');
    }
  };

  const bind = (field: Field) => ({
    value: values[field],
    disabled: isLoading,
    onChange: (e: ChangeEvent<HTMLInputElement>) => {
      setValues((v) => ({ ...v, [field]: e.target.value }));
      if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
      if (error) clearError();
    },
  });

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      <FormField label="Full name" error={errors.name}>
        <Input id="register-name" placeholder="Ada Lovelace" autoComplete="name" required {...bind('name')} />
      </FormField>
      <FormField label="Email" error={errors.email}>
        <Input id="register-email" type="email" placeholder="you@example.com" autoComplete="email" required {...bind('email')} />
      </FormField>
      <FormField label="Password" hint={PASSWORD_HINT} error={errors.password}>
        <Input id="register-password" type="password" autoComplete="new-password" required {...bind('password')} />
      </FormField>
      <FormField label="Confirm password" error={errors.confirmPassword}>
        <Input id="register-confirm-password" type="password" autoComplete="new-password" required {...bind('confirmPassword')} />
      </FormField>

      {error && <AuthFormError>{error}</AuthFormError>}

      <Button type="submit" size="lg" fullWidth isLoading={isLoading} loadingText="Creating account…">
        Create account
      </Button>
    </form>
  );
}
