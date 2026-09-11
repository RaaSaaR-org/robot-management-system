/**
 * @file FormModal.tsx
 * @description Create and Edit, identical on every page: a <form> in a Modal
 *              with Cancel (ghost) + submit (primary) in the footer. Enter
 *              submits, the form is disabled while submitting, a form-level
 *              error shows above the fields.
 * @feature shared
 */

import type { FormEvent, ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';
import { Button } from './Button';
import { Modal, type ModalSize } from './Modal';

export interface FormModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** "New ‹thing›" / "Edit ‹thing›" */
  title: ReactNode;
  description?: ReactNode;
  /** Called on submit; the default (page reload) is already prevented */
  onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  /** "Create ‹thing›" / "Save changes" */
  submitLabel: string;
  /** Shown on the submit button while submitting (default: submitLabel) */
  submittingLabel?: string;
  cancelLabel?: string;
  isSubmitting?: boolean;
  submitDisabled?: boolean;
  /** `danger` for forms whose act is destructive */
  submitVariant?: 'primary' | 'danger';
  /** Form-level message (a failed request); field errors go on FormField */
  error?: ReactNode;
  size?: ModalSize;
  /** Close on backdrop click (default false — a stray click must not lose typed input) */
  closeOnBackdrop?: boolean;
  /** Skip native constraint validation (when you validate yourself) */
  noValidate?: boolean;
  children: ReactNode;
}

/**
 * @example
 * ```tsx
 * <FormModal
 *   isOpen={open}
 *   onClose={() => setOpen(false)}
 *   title="New route"
 *   submitLabel="Create route"
 *   isSubmitting={saving}
 *   error={saveError}
 *   onSubmit={async () => { await createRoute(draft); toast.success('Route created'); setOpen(false); }}
 * >
 *   <FormField label="Name" required error={errors.name}><Input value={name} onChange={…} /></FormField>
 * </FormModal>
 * ```
 */
export function FormModal({
  isOpen,
  onClose,
  title,
  description,
  onSubmit,
  submitLabel,
  submittingLabel,
  cancelLabel = 'Cancel',
  isSubmitting = false,
  submitDisabled = false,
  submitVariant = 'primary',
  error,
  size = 'md',
  closeOnBackdrop = false,
  noValidate,
  children,
}: FormModalProps) {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting || submitDisabled) return;
    void onSubmit(event);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      description={description}
      size={size}
      closeOnBackdrop={closeOnBackdrop && !isSubmitting}
      closeOnEscape={!isSubmitting}
      onSubmit={handleSubmit}
      noValidate={noValidate}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>
            {cancelLabel}
          </Button>
          <Button
            type="submit"
            variant={submitVariant}
            isLoading={isSubmitting}
            loadingText={submittingLabel ?? submitLabel}
            disabled={submitDisabled}
          >
            {submitLabel}
          </Button>
        </>
      }
    >
      {error && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2.5 rounded-control border border-signal-stopped/30 bg-signal-stopped/10 px-3 py-2.5 text-[13px] text-signal-stopped"
        >
          <AlertCircle className="mt-px h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
          <div className="min-w-0 break-words">{error}</div>
        </div>
      )}
      <fieldset disabled={isSubmitting} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
        {children}
      </fieldset>
    </Modal>
  );
}
