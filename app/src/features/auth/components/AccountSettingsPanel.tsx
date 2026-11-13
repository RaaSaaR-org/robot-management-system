/**
 * @file AccountSettingsPanel.tsx
 * @description The /account grid: Profile, Change password and Two-step verification panels
 * @feature auth
 */

import { KeyValueList, Panel, StatusTag } from '@/shared/components/ui';
import { useFeatures } from '@/shared/hooks/useFeatures';
import { useAuth } from '../hooks/useAuth';
import { ChangePasswordForm } from './ChangePasswordForm';
import { SecuritySettings } from './SecuritySettings';
import { formatDate as formatUiDate } from '@/shared/utils/format';

export interface AccountSettingsPanelProps {
  /** Callback when password is changed */
  onPasswordChanged?: () => void;
}

const formatDate = (iso?: string) => (iso ? formatUiDate(iso) : undefined);

export function AccountSettingsPanel({ onPasswordChanged }: AccountSettingsPanelProps) {
  const { user } = useAuth();
  // TASK-483: without sign-in the profile is the server's shared user. It has
  // no password or second factor to manage, and its address and dates are
  // placeholders — /me stamps "member since" with the time of the request.
  const { signInRequired } = useFeatures();
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
              <div className="truncate text-[13px] text-ink-tertiary">
                {signInRequired ? user.email : 'Shared account'}
              </div>
            </div>
          </div>
          <KeyValueList
            items={[
              { label: 'Role', value: <StatusTag tone="neutral">{user.role}</StatusTag> },
              ...(signInRequired
                ? [
                    { label: 'Member since', value: formatDate(user.createdAt) },
                    { label: 'Last sign-in', value: formatDate(user.lastLoginAt) },
                  ]
                : []),
              { label: 'User ID', value: user.id, mono: true },
            ]}
          />
        </Panel.Body>
      </Panel>

      {signInRequired && (
        <>
          <Panel>
            <Panel.Header title="Change password" description="You stay signed in on this device." />
            <ChangePasswordForm onSuccess={onPasswordChanged} />
          </Panel>

          <SecuritySettings />
        </>
      )}
    </div>
  );
}
