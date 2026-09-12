/**
 * @file TopBar.tsx
 * @description The app's top bar: matte canvas ground, hairline bottom edge,
 *              56px tall and sticky. Left: the sidebar toggle (md+) or the
 *              drawer button (mobile) and the logo. Right: organization
 *              switcher, the ⌘K search affordance, the docs help icon, theme
 *              toggle and user menu.
 * @feature layout
 */

import { CircleHelp, Moon, PanelLeftClose, PanelLeftOpen, Search, Sun } from 'lucide-react';
import { Logo } from '@/components/common/Logo';
import { paletteShortcutLabel } from '@/components/palette';
import { useThemeStore } from '@/features/settings';
import { useUIStore } from '@/features/settings/store/uiStore';
import { LinkButton } from '@/shared/components/ui';
import { Button } from '@/shared/components/ui/Button';
import { MenuButton } from '@/shared/components/ui/MenuButton';
import { useMediaQuery } from '@/shared/hooks/useMediaQuery';
import { cn } from '@/shared/utils/cn';
import { logoFocusRing } from './NavList';
import { OrganizationSwitcher } from './OrganizationSwitcher';
import { UserMenu } from './UserMenu';

// ============================================================================
// TYPES
// ============================================================================

export interface TopBarProps {
  /** Opens the ⌘K palette. The dialog and its state belong to AppLayout. */
  onOpenPalette: () => void;
}

// ============================================================================
// COMPONENT
// ============================================================================

export function TopBar({ onOpenPalette }: TopBarProps) {
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
  // Docs left the sidebar in TASK-279: reference material is help, and help
  // belongs in the chrome — an icon, not a row competing with the fleet.
  const docsLabel = 'Docs';
  const SidebarIcon = sidebarCollapsed ? PanelLeftOpen : PanelLeftClose;
  // Thirteen rows left the sidebar in TASK-276…279, so the palette is how the
  // pages behind them are found — a shortcut nobody sees is no answer to that.
  const shortcut = paletteShortcutLabel();
  const searchLabel = 'Search pages';

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
            onClick={onOpenPalette}
            title={`${searchLabel} (${shortcut})`}
            aria-label={searchLabel}
            aria-keyshortcuts="Meta+K Control+K"
            className="px-2"
          >
            <Search className="h-5 w-5" strokeWidth={1.75} />
            {/* The hint is the whole point on a wide screen and noise on a
                phone, where there is no keyboard to press it on. */}
            <kbd className="hidden rounded-tag border border-line-subtle bg-inset px-1.5 py-0.5 font-sans text-[11px] text-ink-tertiary sm:inline">
              {shortcut}
            </kbd>
          </Button>
          <LinkButton to="/docs" variant="ghost" iconOnly title={docsLabel} aria-label={docsLabel}>
            <CircleHelp className="h-5 w-5" strokeWidth={1.75} />
          </LinkButton>
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
