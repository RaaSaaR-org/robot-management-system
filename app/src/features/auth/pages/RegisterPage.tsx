/**
 * @file RegisterPage.tsx
 * @description Account creation page on the shared AuthLayout
 * @feature auth
 */

import { Link } from 'react-router-dom';
import { UserX } from 'lucide-react';
import { LinkButton } from '@/shared/components/ui';
import { useBrand } from '@/brand';
import { useFeatures, useFeaturesStore } from '@/shared/hooks';
import { AuthLayout, authLinkClass } from '../components/AuthLayout';
import { RegistrationForm } from '../components/RegistrationForm';

export interface RegisterPageProps {
  /** Callback when registration succeeds */
  onRegisterSuccess?: () => void;
}

export function RegisterPage({ onRegisterSuccess }: RegisterPageProps) {
  const brand = useBrand();
  const { selfRegistrationEnabled } = useFeatures();
  const flagsLoaded = useFeaturesStore((s) => s.loaded);

  // TASK-369: the server closes anonymous sign-up unless the operator opted
  // in. Until the flags arrive, show the form — the server still enforces it.
  if (flagsLoaded && !selfRegistrationEnabled) {
    return (
      <AuthLayout
        icon={<UserX strokeWidth={1.75} />}
        title="Sign-up is disabled"
        description="This server does not let you create your own account. Ask your administrator to create one for you."
      >
        <LinkButton to="/login" variant="secondary" size="lg" fullWidth>
          Back to sign in
        </LinkButton>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Create your account"
      description={`Join ${brand.name} to run and train your robots.`}
      footer={
        <span>
          Already have an account?{' '}
          <Link to="/login" className={authLinkClass}>Sign in</Link>
        </span>
      }
    >
      <RegistrationForm onSuccess={onRegisterSuccess} />
    </AuthLayout>
  );
}
