/**
 * @file MobileNav.tsx
 * @description Slide-out mobile navigation drawer
 * @feature layout
 * @dependencies react-router-dom, @/shared/utils/cn, ./Sidebar
 */

import { useEffect, useCallback } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { cn } from '@/shared/utils/cn';
import { NAV_ITEMS } from './Sidebar';

// ============================================================================
// TYPES
// ============================================================================

export interface MobileNavProps {
  /** Whether the drawer is open */
  isOpen: boolean;
  /** Called when the drawer should close */
  onClose: () => void;
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Mobile navigation drawer that slides in from the left.
 * Includes backdrop overlay and closes on navigation or escape key.
 *
 * @example
 * ```tsx
 * <MobileNav isOpen={menuOpen} onClose={() => setMenuOpen(false)} />
 * ```
 */
export function MobileNav({ isOpen, onClose }: MobileNavProps) {
  const location = useLocation();

  // Close on escape key
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isOpen) {
        onClose();
      }
    },
    [isOpen, onClose]
  );

  // Close on route change
  useEffect(() => {
    if (isOpen) {
      onClose();
    }
    // Only run when location changes, not when isOpen/onClose changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // Add/remove escape key listener
  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Prevent body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  return (
    <>
      {/* Backdrop overlay */}
      <div
        className={cn(
          'fixed inset-0 z-40 bg-black/50 backdrop-blur-sm transition-opacity duration-300',
          'md:hidden', // Only on mobile
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Navigation drawer */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
        className={cn(
          'fixed left-0 top-0 bottom-0 z-50 w-72',
          'section-secondary border-r border-theme',
          'transition-transform duration-300 ease-in-out',
          'md:hidden', // Only on mobile
          isOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* Header */}
        <div className="h-14 flex items-center justify-between px-4 border-b border-theme">
          <span className="font-semibold text-theme-primary">Menu</span>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-theme-secondary hover:text-theme-primary hover:bg-theme-hover rounded-lg transition-colors"
            aria-label="Close menu"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Navigation items */}
        <nav className="p-4 space-y-1">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 px-3 py-3 rounded-brand transition-colors',
                  isActive
                    ? 'bg-cobalt text-white'
                    : 'text-theme-secondary hover:text-theme-primary hover:bg-theme-hover'
                )
              }
            >
              {item.icon}
              <span className="font-medium">{item.label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>
    </>
  );
}
