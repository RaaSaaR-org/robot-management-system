/**
 * @file ResetPasswordPage.tsx
 * @description Set a new password from the emailed link (`?token=`); calm states for a
 * missing link and for success
 * @feature auth
 */

import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, LinkIcon } from 'lucide-react';
import { LinkButton } from '@/shared/components/ui';
import { AuthLayout, authLinkClass } from '../components/AuthLayout';
import { ResetPasswordForm } from '../components/ResetPasswordForm';

export interface ResetPasswordPageProps {
  /** Callback when password is reset */
  onSuccess?: () => void;
}

export function ResetPasswordPage({ onSuccess }: ResetPasswordPageProps) {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <AuthLayout
        icon={<CheckCircle2 strokeWidth={1.75} />}
        title="Password updated"
        description="Sign in with your new password."
      >
        <LinkButton to="/login" size="lg" fullWidth>
          Sign in
        </LinkButton>
      </AuthLayout>
    );
  }

  if (!token) {
    return (
      <AuthLayout
        icon={<LinkIcon strokeWidth={1.75} />}
        title="This link doesn't work"
        description="This reset link is invalid or has expired. Ask for a new one."
        footer={<Link to="/login" className={authLinkClass}>Back to sign in</Link>}
      >
        <LinkButton to="/forgot-password" size="lg" fullWidth>
          Request a new link
        </LinkButton>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Set a new password"
      description="Choose the password you'll sign in with from now on."
      footer={<Link to="/login" className={authLinkClass}>Back to sign in</Link>}
    >
      <ResetPasswordForm
        token={token}
        onSuccess={() => {
          setDone(true);
          onSuccess?.();
        }}
      />
    </AuthLayout>
  );
}
