/**
 * @file TopBar.tsx
 * @description Top navigation bar with mobile menu and sidebar toggle
 * @feature layout
 * @dependencies @/components/common/Logo, @/features/auth, @/features/settings, @/shared/components/ui/MenuButton, @/shared/hooks/useMediaQuery
 */

import { Logo } from '@/components/common/Logo';
import { useThemeStore } from '@/features/settings';
import { useUIStore } from '@/features/settings/store/uiStore';
import { MenuButton } from '@/shared/components/ui/MenuButton';
import { useMediaQuery } from '@/shared/hooks/useMediaQuery';
import { OrganizationSwitcher } from './OrganizationSwitcher';
import { UserMenu } from './UserMenu';

// ============================================================================
// ICONS
// ============================================================================

const SunIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
  </svg>
);

const MoonIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
  </svg>
);

const CollapseIcon = ({ collapsed }: { collapsed: boolean }) => (
  <svg
    className={`w-5 h-5 transition-transform duration-200 ${collapsed ? 'rotate-180' : ''}`}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
  </svg>
);

// ============================================================================
// COMPONENT
// ============================================================================

export function TopBar() {
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);

  // UI state for sidebar and mobile menu
  const mobileMenuOpen = useUIStore((state) => state.mobileMenuOpen);
  const toggleMobileMenu = useUIStore((state) => state.toggleMobileMenu);
  const sidebarCollapsed = useUIStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useUIStore((state) => state.toggleSidebar);

  // Resolve the theme actually applied: 'system' follows the OS preference
  // (same media query ThemeProvider uses), so the toggle's icon/label always
  // reflect what the user currently sees — not the stored preference.
  const systemPrefersDark = useMediaQuery('(prefers-color-scheme: dark)');
  const isDark = theme === 'system' ? systemPrefersDark : theme === 'dark';

  // Toggle away from the currently resolved theme
  const toggleTheme = () => {
    setTheme(isDark ? 'light' : 'dark');
  };

  return (
    <header className="fixed top-0 left-0 right-0 h-14 glass border-b border-theme z-40">
      <div className="h-full px-4 flex items-center justify-between">
        {/* Left section: Menu button (mobile) + Logo */}
        <div className="flex items-center gap-2">
          {/* Mobile menu button - only visible on mobile */}
          <div className="md:hidden">
            <MenuButton
              isOpen={mobileMenuOpen}
              onClick={toggleMobileMenu}
              label="Toggle navigation menu"
            />
          </div>

          {/* Sidebar collapse button - only visible on tablet+ */}
          <button
            onClick={toggleSidebar}
            className="hidden md:flex p-2 rounded-brand text-theme-secondary hover:text-theme-primary hover:bg-theme-hover transition-colors"
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <CollapseIcon collapsed={sidebarCollapsed} />
          </button>

          {/* Logo */}
          <Logo size="sm" linkTo="/dashboard" />
        </div>

        {/* Right section: Organization switcher + theme + user menu */}
        <div className="flex items-center gap-2">
          {/* Organization switcher — only rendered when multi-tenancy is on */}
          <OrganizationSwitcher />

          {/* Theme Toggle */}
          <button
            onClick={toggleTheme}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-brand text-theme-secondary hover:text-theme-primary hover:bg-theme-hover transition-colors"
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {isDark ? <SunIcon /> : <MoonIcon />}
          </button>

          {/* User menu — avatar, account link, sign out */}
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
