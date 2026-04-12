/**
 * @file UserMenu.tsx
 * @description TopBar user menu — clickable avatar that expands to
 * show the current user's identity, a link to the account page, and
 * sign out. Replaces the static avatar + name pair.
 * @feature layout
 */

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth, LogoutButton } from '@/features/auth';

const UserIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
  </svg>
);

const LogoutIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
  </svg>
);

function humanRole(role: string | null | undefined): string {
  if (!role) return '';
  if (role === 'super-admin') return 'Super admin';
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export function UserMenu() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const initial = user?.name?.trim().charAt(0).toUpperCase() || 'U';
  const name = user?.name || 'User';
  const email = user?.email || '';

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-brand hover:bg-theme-hover transition-colors"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Open user menu"
      >
        <div className="w-8 h-8 rounded-full bg-cobalt/20 flex items-center justify-center">
          <span className="text-cobalt font-medium text-sm">{initial}</span>
        </div>
        <span className="hidden sm:block text-theme-primary text-sm font-medium max-w-[10rem] truncate">
          {name}
        </span>
      </button>

      {open && (
        <div
          className="absolute right-0 mt-2 w-64 rounded-brand border border-theme bg-theme-card shadow-xl z-50 overflow-hidden"
          role="menu"
          onClick={() => setOpen(false)}
        >
          {/* Header — name/email/role */}
          <div className="px-4 py-3 border-b border-theme">
            <div className="text-sm font-semibold text-theme-primary truncate">
              {name}
            </div>
            {email && (
              <div className="text-xs text-theme-tertiary truncate mt-0.5">
                {email}
              </div>
            )}
            {user?.role && (
              <div className="inline-block mt-2 px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wider bg-brand/10 text-brand border border-brand/30">
                {humanRole(user.role)}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="py-1">
            <Link
              to="/account"
              role="menuitem"
              className="flex items-center gap-2 px-4 py-2 text-sm text-theme-primary hover:bg-theme-hover"
            >
              <UserIcon />
              <span>Account settings</span>
            </Link>
          </div>

          <div className="border-t border-theme py-1">
            <LogoutButton
              variant="ghost"
              size="sm"
              onLogout={() => {
                if (import.meta.env.VITE_DEMO_MODE === 'true') {
                  window.location.href = import.meta.env.BASE_URL || '/';
                } else {
                  window.location.href = '/';
                }
              }}
              className="w-full !justify-start gap-2 !px-4 !py-2 !text-sm !text-theme-primary hover:!bg-theme-hover !rounded-none"
            >
              <LogoutIcon />
              <span>Sign out</span>
            </LogoutButton>
          </div>
        </div>
      )}
    </div>
  );
}
