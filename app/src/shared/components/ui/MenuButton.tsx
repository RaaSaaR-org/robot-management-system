/**
 * @file MenuButton.tsx
 * @description Animated hamburger menu button for mobile navigation
 * @feature shared
 * @dependencies shared/utils/cn
 */

import { cn } from '@/shared/utils/cn';
import { focusRing } from './styles';

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

/**
 * Hamburger button that turns into an X when open.
 *
 * @example
 * ```tsx
 * <MenuButton isOpen={menuOpen} onClick={() => setMenuOpen(!menuOpen)} label="Toggle menu" />
 * ```
 */
export function MenuButton({ isOpen, onClick, className, label = 'Toggle navigation menu' }: MenuButtonProps) {
  const line = 'h-0.5 w-full rounded-full bg-current transition-all duration-200 ease-[var(--ease-instrument)]';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-expanded={isOpen}
      className={cn(
        'relative flex h-10 w-10 items-center justify-center rounded-control',
        'text-ink-secondary transition-colors duration-150 hover:bg-raised hover:text-ink-primary',
        focusRing,
        className,
      )}
    >
      <div className="flex h-4 w-5 flex-col justify-between">
        <span className={cn(line, isOpen && 'translate-y-1.5 rotate-45')} />
        <span className={cn(line, isOpen && 'scale-x-0 opacity-0')} />
        <span className={cn(line, isOpen && '-translate-y-1.5 -rotate-45')} />
      </div>
    </button>
  );
}
