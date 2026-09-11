/**
 * @file confirm.ts
 * @description Imperative confirmation, so replacing window.confirm is one
 *              line: `if (!(await confirm({ title, tone: 'danger' }))) return;`.
 *              A module-level queue rendered by <ConfirmHost/> (mounted once by
 *              the shell via FeedbackProvider). With no host mounted it falls
 *              back to window.confirm, so nothing hangs.
 * @feature shared
 */

import { useSyncExternalStore, type ReactNode } from 'react';
import { createHostRegistry } from './hostRegistry';

export interface ConfirmOptions {
  /** "Delete ‹name›?" */
  title: ReactNode;
  /** The consequence, in one or two sentences */
  description?: ReactNode;
  /** Default "Delete" for tone danger, else "Confirm" */
  confirmLabel?: string;
  /** Default "Cancel" */
  cancelLabel?: string;
  /** `danger` → red confirm button, focus starts on Cancel */
  tone?: 'danger' | 'default';
}

export interface ConfirmRequest extends ConfirmOptions {
  id: number;
}

interface PendingRequest extends ConfirmRequest {
  resolve: (confirmed: boolean) => void;
}

let queue: PendingRequest[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const confirmHosts = createHostRegistry();

function textOf(node: ReactNode): string {
  return typeof node === 'string' || typeof node === 'number' ? String(node) : '';
}

/**
 * Ask the user to confirm. Resolves `true` on confirm, `false` on cancel/Esc.
 *
 * @example
 * ```ts
 * const ok = await confirm({
 *   title: `Delete ${route.name}?`,
 *   description: 'Scheduled runs of this route stop. Past runs are kept.',
 *   tone: 'danger',
 * });
 * if (!ok) return;
 * ```
 */
export function confirm(options: ConfirmOptions): Promise<boolean> {
  if (!confirmHosts.hasHost()) {
    const message = [textOf(options.title), textOf(options.description)].filter(Boolean).join('\n\n');
    try {
      return Promise.resolve(Boolean(window.confirm(message)));
    } catch {
      return Promise.resolve(false);
    }
  }
  return new Promise<boolean>((resolve) => {
    seq += 1;
    queue = [...queue, { ...options, id: seq, resolve }];
    emit();
  });
}

/** Settle a queued request (used by ConfirmHost). */
export function settleConfirm(id: number, confirmed: boolean): void {
  const request = queue.find((r) => r.id === id);
  if (!request) return;
  queue = queue.filter((r) => r.id !== id);
  emit();
  request.resolve(confirmed);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
const getSnapshot = () => queue;

/** The request currently shown (the head of the queue), or null. */
export function useCurrentConfirm(): ConfirmRequest | null {
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return current[0] ?? null;
}
