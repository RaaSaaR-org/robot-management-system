/**
 * @file Modal.tsx
 * @description The kit's dialog: matte raised panel over a dark overlay (no
 *              blur), Archivo title, optional description, a body that scrolls
 *              inside 85vh, and a right-aligned footer. Real focus trap, Esc to
 *              close, focus returns to the opener, body scroll is locked, and
 *              below 640px it becomes a bottom sheet. Nested dialogs stack:
 *              only the top one reacts to Esc and Tab.
 * @feature shared
 * @dependencies shared/utils/cn, shared/components/ui/Button
 */

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  type FormEventHandler,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { Button } from './Button';
import { panelTitle } from './styles';

// ============================================================================
// TYPES
// ============================================================================

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

export interface ModalProps {
  /** Control modal visibility */
  isOpen: boolean;
  /** Callback when modal requests close */
  onClose: () => void;
  /** Modal title (Archivo 16px) */
  title?: ReactNode;
  /** One or two lines under the title */
  description?: ReactNode;
  /** Modal content */
  children?: ReactNode;
  /** Footer content (typically action buttons; right-aligned) */
  footer?: ReactNode;
  /** Size of the modal */
  size?: ModalSize;
  /** Close on backdrop click (default: true) */
  closeOnBackdrop?: boolean;
  /** Close on escape key (default: true) */
  closeOnEscape?: boolean;
  /** Show close button in header (default: true) */
  showCloseButton?: boolean;
  /** Additional className for the dialog panel */
  className?: string;
  /** Additional className for the scrolling body */
  bodyClassName?: string;
  /** Element to focus on open (default: first [data-autofocus], else first field/control in the body) */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** `alertdialog` for confirmations */
  role?: 'dialog' | 'alertdialog';
  /** When set, the dialog panel is a <form> wrapping header, body and footer (used by FormModal) */
  onSubmit?: FormEventHandler<HTMLFormElement>;
  /** Disable native form validation when `onSubmit` is set */
  noValidate?: boolean;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const sizeStyles: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  full: 'max-w-[calc(100vw-2rem)] sm:max-h-[calc(100vh-2rem)]',
};

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',');

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute('inert') && el.getAttribute('aria-hidden') !== 'true' && el.tabIndex !== -1,
  );
}

// ============================================================================
// MODULE STATE — the stack of open dialogs and the scroll lock
// ============================================================================

/**
 * Open dialogs with their nesting depth. The top dialog is the deepest one,
 * latest-opened on a tie: effects run child-first, so a parent and a child
 * that open in the same render register in the "wrong" order — depth fixes it.
 */
const openStack: { id: string; depth: number }[] = [];
const ModalDepthContext = createContext(0);

function isTopDialog(id: string): boolean {
  let top: { id: string; depth: number } | undefined;
  for (const entry of openStack) {
    if (!top || entry.depth >= top.depth) top = entry;
  }
  return top?.id === id;
}

let scrollLocks = 0;
let savedOverflow = '';

function lockScroll() {
  if (scrollLocks === 0) {
    savedOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  scrollLocks += 1;
}

function unlockScroll() {
  scrollLocks = Math.max(0, scrollLocks - 1);
  if (scrollLocks === 0) document.body.style.overflow = savedOverflow;
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * @example
 * ```tsx
 * <Modal
 *   isOpen={open}
 *   onClose={() => setOpen(false)}
 *   title="Run details"
 *   description="Started 12:04 by patrol schedule."
 *   footer={<Button variant="secondary" onClick={() => setOpen(false)}>Close</Button>}
 * >
 *   …
 * </Modal>
 * ```
 */
export function Modal({
  isOpen,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  closeOnBackdrop = true,
  closeOnEscape = true,
  showCloseButton = true,
  className,
  bodyClassName,
  initialFocusRef,
  role = 'dialog',
  onSubmit,
  noValidate,
}: ModalProps) {
  const dialogId = useId();
  const depth = useContext(ModalDepthContext) + 1;
  const titleId = `${dialogId}-title`;
  const descriptionId = `${dialogId}-description`;
  const panelRef = useRef<HTMLElement | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Latest handlers without re-running the open effect on every render.
  const onCloseRef = useRef(onClose);
  const closeOnEscapeRef = useRef(closeOnEscape);
  useEffect(() => {
    onCloseRef.current = onClose;
    closeOnEscapeRef.current = closeOnEscape;
  });

  useEffect(() => {
    if (!isOpen) return;

    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    openStack.push({ id: dialogId, depth });
    lockScroll();

    // Initial focus, after the portal has mounted.
    const panel = panelRef.current;
    if (panel) {
      const explicit = initialFocusRef?.current;
      const auto = panel.querySelector<HTMLElement>('[data-autofocus]');
      const firstField = bodyRef.current
        ? focusables(bodyRef.current).find((el) => el.matches('input, select, textarea')) ??
          focusables(bodyRef.current)[0]
        : undefined;
      (explicit ?? auto ?? firstField ?? panel).focus({ preventScroll: true });
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTopDialog(dialogId)) return;
      const root = panelRef.current;
      if (!root) return;

      if (event.key === 'Escape') {
        if (closeOnEscapeRef.current) {
          event.preventDefault();
          onCloseRef.current();
        }
        return;
      }

      if (event.key !== 'Tab') return;
      const items = focusables(root);
      if (items.length === 0) {
        event.preventDefault();
        root.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      const inside = active instanceof Node && root.contains(active);
      if (event.shiftKey && (active === first || !inside || active === root)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !inside)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      const index = openStack.findIndex((entry) => entry.id === dialogId);
      if (index !== -1) openStack.splice(index, 1);
      unlockScroll();
      if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    };
    // initialFocusRef is read once at open time on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, dialogId, depth]);

  if (!isOpen) {
    return null;
  }

  const handleBackdropClick = (event: MouseEvent) => {
    if (closeOnBackdrop && event.target === event.currentTarget) onClose();
  };

  const hasBody = children !== undefined && children !== null && children !== false;
  const hasHeader = Boolean(title) || Boolean(description) || showCloseButton;

  const inner = (
    <>
      {hasHeader && (
        <div className="flex shrink-0 items-start gap-3 px-5 pb-3 pt-4">
          <div className="min-w-0 flex-1 pt-1">
            {title && (
              <h2 id={titleId} className={panelTitle}>
                {title}
              </h2>
            )}
            {description && (
              <div id={descriptionId} className="mt-1.5 text-sm leading-relaxed text-ink-secondary">
                {description}
              </div>
            )}
          </div>
          {showCloseButton && (
            <Button variant="ghost" size="sm" iconOnly onClick={onClose} aria-label="Close dialog" className="-mr-1.5 shrink-0">
              <X className="h-4 w-4" strokeWidth={1.75} />
            </Button>
          )}
        </div>
      )}

      {hasBody && (
        <div
          ref={bodyRef}
          className={cn(
            'min-h-0 flex-1 overflow-y-auto px-5 text-sm text-ink-secondary',
            hasHeader ? 'pb-5 pt-1' : 'py-5',
            bodyClassName,
          )}
        >
          {children}
        </div>
      )}

      {footer && (
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-line-subtle px-5 py-3">
          {footer}
        </div>
      )}
    </>
  );

  const panelProps = {
    role,
    'aria-modal': true as const,
    'aria-labelledby': title ? titleId : undefined,
    'aria-describedby': description ? descriptionId : undefined,
    tabIndex: -1,
    className: cn(
      'relative flex max-h-[85vh] w-full flex-col outline-none',
      'border border-line-strong bg-raised shadow-[0_24px_64px_rgba(0,0,0,0.5)]',
      // Bottom sheet on phones, centred dialog from 640px.
      'rounded-t-panel border-b-0 sm:rounded-panel sm:border-b',
      sizeStyles[size],
      className,
    ),
  };

  const modalContent = (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4"
      onClick={handleBackdropClick}
    >
      <div className="pointer-events-none absolute inset-0 bg-black/60" aria-hidden="true" />
      {onSubmit ? (
        <form
          ref={(node) => {
            panelRef.current = node;
          }}
          onSubmit={onSubmit}
          noValidate={noValidate}
          {...panelProps}
        >
          {inner}
        </form>
      ) : (
        <div
          ref={(node) => {
            panelRef.current = node;
          }}
          {...panelProps}
        >
          {inner}
        </div>
      )}
    </div>
  );

  return createPortal(
    <ModalDepthContext.Provider value={depth}>{modalContent}</ModalDepthContext.Provider>,
    document.body,
  );
}
