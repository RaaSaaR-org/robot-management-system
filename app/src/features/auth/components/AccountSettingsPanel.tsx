/**
 * @file AccountSettingsPanel.tsx
 * @description Account settings panel with user info and password change
 * @feature auth
 * @dependencies @/shared/components/ui, @/features/auth/hooks
 */

import { Card } from '@/shared/components/ui';
import { useAuth } from '../hooks/useAuth';
import { ChangePasswordForm } from './ChangePasswordForm';

export interface AccountSettingsPanelProps {
  /** Callback when password is changed */
  onPasswordChanged?: () => void;
}

/**
 * Account settings panel with user profile and password management.
 */
export function AccountSettingsPanel({ onPasswordChanged }: AccountSettingsPanelProps) {
  const { user, logout } = useAuth();

  if (!user) {
    return null;
  }

  return (
    <div className="space-y-6">
      {/* Profile Info */}
      <Card className="p-6">
        <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">
          Profile Information
        </h2>

        <div className="space-y-4">
          <div className="flex items-center space-x-4">
            {user.avatar ? (
              <img
                src={user.avatar}
                alt={user.name}
                className="h-16 w-16 rounded-full object-cover"
              />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary-100 text-2xl font-semibold text-primary-600 dark:bg-primary-900/30 dark:text-primary-400">
                {user.name.charAt(0).toUpperCase()}
              </div>
            )}

            <div>
              <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                {user.name}
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">{user.email}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 pt-4">
            <div>
              <label className="text-sm font-medium text-gray-500 dark:text-gray-400">
                Role
              </label>
              <p className="mt-1 capitalize text-gray-900 dark:text-white">
                {user.role}
              </p>
            </div>

            {user.lastLoginAt && (
              <div>
                <label className="text-sm font-medium text-gray-500 dark:text-gray-400">
                  Last Login
                </label>
                <p className="mt-1 text-gray-900 dark:text-white">
                  {new Date(user.lastLoginAt).toLocaleDateString()}
                </p>
              </div>
            )}

            <div>
              <label className="text-sm font-medium text-gray-500 dark:text-gray-400">
                Member Since
              </label>
              <p className="mt-1 text-gray-900 dark:text-white">
                {new Date(user.createdAt).toLocaleDateString()}
              </p>
            </div>
          </div>
        </div>
      </Card>

      {/* Change Password */}
      <Card className="p-6">
        <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">
          Change Password
        </h2>
        <ChangePasswordForm onSuccess={onPasswordChanged} />
      </Card>

      {/* Logout Section */}
      <Card className="p-6">
        <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">
          Session
        </h2>
        <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
          Sign out of your account on this device.
        </p>
        <button
          type="button"
          onClick={logout}
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-100 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/30"
        >
          Sign out
        </button>
      </Card>
    </div>
  );
}
