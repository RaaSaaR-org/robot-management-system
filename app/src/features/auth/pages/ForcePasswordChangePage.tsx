/**
 * @file ForcePasswordChangePage.tsx
 * @description Full-page "Set a new password" gate shown on first login
 * after an owner adds a teammate via the Team page (TASK-163). Blocks
 * navigation until the user completes the set — ProtectedAppRoute
 * redirects every other protected route back here while the gate is
 * active. TASK-164.
 * @feature auth
 */

import { useNavigate } from 'react-router-dom';
import { ChangePasswordForm } from '../components/ChangePasswordForm';
import { useAuthStore, selectUser } from '../store/authStore';

export function ForcePasswordChangePage() {
  const navigate = useNavigate();
  const user = useAuthStore(selectUser);

  const handleSuccess = () => {
    // Store has already flipped mustChangePassword=false. Navigate to
    // the dashboard now that the gate is cleared.
    navigate('/dashboard', { replace: true });
  };

  return (
    <div className="min-h-screen bg-theme-bg flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-theme-card border border-theme rounded-brand shadow-xl p-8">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold text-theme-primary">
            Set a new password
          </h1>
          <p className="text-sm text-theme-secondary mt-2">
            Welcome to NeoDEM{user?.name ? `, ${user.name}` : ''}. Please set a
            new password before continuing.
          </p>
        </div>

        <ChangePasswordForm onSuccess={handleSuccess} />

        <p className="text-xs text-theme-tertiary mt-6 text-center">
          Enter the temporary password you received as the current password,
          then choose a new one.
        </p>
      </div>
    </div>
  );
}
