/**
 * @file RegisterPage.tsx
 * @description Account creation page on the shared AuthLayout
 * @feature auth
 */

import { Link } from 'react-router-dom';
import { useBrand } from '@/brand';
import { AuthLayout, authLinkClass } from '../components/AuthLayout';
import { RegistrationForm } from '../components/RegistrationForm';

export interface RegisterPageProps {
  /** Callback when registration succeeds */
  onRegisterSuccess?: () => void;
}

export function RegisterPage({ onRegisterSuccess }: RegisterPageProps) {
  const brand = useBrand();
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
