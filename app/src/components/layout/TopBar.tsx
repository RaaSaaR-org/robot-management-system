/**
 * @file TopBar.tsx
 * @description The app's top bar: matte canvas ground, hairline bottom edge,
 *              56px tall and sticky. Left: the sidebar toggle (md+) or the
 *              drawer button (mobile) and the logo. Right: organization
 *              switcher, theme toggle and user menu.
 * @feature layout
 */

import { Moon, PanelLeftClose, PanelLeftOpen, Sun } from 'lucide-react';
import { Logo } from '@/components/common/Logo';
import { useThemeStore } from '@/features/settings';
import { useUIStore } from '@/features/settings/store/uiStore';
import { Button } from '@/shared/components/ui/Button';
import { MenuButton } from '@/shared/components/ui/MenuButton';
import { useMediaQuery } from '@/shared/hooks/useMediaQuery';
import { cn } from '@/shared/utils/cn';
import { logoFocusRing } from './NavList';
import { OrganizationSwitcher } from './OrganizationSwitcher';
import { UserMenu } from './UserMenu';

// ============================================================================
// COMPONENT
// ============================================================================

export function TopBar() {
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);

  const mobileMenuOpen = useUIStore((state) => state.mobileMenuOpen);
  const toggleMobileMenu = useUIStore((state) => state.toggleMobileMenu);
  const sidebarCollapsed = useUIStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useUIStore((state) => state.toggleSidebar);

  // Resolve the theme actually applied: 'system' follows the OS preference
  // (same media query ThemeProvider uses), so the toggle's icon and label
  // reflect what the user sees — not the stored preference.
  const systemPrefersDark = useMediaQuery('(prefers-color-scheme: dark)');
  const isDark = theme === 'system' ? systemPrefersDark : theme === 'dark';
  const themeLabel = isDark ? 'Switch to light mode' : 'Switch to dark mode';
  const sidebarLabel = sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar';
  const SidebarIcon = sidebarCollapsed ? PanelLeftOpen : PanelLeftClose;

  return (
    <header className="sticky top-0 z-40 h-14 border-b border-line-subtle bg-canvas">
      <div className="flex h-full items-center justify-between gap-3 px-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <div className="md:hidden">
            <MenuButton isOpen={mobileMenuOpen} onClick={toggleMobileMenu} label="Toggle navigation menu" />
          </div>
          <Button
            variant="ghost"
            iconOnly
            onClick={toggleSidebar}
            className="hidden md:inline-flex"
            title={sidebarLabel}
            aria-label={sidebarLabel}
            aria-expanded={!sidebarCollapsed}
          >
            <SidebarIcon className="h-5 w-5" strokeWidth={1.75} />
          </Button>
          {/* Logo is shared with the landing page, so the app's focus ring is
              applied from here rather than inside it. */}
          <div className={cn('pl-1', logoFocusRing)}>
            <Logo size="sm" linkTo="/dashboard" />
          </div>
        </div>

        <div className="flex items-center gap-1 sm:gap-2">
          {/* Only rendered when multi-tenancy is on */}
          <OrganizationSwitcher />
          <Button
            variant="ghost"
            iconOnly
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
            title={themeLabel}
            aria-label={themeLabel}
          >
            {isDark ? <Sun className="h-5 w-5" strokeWidth={1.75} /> : <Moon className="h-5 w-5" strokeWidth={1.75} />}
          </Button>
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
