/**
 * @file MenuButton.tsx
 * @description Animated hamburger menu button for mobile navigation
 * @feature shared
 * @dependencies shared/utils/cn
 */

import { cn } from '@/shared/utils/cn';

// ============================================================================
// TYPES
// ============================================================================

export interface MenuButtonProps {
  /** Whether the menu is currently open */
  isOpen: boolean;
  /** Click handler */
  onClick: () => void;
  /** Additional class names */
  className?: string;
  /** Accessible label */
  label?: string;
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Animated hamburger menu button that transforms into an X when open.
 *
 * @example
 * ```tsx
 * <MenuButton
 *   isOpen={menuOpen}
 *   onClick={() => setMenuOpen(!menuOpen)}
 *   label="Toggle menu"
 * />
 * ```
 */
export function MenuButton({
  isOpen,
  onClick,
  className,
  label = 'Toggle navigation menu',
}: MenuButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-expanded={isOpen}
      className={cn(
        'relative flex h-10 w-10 items-center justify-center rounded-lg',
        'text-theme-secondary hover:text-theme-primary hover:bg-theme-hover',
        'transition-colors duration-200',
        'focus:outline-none focus:ring-2 focus:ring-cobalt-500 focus:ring-offset-2',
        className
      )}
    >
      <div className="flex h-4 w-5 flex-col justify-between">
        {/* Top line */}
        <span
          className={cn(
            'h-0.5 w-full bg-current rounded-full transition-all duration-300',
            isOpen && 'translate-y-1.5 rotate-45'
          )}
        />
        {/* Middle line */}
        <span
          className={cn(
            'h-0.5 w-full bg-current rounded-full transition-all duration-300',
            isOpen && 'opacity-0 scale-x-0'
          )}
        />
        {/* Bottom line */}
        <span
          className={cn(
            'h-0.5 w-full bg-current rounded-full transition-all duration-300',
            isOpen && '-translate-y-1.5 -rotate-45'
          )}
        />
      </div>
    </button>
  );
}
