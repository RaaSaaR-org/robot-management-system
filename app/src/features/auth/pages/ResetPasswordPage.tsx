/**
 * @file ResetPasswordPage.tsx
 * @description Full-page reset password layout with token from URL
 * @feature auth
 * @dependencies @/shared/components/ui, @/features/auth/components
 */

import { Link, useSearchParams } from 'react-router-dom';
import { Card } from '@/shared/components/ui';
import { ResetPasswordForm } from '../components/ResetPasswordForm';

export interface ResetPasswordPageProps {
  /** Callback when password is reset */
  onSuccess?: () => void;
}

/**
 * Full-page reset password layout.
 * Expects a `token` query parameter in the URL.
 */
export function ResetPasswordPage({ onSuccess }: ResetPasswordPageProps) {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

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
            Set new password
          </h1>
          <p className="mt-2 text-sm text-theme-secondary">
            Enter your new password below
          </p>
        </div>

        {/* Reset Password Card */}
        <Card variant="elevated" className="p-8">
          {token ? (
            <ResetPasswordForm token={token} onSuccess={onSuccess} />
          ) : (
            <div className="space-y-4 text-center">
              <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
                <h3 className="font-medium">Invalid reset link</h3>
                <p className="mt-1 text-sm">
                  This password reset link is invalid or has expired.
                </p>
              </div>
              <Link
                to="/forgot-password"
                className="inline-block text-sm font-medium text-cobalt-600 hover:text-cobalt-700 dark:text-cobalt-400 dark:hover:text-cobalt-300"
              >
                Request a new reset link
              </Link>
            </div>
          )}

          {/* Back to login link */}
          <div className="mt-6 text-center">
            <Link
              to="/login"
              className="text-sm font-medium text-cobalt-600 hover:text-cobalt-700 dark:text-cobalt-400 dark:hover:text-cobalt-300"
            >
              Back to sign in
            </Link>
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
