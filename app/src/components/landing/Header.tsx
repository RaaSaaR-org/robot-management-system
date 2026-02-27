/**
 * @file Header.tsx
 * @description Landing page header with navigation and mobile hamburger menu
 * @feature landing
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth, LogoutButton } from '@/features/auth';
import { Logo } from '@/components/common/Logo';

export function Header() {
  const { isAuthenticated, user } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const closeMenu = () => setMobileMenuOpen(false);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 glass border-b border-theme">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Logo />

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-8">
            <a href="#features" className="text-theme-secondary hover:text-theme-primary transition-colors">
              Features
            </a>
            <a href="#safety" className="text-theme-secondary hover:text-theme-primary transition-colors">
              Safety
            </a>
            <a
              href="https://github.com/RaaSaaR-org/robot-management-system"
              target="_blank"
              rel="noopener noreferrer"
              className="text-theme-secondary hover:text-theme-primary transition-colors inline-flex items-center gap-1.5"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
              </svg>
              GitHub
            </a>
            <a href="#deploy" className="text-theme-secondary hover:text-theme-primary transition-colors">
              Deploy
            </a>
            <Link to="/docs" className="text-theme-secondary hover:text-theme-primary transition-colors">
              Docs
            </Link>
          </nav>

          {/* Auth Buttons + Mobile Toggle */}
          <div className="flex items-center gap-3">
            {isAuthenticated ? (
              <>
                <Link
                  to="/dashboard"
                  className="text-theme-secondary hover:text-theme-primary transition-colors hidden sm:block"
                >
                  {user?.name || 'Dashboard'}
                </Link>
                <LogoutButton
                  variant="ghost"
                  size="sm"
                  onLogout={() => window.location.href = '/'}
                >
                  Logout
                </LogoutButton>
              </>
            ) : (
              <Link
                to="/dashboard"
                className="bg-cobalt text-white px-4 py-2 rounded-brand font-medium hover:bg-cobalt-600 transition-colors"
              >
                Open App
              </Link>
            )}

            {/* Hamburger Toggle (mobile only) */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden flex items-center justify-center w-11 h-11 rounded-lg text-theme-secondary hover:text-theme-primary hover:bg-theme-card transition-colors"
              aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={mobileMenuOpen}
            >
              {mobileMenuOpen ? (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Navigation Dropdown */}
      <div className={`md:hidden absolute top-16 inset-x-0 glass border-b border-theme z-50 transition-all duration-200 ${mobileMenuOpen ? 'opacity-100 visible' : 'opacity-0 invisible'}`}>
        <nav className="max-w-7xl mx-auto px-4 py-4 flex flex-col gap-1">
          <a
            href="#features"
            onClick={closeMenu}
            className="flex items-center min-h-[44px] px-3 rounded-lg text-theme-secondary hover:text-theme-primary hover:bg-theme-card transition-colors"
          >
            Features
          </a>
          <a
            href="#safety"
            onClick={closeMenu}
            className="flex items-center min-h-[44px] px-3 rounded-lg text-theme-secondary hover:text-theme-primary hover:bg-theme-card transition-colors"
          >
            Safety
          </a>
          <a
            href="https://github.com/RaaSaaR-org/robot-management-system"
            target="_blank"
            rel="noopener noreferrer"
            onClick={closeMenu}
            className="flex items-center gap-1.5 min-h-[44px] px-3 rounded-lg text-theme-secondary hover:text-theme-primary hover:bg-theme-card transition-colors"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
            </svg>
            GitHub
          </a>
          <a
            href="#deploy"
            onClick={closeMenu}
            className="flex items-center min-h-[44px] px-3 rounded-lg text-theme-secondary hover:text-theme-primary hover:bg-theme-card transition-colors"
          >
            Deploy
          </a>
          <Link
            to="/docs"
            onClick={closeMenu}
            className="flex items-center min-h-[44px] px-3 rounded-lg text-theme-secondary hover:text-theme-primary hover:bg-theme-card transition-colors"
          >
            Docs
          </Link>
          <div className="mt-2 pt-2 border-t border-theme">
            <Link
              to="/dashboard"
              onClick={closeMenu}
              className="flex items-center justify-center min-h-[44px] bg-cobalt text-white rounded-brand font-medium hover:bg-cobalt-600 transition-colors"
            >
              Open App
            </Link>
          </div>
        </nav>
      </div>
    </header>
  );
}
