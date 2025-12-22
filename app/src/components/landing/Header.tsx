import { Link } from 'react-router-dom';
import { useAuth, LogoutButton } from '@/features/auth';
import { Logo } from '@/components/common/Logo';

export function Header() {
  const { isAuthenticated, user } = useAuth();

  return (
    <header className="fixed top-0 left-0 right-0 z-50 glass border-b border-theme">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Logo />

          {/* Navigation */}
          <nav className="hidden md:flex items-center gap-8">
            <a href="#features" className="text-theme-secondary hover:text-theme-primary transition-colors">
              Features
            </a>
            <a href="#safety" className="text-theme-secondary hover:text-theme-primary transition-colors">
              Safety
            </a>
            <a href="#contact" className="text-theme-secondary hover:text-theme-primary transition-colors">
              Contact
            </a>
          </nav>

          {/* Auth Buttons */}
          <div className="flex items-center gap-4">
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
              <>
                <Link
                  to="/login"
                  className="text-theme-secondary hover:text-theme-primary transition-colors hidden sm:block"
                >
                  Login
                </Link>
                <Link
                  to="/login"
                  className="bg-cobalt text-white px-4 py-2 rounded-brand font-medium hover:bg-cobalt-600 transition-colors"
                >
                  Sign Up Free
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
