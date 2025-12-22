/**
 * @file TopBar.tsx
 * @description Top navigation bar with mobile menu and sidebar toggle
 * @feature layout
 * @dependencies @/components/common/Logo, @/features/auth, @/features/settings, @/shared/components/ui/MenuButton
 */

import { Logo } from '@/components/common/Logo';
import { useAuth, LogoutButton } from '@/features/auth';
import { useThemeStore } from '@/features/settings';
import { useUIStore } from '@/features/settings/store/uiStore';
import { MenuButton } from '@/shared/components/ui/MenuButton';

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

const LogoutIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
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
  const { user } = useAuth();
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);

  // UI state for sidebar and mobile menu
  const mobileMenuOpen = useUIStore((state) => state.mobileMenuOpen);
  const toggleMobileMenu = useUIStore((state) => state.toggleMobileMenu);
  const sidebarCollapsed = useUIStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useUIStore((state) => state.toggleSidebar);

  // Toggle between light and dark
  const toggleTheme = () => {
    setTheme(theme === 'light' ? 'dark' : 'light');
  };

  // Show sun in dark mode (click to go light), moon in light mode (click to go dark)
  const isDark = theme === 'dark' || theme === 'system';

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

        {/* Right section: Theme toggle + User menu */}
        <div className="flex items-center gap-2">
          {/* Theme Toggle */}
          <button
            onClick={toggleTheme}
            className="p-2 rounded-brand text-theme-secondary hover:text-theme-primary hover:bg-theme-hover transition-colors"
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {isDark ? <SunIcon /> : <MoonIcon />}
          </button>

          <div className="flex items-center gap-3 ml-2">
            {/* Avatar */}
            <div className="w-8 h-8 rounded-full bg-cobalt/20 flex items-center justify-center">
              <span className="text-cobalt font-medium text-sm">
                {user?.name?.charAt(0).toUpperCase() || 'U'}
              </span>
            </div>
            {/* Name - hidden on small screens */}
            <span className="text-theme-primary font-medium hidden sm:block">
              {user?.name || 'User'}
            </span>
          </div>

          <LogoutButton
            variant="ghost"
            size="sm"
            onLogout={() => window.location.href = '/'}
          >
            <LogoutIcon />
          </LogoutButton>
        </div>
      </div>
    </header>
  );
}
