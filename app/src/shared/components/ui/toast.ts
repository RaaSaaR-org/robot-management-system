/**
 * @file toast.ts
 * @description Module-level toast queue: `toast.success('Route created')`
 *              works from anywhere — stores, hooks, event handlers — without a
 *              hook or a provider. <Toaster/> renders it; when no Toaster is
 *              mounted (unit tests) toasts are queued and expire harmlessly.
 * @feature shared
 */

import { useSyncExternalStore, type ReactNode } from 'react';
import { createHostRegistry } from './hostRegistry';

export type ToastTone = 'success' | 'error' | 'warning' | 'info' | 'neutral';

export interface ToastOptions {
  /** Second line: the reason, the detail */
  description?: ReactNode;
  tone?: ToastTone;
  /** ms before auto-dismiss; `null` keeps it until closed. Default 5000 (errors 8000). */
  duration?: number | null;
  /** Reusing an id replaces that toast (progress → done) */
  id?: string;
  /** One inline action ("Undo", "View") */
  action?: { label: string; onClick: () => void };
}

export interface ToastItem {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  tone: ToastTone;
  duration: number | null;
  action?: { label: string; onClick: () => void };
}

export const TOAST_DURATION = 5000;
export const TOAST_ERROR_DURATION = 8000;
const MAX_TOASTS = 5;

let toasts: ToastItem[] = [];
let seq = 0;
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const toastHosts = createHostRegistry();

function clearTimer(id: string) {
  const timer = timers.get(id);
  if (timer) {
    clearTimeout(timer);
    timers.delete(id);
  }
}

function schedule(item: ToastItem) {
  clearTimer(item.id);
  if (item.duration === null || item.duration <= 0) return;
  timers.set(
    item.id,
    setTimeout(() => dismissToast(item.id), item.duration),
  );
}

function addToast(title: ReactNode, options: ToastOptions = {}): string {
  const tone = options.tone ?? 'neutral';
  const id = options.id ?? `toast-${++seq}`;
  const item: ToastItem = {
    id,
    title,
    description: options.description,
    tone,
    duration: options.duration === undefined ? (tone === 'error' ? TOAST_ERROR_DURATION : TOAST_DURATION) : options.duration,
    action: options.action,
  };
  const exists = toasts.some((t) => t.id === id);
  toasts = exists ? toasts.map((t) => (t.id === id ? item : t)) : [...toasts, item];
  while (toasts.length > MAX_TOASTS) {
    const [oldest] = toasts;
    clearTimer(oldest.id);
    toasts = toasts.slice(1);
  }
  schedule(item);
  emit();
  return id;
}

/** Remove one toast, or all of them when called without an id. */
export function dismissToast(id?: string): void {
  if (id === undefined) {
    timers.forEach((timer) => clearTimeout(timer));
    timers.clear();
    toasts = [];
  } else {
    clearTimer(id);
    toasts = toasts.filter((t) => t.id !== id);
  }
  emit();
}

/** Hold a toast while the pointer or focus is on it. */
export function pauseToast(id: string): void {
  clearTimer(id);
}

/** Restart a paused toast's full duration. */
export function resumeToast(id: string): void {
  const item = toasts.find((t) => t.id === id);
  if (item) schedule(item);
}

type ToastShortcut = (title: ReactNode, options?: Omit<ToastOptions, 'tone'>) => string;

export interface ToastApi {
  (title: ReactNode, options?: ToastOptions): string;
  success: ToastShortcut;
  error: ToastShortcut;
  warning: ToastShortcut;
  info: ToastShortcut;
  dismiss: (id?: string) => void;
}

/**
 * @example
 * ```ts
 * toast.success('Route created');
 * toast.error("Couldn't delete route", { description: err.message });
 * const id = toast.info('Uploading…', { duration: null });
 * toast.success('Uploaded', { id });   // replaces the "Uploading…" toast
 * ```
 */
export const toast: ToastApi = Object.assign((title: ReactNode, options?: ToastOptions) => addToast(title, options), {
  success: ((title, options) => addToast(title, { ...options, tone: 'success' })) as ToastShortcut,
  error: ((title, options) => addToast(title, { ...options, tone: 'error' })) as ToastShortcut,
  warning: ((title, options) => addToast(title, { ...options, tone: 'warning' })) as ToastShortcut,
  info: ((title, options) => addToast(title, { ...options, tone: 'info' })) as ToastShortcut,
  dismiss: dismissToast,
});

/** Same API as `toast`, for code that prefers a hook. */
export function useToast(): ToastApi {
  return toast;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
const getSnapshot = () => toasts;

/** The live toast list (used by Toaster). */
export function useToasts(): ToastItem[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Current toasts, outside React (tests, debugging). */
export function getToasts(): ToastItem[] {
  return toasts;
}
