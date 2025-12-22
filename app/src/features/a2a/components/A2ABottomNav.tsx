/**
 * @file A2ABottomNav.tsx
 * @description Bottom tab navigation for A2A feature (mobile)
 * @feature a2a
 */

import { memo } from 'react';
import { NavLink } from 'react-router-dom';
import { cn } from '@/shared/utils/cn';
import { A2A_NAV_ITEMS } from './A2ANavItems';

// ============================================================================
// TYPES
// ============================================================================

export interface A2ABottomNavProps {
  /** Active tasks count for badge */
  activeTasksCount?: number;
  /** Registered agents count for badge */
  agentsCount?: number;
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Bottom tab navigation for A2A feature pages.
 * Shows on mobile (below md breakpoint).
 */
export const A2ABottomNav = memo(function A2ABottomNav({
  activeTasksCount = 0,
  agentsCount = 0,
}: A2ABottomNavProps) {
  const getBadge = (id: string): number | undefined => {
    if (id === 'tasks' && activeTasksCount > 0) return activeTasksCount;
    if (id === 'agents' && agentsCount > 0) return agentsCount;
    return undefined;
  };

  return (
    <nav
      className={cn(
        'fixed bottom-0 left-0 right-0 z-40',
        'flex items-stretch justify-around',
        'h-16 px-2',
        'glass-elevated border-t border-glass-subtle',
        'safe-area-bottom' // For iOS safe area
      )}
    >
      {A2A_NAV_ITEMS.map((item) => {
        const badge = getBadge(item.id);
        const Icon = item.icon;

        return (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.exact}
            className={({ isActive }) =>
              cn(
                'flex flex-col items-center justify-center gap-1 flex-1 relative',
                'min-w-[64px] min-h-[48px]', // Touch-friendly sizing
                'transition-colors',
                isActive
                  ? 'text-primary-500'
                  : 'text-gray-500 dark:text-gray-400'
              )
            }
          >
            {({ isActive }) => (
              <>
                <div className="relative">
                  <Icon className={cn('w-6 h-6', isActive && 'scale-110 transition-transform')} />
                  {badge !== undefined && (
                    <span
                      className={cn(
                        'absolute -top-1.5 -right-2',
                        'flex items-center justify-center',
                        'min-w-[1rem] h-4 px-1',
                        'rounded-full text-[10px] font-bold',
                        'bg-accent-500 text-white'
                      )}
                    >
                      {badge > 99 ? '99+' : badge}
                    </span>
                  )}
                </div>
                <span className={cn('text-[10px] font-medium', isActive && 'font-semibold')}>
                  {item.label}
                </span>
                {/* Active indicator line */}
                {isActive && (
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-primary-500 rounded-full" />
                )}
              </>
            )}
          </NavLink>
        );
      })}
    </nav>
  );
});
