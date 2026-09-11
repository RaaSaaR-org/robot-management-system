/**
 * @file ForcePasswordChangePage.tsx
 * @description "Set a new password" gate shown on first login after an owner adds a teammate
 * via the Team page (TASK-163). It renders outside the shell on the AuthLayout; ProtectedAppRoute
 * sends every other protected route back here while the gate is active. TASK-164.
 * @feature auth
 */

import { useNavigate } from 'react-router-dom';
import { useBrand } from '@/brand';
import { AuthLayout } from '../components/AuthLayout';
import { ChangePasswordForm } from '../components/ChangePasswordForm';
import { useAuthStore, selectUser } from '../store/authStore';
import { LogoutButton } from '../components/LogoutButton';

export function ForcePasswordChangePage() {
  const navigate = useNavigate();
  const brand = useBrand();
  const user = useAuthStore(selectUser);

  return (
    <AuthLayout
      title="Set a new password"
      description={`Welcome to ${brand.name}${user?.name ? `, ${user.name}` : ''}. Use the temporary password you received as the current one, then choose your own.`}
      footer={<LogoutButton variant="ghost" size="sm" onLogout={() => navigate('/login', { replace: true })} />}
    >
      {/* The store has already cleared mustChangePassword when this succeeds. */}
      <ChangePasswordForm variant="auth" onSuccess={() => navigate('/dashboard', { replace: true })} />
    </AuthLayout>
  );
}
