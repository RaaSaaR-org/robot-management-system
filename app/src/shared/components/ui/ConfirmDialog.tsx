/**
 * @file ConfirmDialog.tsx
 * @description ConfirmDialog (declarative) and ConfirmHost (renders the
 *              imperative `confirm()` queue). Every destructive action goes
 *              through one of them: "Delete ‹name›?", the consequence, Delete.
 * @feature shared
 */

import { useRef, useState, type ReactNode } from 'react';
import { Button } from './Button';
import { Modal } from './Modal';
import { confirmHosts, settleConfirm, useCurrentConfirm } from './confirm';

export interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Runs on confirm. If it returns a promise the button shows loading until it settles. Closing is up to you. */
  onConfirm: () => void | Promise<void>;
  /** "Delete ‹name›?" */
  title: ReactNode;
  /** The consequence */
  description?: ReactNode;
  /** Extra body content under the description */
  children?: ReactNode;
  /** Default "Delete" for tone danger, else "Confirm" */
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'default';
  /** Controlled loading state of the confirm button */
  isLoading?: boolean;
}

/**
 * @example
 * ```tsx
 * <ConfirmDialog
 *   isOpen={!!pendingDelete}
 *   onClose={() => setPendingDelete(null)}
 *   onConfirm={async () => { await deleteRoute(pendingDelete!.id); setPendingDelete(null); toast.success('Route deleted'); }}
 *   title={`Delete ${pendingDelete?.name}?`}
 *   description="Scheduled runs stop. Past runs are kept."
 *   tone="danger"
 * />
 * ```
 */
export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  children,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'default',
  isLoading,
}: ConfirmDialogProps) {
  const [pending, setPending] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const loading = isLoading ?? pending;

  const handleConfirm = () => {
    if (loading) return;
    const result = onConfirm();
    if (result && typeof (result as Promise<void>).then === 'function') {
      setPending(true);
      (result as Promise<void>).finally(() => setPending(false));
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={loading ? () => undefined : onClose}
      title={title}
      description={description}
      size="sm"
      role="alertdialog"
      closeOnBackdrop={!loading}
      closeOnEscape={!loading}
      initialFocusRef={tone === 'danger' ? cancelRef : confirmRef}
      footer={
        <>
          <Button ref={cancelRef} variant="ghost" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            ref={confirmRef}
            variant={tone === 'danger' ? 'danger' : 'primary'}
            onClick={handleConfirm}
            isLoading={loading}
          >
            {confirmLabel ?? (tone === 'danger' ? 'Delete' : 'Confirm')}
          </Button>
        </>
      }
    >
      {children}
    </Modal>
  );
}

/**
 * Renders requests made with `confirm()`. Mount once (FeedbackProvider does);
 * extra instances render nothing.
 */
export function ConfirmHost() {
  const active = confirmHosts.useIsActiveHost();
  const current = useCurrentConfirm();
  if (!active || !current) return null;
  return (
    <ConfirmDialog
      key={current.id}
      isOpen
      onClose={() => settleConfirm(current.id, false)}
      onConfirm={() => settleConfirm(current.id, true)}
      title={current.title}
      description={current.description}
      confirmLabel={current.confirmLabel}
      cancelLabel={current.cancelLabel}
      tone={current.tone}
    />
  );
}
