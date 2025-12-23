/**
 * @file AccountPage.tsx
 * @description Account settings page for authenticated users
 * @feature auth
 * @dependencies @/features/auth/components
 */

import { AccountSettingsPanel } from '../components/AccountSettingsPanel';

export interface AccountPageProps {
  /** Callback when password is changed */
  onPasswordChanged?: () => void;
}

/**
 * Full-page account settings layout.
 */
export function AccountPage({ onPasswordChanged }: AccountPageProps) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
          Account Settings
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Manage your account settings and preferences
        </p>
      </div>

      {/* Account Settings Panel */}
      <AccountSettingsPanel onPasswordChanged={onPasswordChanged} />
    </div>
  );
}
