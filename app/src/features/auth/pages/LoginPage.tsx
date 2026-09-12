/**
 * @file LoginPage.tsx
 * @description Sign-in page on the shared AuthLayout; the MFA step renders in the same panel
 * @feature auth
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useFeatures } from '@/shared/hooks';
import { AuthLayout, authLinkClass } from '../components/AuthLayout';
import { LoginForm, type MFAChallengeRequest } from '../components/LoginForm';
import { MFAChallenge } from '../components/MFAChallenge';
import { useAuthStore } from '../store/authStore';

export interface LoginPageProps {
  /** Callback when login succeeds */
  onLoginSuccess?: () => void;
  /** Overrides the h1 */
  title?: string;
  /** Overrides the sentence under the h1 */
  tagline?: string;
}

export function LoginPage({ onLoginSuccess, title, tagline }: LoginPageProps) {
  const { multiTenancyEnabled } = useFeatures();
  const completeMFALogin = useAuthStore((s) => s.completeMFALogin);
  const [challenge, setChallenge] = useState<MFAChallengeRequest | null>(null);

  if (challenge) {
    return (
      <AuthLayout
        title="Two-step verification"
        footer={
          <button type="button" className={authLinkClass} onClick={() => setChallenge(null)}>
            Back to sign in
          </button>
        }
      >
        <MFAChallenge
          userId={challenge.userId}
          mfaToken={challenge.mfaToken}
          onSuccess={(response) => {
            completeMFALogin(response);
            onLoginSuccess?.();
          }}
        />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title={title ?? 'Sign in'}
      // TASK-164: keep it neutral — the tenant is implicit in the email address.
      description={tagline ?? 'Enter your email and password.'}
      footer={
        // TASK-164: sign-up is invite-only when multi-tenancy is on.
        !multiTenancyEnabled && (
          <span>
            No account?{' '}
            <Link to="/register" className={authLinkClass}>Create one</Link>
          </span>
        )
      }
    >
      <LoginForm onSuccess={onLoginSuccess} onMfaRequired={setChallenge} />
    </AuthLayout>
  );
}
