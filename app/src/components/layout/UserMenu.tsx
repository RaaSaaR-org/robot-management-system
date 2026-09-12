/**
 * @file UserMenu.tsx
 * @description Top bar user menu — the avatar opens a menu with the current
 *              user's identity, links to the account and settings pages, and
 *              sign out. Settings moved here from the sidebar in TASK-279: it
 *              is about the person using the app, like everything else in this
 *              menu, not a place in the fleet.
 * @feature layout
 */

import { Link } from 'react-router-dom';
import { ChevronDown, LogOut, Settings, UserRound } from 'lucide-react';
import { useAuth } from '@/features/auth';
import { Badge } from '@/shared/components/ui/Badge';
import { focusRing } from '@/shared/components/ui/styles';
import { cn } from '@/shared/utils/cn';
import { topBarMenuItem, topBarMenuPanel, useTopBarMenu } from './useTopBarMenu';

function humanRole(role: string | null | undefined): string {
  if (!role) return '';
  if (role === 'super-admin') return 'Super admin';
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export function UserMenu() {
  const { user, logout } = useAuth();
  const menu = useTopBarMenu();

  const initial = user?.name?.trim().charAt(0).toUpperCase() || 'U';
  const name = user?.name || 'User';
  const email = user?.email || '';

  const signOut = () => {
    logout();
    window.location.href =
      import.meta.env.VITE_DEMO_MODE === 'true' ? import.meta.env.BASE_URL || '/' : '/';
  };

  return (
    <div className="relative" ref={menu.rootRef}>
      <button
        ref={menu.triggerRef}
        type="button"
        onClick={menu.toggle}
        className={cn(
          'flex h-9 items-center gap-2 rounded-control pl-1 pr-1 sm:pr-2 transition-colors duration-150 hover:bg-raised',
          focusRing,
        )}
        aria-haspopup="menu"
        aria-expanded={menu.open}
        aria-label="Open user menu"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/15 text-[13px] font-semibold text-primary">
          {initial}
        </span>
        <span className="hidden max-w-[10rem] truncate text-sm font-medium text-ink-primary sm:block">{name}</span>
        <ChevronDown className="hidden h-4 w-4 text-ink-muted sm:block" strokeWidth={1.75} aria-hidden="true" />
      </button>

      {menu.open && (
        <div
          ref={menu.menuRef}
          role="menu"
          aria-label="User menu"
          onKeyDown={menu.onMenuKeyDown}
          className={cn(topBarMenuPanel, 'w-64')}
        >
          <div className="border-b border-line-subtle px-3.5 py-3">
            <div className="truncate text-sm font-medium text-ink-primary">{name}</div>
            {email && <div className="mt-0.5 truncate text-xs text-ink-tertiary">{email}</div>}
            {user?.role && (
              <Badge variant="accent" size="sm" className="mt-2">
                {humanRole(user.role)}
              </Badge>
            )}
          </div>

          <div className="p-1">
            <Link
              to="/account"
              role="menuitem"
              tabIndex={-1}
              onClick={() => menu.close(false)}
              className={cn(topBarMenuItem, 'h-9')}
            >
              <UserRound strokeWidth={1.75} aria-hidden="true" />
              <span>Account settings</span>
            </Link>
            <Link
              to="/settings"
              role="menuitem"
              tabIndex={-1}
              onClick={() => menu.close(false)}
              className={cn(topBarMenuItem, 'h-9')}
            >
              <Settings strokeWidth={1.75} aria-hidden="true" />
              <span>Settings</span>
            </Link>
          </div>

          <div className="border-t border-line-subtle p-1">
            <button type="button" role="menuitem" tabIndex={-1} onClick={signOut} className={cn(topBarMenuItem, 'h-9')}>
              <LogOut strokeWidth={1.75} aria-hidden="true" />
              <span>Sign out</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
