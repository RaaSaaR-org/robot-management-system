/**
 * @file AccountPage.tsx
 * @description Account: profile, password and two-step verification; sign out in the header
 * @feature auth
 */

import { useNavigate } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { PageHeader } from '@/shared/components/ui';
import { AccountSettingsPanel } from '../components/AccountSettingsPanel';
import { LogoutButton } from '../components/LogoutButton';

export interface AccountPageProps {
  /** Callback when password is changed */
  onPasswordChanged?: () => void;
}

export function AccountPage({ onPasswordChanged }: AccountPageProps) {
  const navigate = useNavigate();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Account"
        description="Your profile, password and sign-in security."
        actions={
          <LogoutButton
            variant="secondary"
            leftIcon={<LogOut className="h-4 w-4" strokeWidth={1.75} />}
            onLogout={() => navigate('/login', { replace: true })}
          />
        }
      />
      <AccountSettingsPanel onPasswordChanged={onPasswordChanged} />
    </div>
  );
}
