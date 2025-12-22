/**
 * @file LogoutButton.tsx
 * @description Button component for logging out the current user
 * @feature auth
 * @dependencies @/shared/components/ui, @/features/auth/hooks
 * @stateAccess useAuth (write)
 */

import { useCallback } from 'react';
import { Button, type ButtonProps } from '@/shared/components/ui';
import { useAuth } from '../hooks/useAuth';

// ============================================================================
// TYPES
// ============================================================================

export interface LogoutButtonProps {
  /** Button variant */
  variant?: ButtonProps['variant'];
  /** Button size */
  size?: ButtonProps['size'];
  /** Callback after logout completes */
  onLogout?: () => void;
  /** Custom button text */
  children?: React.ReactNode;
  /** Additional class names */
  className?: string;
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Button that logs out the current user when clicked.
 * Clears tokens and auth state.
 *
 * @example
 * ```tsx
 * function Header() {
 *   const navigate = useNavigate();
 *   return (
 *     <LogoutButton
 *       variant="ghost"
 *       onLogout={() => navigate('/login')}
 *     >
 *       Sign out
 *     </LogoutButton>
 *   );
 * }
 * ```
 */
export function LogoutButton({
  variant = 'ghost',
  size = 'md',
  onLogout,
  children = 'Sign out',
  className,
}: LogoutButtonProps) {
  const { logout } = useAuth();

  const handleLogout = useCallback(() => {
    logout();
    onLogout?.();
  }, [logout, onLogout]);

  return (
    <Button
      variant={variant}
      size={size}
      onClick={handleLogout}
      className={className}
    >
      {children}
    </Button>
  );
}
