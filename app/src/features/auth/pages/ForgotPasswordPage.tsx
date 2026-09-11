/**
 * @file ForgotPasswordPage.tsx
 * @description Request a password reset link; the same panel turns into "Check your inbox"
 * @feature auth
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { MailCheck } from 'lucide-react';
import { LinkButton } from '@/shared/components/ui';
import { AuthLayout, authLinkClass } from '../components/AuthLayout';
import { ForgotPasswordForm } from '../components/ForgotPasswordForm';

export interface ForgotPasswordPageProps {
  /** Callback when reset is requested */
  onSuccess?: (resetToken?: string) => void;
}

export function ForgotPasswordPage({ onSuccess }: ForgotPasswordPageProps) {
  const [sentTo, setSentTo] = useState<string | null>(null);

  if (sentTo) {
    return (
      <AuthLayout
        icon={<MailCheck strokeWidth={1.75} />}
        title="Check your inbox"
        description={
          <>
            If an account exists for <span className="font-medium text-ink-primary">{sentTo}</span>, a link to
            reset the password is on its way.
          </>
        }
      >
        <LinkButton to="/login" variant="secondary" size="lg" fullWidth>
          Back to sign in
        </LinkButton>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Reset your password"
      description="Enter your email and we'll send you a link to set a new password."
      footer={<Link to="/login" className={authLinkClass}>Back to sign in</Link>}
    >
      <ForgotPasswordForm onRequested={setSentTo} onSuccess={onSuccess} />
    </AuthLayout>
  );
}
