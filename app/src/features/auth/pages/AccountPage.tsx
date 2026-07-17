/**
 * @file AccountPage.tsx
 * @description Account settings page for authenticated users
 * @feature auth
 * @dependencies @/features/auth/components, @/shared/components/ui
 */

import { PageHeader } from '@/shared/components/ui';
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
      <PageHeader
        className="mb-8"
        title="Account"
        subtitle="Manage your account settings and preferences"
      />

      {/* Account Settings Panel */}
      <AccountSettingsPanel onPasswordChanged={onPasswordChanged} />
    </div>
  );
}
