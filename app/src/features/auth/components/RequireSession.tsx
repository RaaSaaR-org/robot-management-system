/**
 * @file RequireSession.tsx
 * @description The app shell's route guard. Where the server requires sign-in,
 *              a visitor without a session is sent to /login, as before. Where
 *              it does not (TASK-483), there is no sign-in to send anyone to:
 *              the visitor is the server's shared user, and the one way to be
 *              "not authenticated" is that the server did not answer — which
 *              gets a retry, never a form that no credentials exist for.
 *              While the server has not said which of the two it is (TASK-503:
 *              its feature snapshot failed to load), nobody is sent away
 *              either: the deep link stays put behind the same retry.
 * @feature auth
 */

import { type ReactNode } from 'react';
import { ServerOff } from 'lucide-react';
import { Button, EmptyState, Spinner } from '@/shared/components/ui';
import { useFeatures, useFeaturesStore } from '@/shared/hooks/useFeatures';
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

/**
 * `signInKnown` is false while the server has not said whether it needs a
 * sign-in, so the screen must not promise that none is needed.
 */
function ServerUnreachable({ signInKnown = true }: { signInKnown?: boolean }) {
  const initialize = useAuthStore((state) => state.initialize);
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas p-8">
      <EmptyState
        icon={<ServerOff />}
        title="Can't reach the server"
        description={
          signInKnown
            ? 'No sign-in is needed here, but the server did not answer. Check the connection and try again.'
            : 'The server did not answer. Check the connection and try again.'
        }
        action={<Button onClick={() => void initialize()}>Try again</Button>}
      />
    </div>
  );
}

/**
 * What a visitor without a session sees while the feature snapshot is not in:
 * the retry once the request failed, a spinner while it is still on its way.
 * `initialize` asks for the snapshot again, and `useFeatures` retries it on its
 * own every few seconds; either way this gives way as soon as the answer
 * arrives.
 */
function SignInUnknown() {
  const failed = useFeaturesStore((s) => s.error !== null);
  if (failed) return <ServerUnreachable signInKnown={false} />;
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas" role="status" aria-label="Contacting the server">
      <Spinner size="lg" color="primary" />
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
  const flagsLoaded = useFeaturesStore((s) => s.loaded);

  // TASK-503: `signInRequired` is only a default until the snapshot loads. One
  // failed request on a hard reload must not throw a deep link away for a
  // sign-in page that may not even apply here. A stored session still opens.
  if (!flagsLoaded) {
    return <ProtectedRoute unauthenticatedFallback={<SignInUnknown />}>{children}</ProtectedRoute>;
  }
  if (!signInRequired) {
    return <ProtectedRoute unauthenticatedFallback={<ServerUnreachable />}>{children}</ProtectedRoute>;
  }
  return <ProtectedRoute onUnauthenticated={onSignInNeeded}>{children}</ProtectedRoute>;
}
