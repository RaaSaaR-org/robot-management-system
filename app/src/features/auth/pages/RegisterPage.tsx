/**
 * @file RegisterPage.tsx
 * @description Full-page registration layout with branding
 * @feature auth
 * @dependencies @/shared/components/ui, @/features/auth/components
 */

import { Link } from 'react-router-dom';
import { Card } from '@/shared/components/ui';
import { RegistrationForm } from '../components/RegistrationForm';

export interface RegisterPageProps {
  /** Callback when registration succeeds */
  onRegisterSuccess?: () => void;
}

/**
 * Full-page registration layout with centered form card.
 */
export function RegisterPage({ onRegisterSuccess }: RegisterPageProps) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-theme-bg px-4 py-12">
      {/* Background gradient decoration */}
      <div
        className="pointer-events-none fixed inset-0 overflow-hidden"
        aria-hidden="true"
      >
        <div className="absolute -left-40 -top-40 h-80 w-80 rounded-full bg-cobalt-500/10 blur-3xl" />
        <div className="absolute -bottom-40 -right-40 h-80 w-80 rounded-full bg-turquoise-500/10 blur-3xl" />
      </div>

      {/* Content */}
      <div className="relative z-10 w-full max-w-md space-y-8">
        {/* Header */}
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight text-theme-primary">
            Create your account
          </h1>
          <p className="mt-2 text-sm text-theme-secondary">
            Join RoboMindOS to manage your robot fleet
          </p>
        </div>

        {/* Registration Card */}
        <Card variant="elevated" className="p-8">
          <RegistrationForm onSuccess={onRegisterSuccess} />

          {/* Login link */}
          <div className="mt-6 text-center">
            <span className="text-sm text-theme-secondary">
              Already have an account?{' '}
              <Link
                to="/login"
                className="font-medium text-cobalt-600 hover:text-cobalt-700 dark:text-cobalt-400 dark:hover:text-cobalt-300"
              >
                Sign in
              </Link>
            </span>
          </div>
        </Card>

        {/* Footer */}
        <p className="text-center text-xs text-theme-tertiary">
          &copy; {new Date().getFullYear()} RoboMindOS. All rights reserved.
        </p>
      </div>
    </div>
  );
}
