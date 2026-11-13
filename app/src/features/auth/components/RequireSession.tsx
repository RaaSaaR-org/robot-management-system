/**
 * @file RequireSession.tsx
 * @description The app shell's route guard. Where the server requires sign-in,
 *              a visitor without a session is sent to /login, as before. Where
 *              it does not (TASK-483), there is no sign-in to send anyone to:
 *              the visitor is the server's shared user, and the one way to be
 *              "not authenticated" is that the server did not answer — which
 *              gets a retry, never a form that no credentials exist for.
 * @feature auth
 */

import { type ReactNode } from 'react';
import { ServerOff } from 'lucide-react';
import { Button, EmptyState } from '@/shared/components/ui';
import { useFeatures } from '@/shared/hooks/useFeatures';
import { useAuthStore } from '../store/authStore';
import { ProtectedRoute } from './ProtectedRoute';

/** Leave for the sign-in page (the landing page in the static demo build). */
function goToSignIn() {
  if (import.meta.env.VITE_DEMO_MODE === 'true') {
    window.location.href = import.meta.env.BASE_URL || '/';
  } else {
    window.location.href = '/login';
  }
}

function ServerUnreachable() {
  const initialize = useAuthStore((state) => state.initialize);
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas p-8">
      <EmptyState
        icon={<ServerOff />}
        title="Can't reach the server"
        description="No sign-in is needed here, but the server did not answer. Check the connection and try again."
        action={<Button onClick={() => void initialize()}>Try again</Button>}
      />
    </div>
  );
}

export interface RequireSessionProps {
  children: ReactNode;
  /** What "go and sign in" does. Defaults to leaving for the sign-in page. */
  onSignInNeeded?: () => void;
}

export function RequireSession({ children, onSignInNeeded = goToSignIn }: RequireSessionProps) {
  const { signInRequired } = useFeatures();

  if (!signInRequired) {
    return <ProtectedRoute unauthenticatedFallback={<ServerUnreachable />}>{children}</ProtectedRoute>;
  }
  return <ProtectedRoute onUnauthenticated={onSignInNeeded}>{children}</ProtectedRoute>;
}
