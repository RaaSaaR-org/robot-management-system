/**
 * @file FeedbackProvider.tsx
 * @description Mounts the Toaster and the ConfirmHost once around the app.
 *              `toast()` and `confirm()` work without it (toasts queue
 *              silently, confirm falls back to window.confirm), so tests and
 *              pages outside the shell never crash.
 * @feature shared
 */

import type { ReactNode } from 'react';
import { ConfirmHost } from './ConfirmDialog';
import { Toaster } from './Toaster';

export interface FeedbackProviderProps {
  children?: ReactNode;
}

/**
 * @example
 * ```tsx
 * <FeedbackProvider><AppLayout>{page}</AppLayout></FeedbackProvider>
 * ```
 */
export function FeedbackProvider({ children }: FeedbackProviderProps) {
  return (
    <>
      {children}
      <Toaster />
      <ConfirmHost />
    </>
  );
}

/** The contract's name for the same thing. */
export const ToastProvider = FeedbackProvider;
