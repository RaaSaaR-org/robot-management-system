/**
 * @file ChangePasswordForm.tsx
 * @description Change password (current, new, confirm). `panel` renders Panel.Body + Panel.Footer
 * for /account; `auth` renders a stacked form with one full-width submit for the AuthLayout gate.
 * @feature auth
 */

import { useState, type FormEvent } from 'react';
import { Button, FormField, Input, Panel, toast } from '@/shared/components/ui';
import { useAuthStore } from '../store/authStore';
import { AuthFormError } from './AuthLayout';
import { PASSWORD_HINT, validateNewPassword } from './passwordRules';

export interface ChangePasswordFormProps {
  /** Callback when password is changed */
  onSuccess?: () => void;
  /** Callback on error */
  onError?: (error: string) => void;
  /** Layout: inside a Panel (default) or inside the AuthLayout */
  variant?: 'panel' | 'auth';
}

type Field = 'currentPassword' | 'newPassword' | 'confirmPassword';
type FieldErrors = Partial<Record<Field, string>>;
const EMPTY: Record<Field, string> = { currentPassword: '', newPassword: '', confirmPassword: '' };

export function ChangePasswordForm({ onSuccess, onError, variant = 'panel' }: ChangePasswordFormProps) {
  const changePassword = useAuthStore((s) => s.changePassword);
  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string>();
  const [saving, setSaving] = useState(false);

  const validate = (): boolean => {
    const next: FieldErrors = {};
    if (!values.currentPassword) next.currentPassword = 'Enter your current password.';
    const pw = validateNewPassword(values.newPassword);
    if (pw) next.newPassword = pw;
    else if (values.newPassword === values.currentPassword) next.newPassword = 'Choose a password different from the current one.';
    if (!values.confirmPassword) next.confirmPassword = 'Repeat the new password.';
    else if (values.newPassword !== values.confirmPassword) next.confirmPassword = "Passwords don't match.";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(undefined);
    if (!validate()) return;
    setSaving(true);
    try {
      await changePassword(values.currentPassword, values.newPassword);
      setValues(EMPTY);
      toast.success('Password updated');
      onSuccess?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Change failed';
      setFormError(message);
      toast.error("Couldn't update password", { description: message });
      onError?.(message);
    } finally {
      setSaving(false);
    }
  };

  const bind = (field: Field) => ({
    type: 'password' as const,
    value: values[field],
    disabled: saving,
    required: true,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      setValues((v) => ({ ...v, [field]: e.target.value }));
      if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
      setFormError(undefined);
    },
  });

  const fields = (
    <div className="flex flex-col gap-4">
      <FormField label="Current password" error={errors.currentPassword}>
        <Input id="change-current-password" autoComplete="current-password" {...bind('currentPassword')} />
      </FormField>
      <FormField label="New password" hint={PASSWORD_HINT} error={errors.newPassword}>
        <Input id="change-new-password" autoComplete="new-password" {...bind('newPassword')} />
      </FormField>
      <FormField label="Confirm new password" error={errors.confirmPassword}>
        <Input id="change-confirm-password" autoComplete="new-password" {...bind('confirmPassword')} />
      </FormField>
      {formError && <AuthFormError>{formError}</AuthFormError>}
    </div>
  );

  if (variant === 'auth') {
    return (
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        {fields}
        <Button type="submit" size="lg" fullWidth isLoading={saving} loadingText="Saving…">
          Set password and continue
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <Panel.Body>{fields}</Panel.Body>
      <Panel.Footer>
        <Button type="submit" isLoading={saving} loadingText="Updating…">
          Update password
        </Button>
      </Panel.Footer>
    </form>
  );
}
