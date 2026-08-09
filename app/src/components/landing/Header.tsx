/**
 * @file Header.tsx
 * @description Fixed landing chrome — matte bar, legend-voice nav, theme control, mobile menu.
 * @feature landing
 */

import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { Logo } from '@/components/common/Logo';
import { useThemeStore, type ThemeMode } from '@/features/settings/store/themeStore';
import { scrollToSection } from './scrollToSection';

const GITHUB_URL = 'https://github.com/RaaSaaR-org/robot-management-system';

/** Anchors here must match the section ids on the landing page. */
const NAV_ITEMS: ReadonlyArray<{ label: string; href: string }> = [
  { label: 'Proof', href: '#proof' },
  { label: 'Lifecycle', href: '#lifecycle' },
  { label: 'Safety', href: '#safety' },
  { label: 'Sovereignty', href: '#sovereignty' },
  { label: 'Install', href: '#install' },
];

/**
 * Flat, matte bar. Glass is the product's language; the page is an instrument
 * panel, so the chrome is a solid surface with a hairline rule under it.
 *
 * Fully opaque, not 92%: at 92% with no backdrop blur the page scrolled visibly
 * through the bar, and on mobile the hero readout's rows showed through the open
 * menu behind the nav labels. Matte means matte.
 */
const SURFACE: CSSProperties = {
  backgroundColor: 'var(--bg-primary)',
  borderBottom: '1px solid var(--border-color)',
};

/** themeStore.cycleTheme() goes system → light → dark → system. */
const THEME_NAME: Record<ThemeMode, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
};

const THEME_ACTION: Record<ThemeMode, string> = {
  system: 'Switch theme to light',
  light: 'Switch theme to dark',
  dark: 'Switch theme to system',
};

const LINK_BASE =
  'lp-key rounded text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] focus:outline-none focus-visible:ring-2';

const DESKTOP_LINK = `${LINK_BASE} flex h-16 items-center`;

const MOBILE_LINK = `${LINK_BASE} flex min-h-[44px] items-center gap-2 px-3 hover:bg-[var(--bg-secondary)]`;

function GitHubMark({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
      />
    </svg>
  );
}

function ThemeIcon({ mode, className }: { mode: ThemeMode; className?: string }) {
  if (mode === 'light') {
    return (
      <svg
        className={className}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="4" />
        <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4" />
      </svg>
    );
  }

  if (mode === 'dark') {
    return (
      <svg
        className={className}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path d="M20 14.4A8.4 8.4 0 019.6 4a8.4 8.4 0 1010.4 10.4z" />
      </svg>
    );
  }

  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="12" rx="1.5" />
      <path d="M9 20h6M12 16v4" />
    </svg>
  );
}

export function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const theme = useThemeStore((state) => state.theme);
  const cycleTheme = useThemeStore((state) => state.cycleTheme);

  const closeMenu = () => setMobileMenuOpen(false);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileMenuOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [mobileMenuOpen]);

  return (
    <header className="fixed top-0 left-0 right-0 z-50" style={SURFACE}>
      <div className="lp-container">
        <div className="flex h-16 items-center justify-between gap-4">
          <Logo />

          {/* Desktop navigation — the legend rail's voice, repeated in the chrome. */}
          <nav className="hidden items-center gap-x-6 lg:flex xl:gap-x-8" aria-label="Landing page sections">
            {NAV_ITEMS.map((item) => (
              <a
                key={item.href}
                href={item.href}
                onClick={(event) => scrollToSection(event, item.href)}
                className={DESKTOP_LINK}
              >
                {item.label}
              </a>
            ))}
            {/* Route, not an anchor — the in-app docs are otherwise unreachable
                from the landing page. */}
            <Link to="/docs" className={DESKTOP_LINK}>
              Docs
            </Link>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={`${DESKTOP_LINK} gap-1.5`}
            >
              <GitHubMark className="h-4 w-4" />
              GitHub
            </a>
          </nav>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={cycleTheme}
              className="flex h-11 w-11 items-center justify-center rounded-lg text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] focus:outline-none focus-visible:ring-2"
              aria-label={THEME_ACTION[theme]}
              title={THEME_ACTION[theme]}
            >
              <ThemeIcon mode={theme} className="h-5 w-5" />
            </button>

            <Link
              to="/dashboard"
              className="lp-btn-primary hidden h-11 items-center px-4 text-sm focus:outline-none focus-visible:ring-2 sm:inline-flex"
            >
              Open App
            </Link>

            {/* Hamburger (below lg) */}
            <button
              type="button"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="flex h-11 w-11 items-center justify-center rounded-lg text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] focus:outline-none focus-visible:ring-2 lg:hidden"
              aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={mobileMenuOpen}
              aria-controls="landing-mobile-nav"
            >
              {mobileMenuOpen ? (
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile navigation */}
      <div
        id="landing-mobile-nav"
        style={SURFACE}
        className={`absolute inset-x-0 top-16 z-50 transition-opacity duration-200 lg:hidden ${
          mobileMenuOpen ? 'visible opacity-100' : 'invisible opacity-0'
        }`}
      >
        <nav className="lp-container flex flex-col gap-1 py-4" aria-label="Landing page sections">
          {NAV_ITEMS.map((item) => (
            <a
              key={item.href}
              href={item.href}
              onClick={(event) => {
                closeMenu();
                scrollToSection(event, item.href);
              }}
              className={MOBILE_LINK}
            >
              {item.label}
            </a>
          ))}

          <Link to="/docs" onClick={closeMenu} className={MOBILE_LINK}>
            Docs
          </Link>

          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={closeMenu}
            className={MOBILE_LINK}
          >
            <GitHubMark className="h-4 w-4" />
            GitHub
          </a>

          <button
            type="button"
            onClick={cycleTheme}
            className={`${MOBILE_LINK} w-full justify-between text-left`}
            aria-label={THEME_ACTION[theme]}
          >
            <span className="flex items-center gap-2">
              <ThemeIcon mode={theme} className="h-4 w-4" />
              Theme
            </span>
            <span className="lp-value">{THEME_NAME[theme]}</span>
          </button>

          <div className="mt-2 border-t pt-2" style={{ borderColor: 'var(--border-color)' }}>
            <Link
              to="/dashboard"
              onClick={closeMenu}
              className="lp-btn-primary flex min-h-[44px] items-center justify-center text-sm focus:outline-none focus-visible:ring-2"
            >
              Open App
            </Link>
          </div>
        </nav>
      </div>
    </header>
  );
}
