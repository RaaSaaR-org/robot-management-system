/**
 * @file useSessionPresence.ts
 * @description Declares this page as a watcher of a data-collection session
 *              (TASK-414, D2): `teleop:watch` with its role on mount and every
 *              10 s, `teleop:unwatch` on unmount. The session page declares
 *              `assistant`; while its VR modal is open it declares nothing,
 *              because the headset's publisher has claimed `operator`. Who
 *              watches comes back as `teleop:session:presence` through
 *              `useTeleopEvents` into the store.
 * @feature datacollection
 */

import { useEffect } from 'react';
import { openSessionWatch, type WatchRole } from '@/shared/utils/sessionWatch';
import { useAuthStore } from '@/features/auth/store/authStore';

/**
 * Watch `sessionId` as `role` for as long as both are set. Pass a null role to
 * stop watching (the page's VR modal is open).
 */
export function useSessionPresence(sessionId: string | null | undefined, role: WatchRole | null): void {
  const displayName = useAuthStore((s) => s.user?.name ?? s.user?.email ?? undefined);
  useEffect(() => {
    if (!sessionId || !role || import.meta.env.VITE_DEMO_MODE === 'true') return undefined;
    const watch = openSessionWatch({ sessionId, role, displayName });
    return () => watch.close();
  }, [sessionId, role, displayName]);
}
