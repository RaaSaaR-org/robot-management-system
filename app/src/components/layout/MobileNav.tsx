/**
 * @file MobileNav.tsx
 * @description Mobile navigation drawer (<768px): slides in from the left on
 *              the inset ground with the same groups as the sidebar. Closes on
 *              navigation, Esc and a click on the overlay; traps focus while
 *              open and hands it back to the menu button when it closes.
 * @feature layout
 */

import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useLocation } from 'react-router-dom';
import { X } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { Logo } from '@/components/common/Logo';
import { Button } from '@/shared/components/ui/Button';
import { NavList, logoFocusRing } from './NavList';
import { useVisibleNavGroups } from './navigation';

// ============================================================================
// TYPES
// ============================================================================

export interface MobileNavProps {
  /** Whether the drawer is open */
  isOpen: boolean;
  /** Called when the drawer should close */
  onClose: () => void;
}

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * @example
 * ```tsx
 * <MobileNav isOpen={menuOpen} onClose={() => setMenuOpen(false)} />
 * ```
 */
export function MobileNav({ isOpen, onClose }: MobileNavProps) {
  const location = useLocation();
  const groups = useVisibleNavGroups();
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const lastPathRef = useRef(location.pathname);

  // Close on route change — a real change, not the first render.
  useEffect(() => {
    if (lastPathRef.current === location.pathname) return;
    lastPathRef.current = location.pathname;
    if (isOpen) onClose();
    // Only run when the location changes, not when isOpen/onClose change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // Esc closes, wherever focus is.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  // Focus: into the drawer on open, back to whatever opened it on close.
  useEffect(() => {
    if (isOpen) {
      returnFocusRef.current = document.activeElement as HTMLElement | null;
      closeRef.current?.focus();
      return;
    }
    const target = returnFocusRef.current;
    returnFocusRef.current = null;
    if (target && document.contains(target)) target.focus();
  }, [isOpen]);

  // No page scroll behind the open drawer.
  useEffect(() => {
    if (!isOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isOpen]);

  // Keep Tab inside the drawer.
  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab' || !panelRef.current) return;
    const nodes = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <>
      {/* Overlay — dimmed, never blurred */}
      <div
        data-testid="mobile-nav-overlay"
        className={cn(
          'fixed inset-0 z-40 bg-black/60 md:hidden',
          'transition-opacity duration-150 ease-[var(--ease-instrument)]',
          isOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
        aria-hidden={!isOpen}
        inert={!isOpen}
        onKeyDown={onKeyDown}
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col md:hidden',
          'bg-inset border-r border-line-subtle duration-200 ease-[var(--ease-instrument)]',
          // Opening turns visible at once (focus can land in the same frame);
          // closing keeps it visible until the slide-out ends.
          isOpen
            ? 'visible translate-x-0 transition-[translate]'
            : 'invisible -translate-x-full transition-[translate,visibility]',
        )}
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-line-subtle pl-4 pr-2">
          <div className={logoFocusRing}>
            <Logo size="sm" linkTo="/dashboard" />
          </div>
          <Button ref={closeRef} variant="ghost" iconOnly aria-label="Close menu" onClick={onClose}>
            <X className="h-5 w-5" strokeWidth={1.75} />
          </Button>
        </div>

        <nav aria-label="Main navigation" className="flex-1 overflow-y-auto overscroll-contain px-3 py-5">
          <NavList groups={groups} variant="drawer" onNavigate={onClose} />
        </nav>
      </aside>
    </>
  );
}
