/**
 * @file hostRegistry.ts
 * @description Lets a "host" component (Toaster, ConfirmHost) be mounted more
 *              than once without rendering twice: only the first mounted
 *              instance is active. The shell mounts the hosts; a page or test
 *              that mounts its own gets exactly one working copy either way.
 * @feature shared
 */

import { useEffect, useId, useSyncExternalStore } from 'react';

export interface HostRegistry {
  /** True in the one active instance */
  useIsActiveHost(): boolean;
  /** Whether any instance is mounted right now */
  hasHost(): boolean;
}

export function createHostRegistry(): HostRegistry {
  let hosts: string[] = [];
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const getSnapshot = () => hosts[0] ?? null;

  function useIsActiveHost(): boolean {
    const id = useId();
    useEffect(() => {
      hosts = [...hosts, id];
      emit();
      return () => {
        hosts = hosts.filter((h) => h !== id);
        emit();
      };
    }, [id]);
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot) === id;
  }

  return { useIsActiveHost, hasHost: () => hosts.length > 0 };
}
