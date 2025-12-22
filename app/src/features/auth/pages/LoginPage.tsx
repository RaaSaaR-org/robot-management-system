/**
 * @file LoginPage.tsx
 * @description Full-page login layout with branding
 * @feature auth
 * @dependencies @/shared/components/ui, @/features/auth/components
 */

import { Card } from '@/shared/components/ui';
import { LoginForm } from '../components/LoginForm';

// ============================================================================
// TYPES
// ============================================================================

export interface LoginPageProps {
  /** Callback when login succeeds */
  onLoginSuccess?: () => void;
  /** Logo component or image element */
  logo?: React.ReactNode;
  /** Application title */
  title?: string;
  /** Tagline or description */
  tagline?: string;
}

// ============================================================================
// DEFAULT LOGO
// ============================================================================

function DefaultLogo() {
  return (
    <div className="flex items-center justify-center gap-3">
      {/* Robot icon */}
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-cobalt-500 to-turquoise-500">
        <svg
          className="h-7 w-7 text-white"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"
          />
        </svg>
      </div>
    </div>
  );
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Full-page login layout with centered form card and branding.
 *
 * @example
 * ```tsx
 * function App() {
 *   const navigate = useNavigate();
 *   return (
 *     <Routes>
 *       <Route
 *         path="/login"
 *         element={<LoginPage onLoginSuccess={() => navigate('/dashboard')} />}
 *       />
 *     </Routes>
 *   );
 * }
 * ```
 */
export function LoginPage({
  onLoginSuccess,
  logo,
  title = 'RoboMindOS',
  tagline = 'Fleet Management System',
}: LoginPageProps) {
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
          {/* Logo */}
          <div className="mb-6">{logo ?? <DefaultLogo />}</div>

          {/* Title */}
          <h1 className="text-2xl font-bold tracking-tight text-theme-primary">
            {title}
          </h1>

          {/* Tagline */}
          {tagline && (
            <p className="mt-2 text-sm text-theme-secondary">{tagline}</p>
          )}
        </div>

        {/* Login Card */}
        <Card variant="elevated" className="p-8">
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-theme-primary">
              Sign in to your account
            </h2>
            <p className="mt-1 text-sm text-theme-secondary">
              Enter your credentials to access the dashboard
            </p>
          </div>

          <LoginForm onSuccess={onLoginSuccess} />

          {/* Forgot password link placeholder */}
          <div className="mt-6 text-center">
            <button
              type="button"
              className="text-sm text-cobalt-600 hover:text-cobalt-700 dark:text-cobalt-400 dark:hover:text-cobalt-300"
              onClick={() => {
                // TODO: Implement forgot password flow
                console.log('Forgot password clicked');
              }}
            >
              Forgot your password?
            </button>
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
