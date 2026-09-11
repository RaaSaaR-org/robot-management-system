/**
 * @file AccountSettingsPanel.tsx
 * @description The /account grid: Profile, Change password and Two-step verification panels
 * @feature auth
 */

import { KeyValueList, Panel, StatusTag } from '@/shared/components/ui';
import { UI_DATE_LOCALE } from '@/shared/utils/format';
import { useAuth } from '../hooks/useAuth';
import { ChangePasswordForm } from './ChangePasswordForm';
import { SecuritySettings } from './SecuritySettings';

export interface AccountSettingsPanelProps {
  /** Callback when password is changed */
  onPasswordChanged?: () => void;
}

const formatDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(UI_DATE_LOCALE) : undefined);

export function AccountSettingsPanel({ onPasswordChanged }: AccountSettingsPanelProps) {
  const { user } = useAuth();
  if (!user) return null;

  const initials = user.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');

  return (
    <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-2">
      <Panel>
        <Panel.Header title="Profile" />
        <Panel.Body className="flex flex-col gap-5">
          <div className="flex items-center gap-4">
            {user.avatar ? (
              <img src={user.avatar} alt="" className="h-12 w-12 rounded-control object-cover" />
            ) : (
              <div
                aria-hidden="true"
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-control bg-primary/10 text-base font-semibold text-primary"
              >
                {initials || '?'}
              </div>
            )}
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-ink-primary">{user.name}</div>
              <div className="truncate text-[13px] text-ink-tertiary">{user.email}</div>
            </div>
          </div>
          <KeyValueList
            items={[
              { label: 'Role', value: <StatusTag tone="neutral">{user.role}</StatusTag> },
              { label: 'Member since', value: formatDate(user.createdAt) },
              { label: 'Last sign-in', value: formatDate(user.lastLoginAt) },
              { label: 'User ID', value: user.id, mono: true },
            ]}
          />
        </Panel.Body>
      </Panel>

      <Panel>
        <Panel.Header title="Change password" description="You stay signed in on this device." />
        <ChangePasswordForm onSuccess={onPasswordChanged} />
      </Panel>

      <SecuritySettings />
    </div>
  );
}
