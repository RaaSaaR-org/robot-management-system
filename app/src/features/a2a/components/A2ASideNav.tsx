/**
 * @file A2ASideNav.tsx
 * @description Collapsible side navigation for A2A feature (desktop)
 * @feature a2a
 */

import { memo } from 'react';
import { NavLink } from 'react-router-dom';
import { cn } from '@/shared/utils/cn';
import { A2A_NAV_ITEMS, SettingsIcon } from './A2ANavItems';

// ============================================================================
// TYPES
// ============================================================================

export interface A2ASideNavProps {
  /** Whether the sidebar is collapsed (icon-only) */
  collapsed?: boolean;
  /** Callback when collapse toggle is clicked */
  onToggleCollapse?: () => void;
  /** Callback when settings is clicked */
  onSettingsClick?: () => void;
  /** Active tasks count for badge */
  activeTasksCount?: number;
  /** Registered agents count for badge */
  agentsCount?: number;
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Collapsible side navigation for A2A feature pages.
 * Shows on tablet and desktop (md breakpoint and above).
 */
export const A2ASideNav = memo(function A2ASideNav({
  collapsed = false,
  onToggleCollapse,
  onSettingsClick,
  activeTasksCount = 0,
  agentsCount = 0,
}: A2ASideNavProps) {
  const getBadge = (id: string): number | undefined => {
    if (id === 'tasks' && activeTasksCount > 0) return activeTasksCount;
    if (id === 'agents' && agentsCount > 0) return agentsCount;
    return undefined;
  };

  return (
    <aside
      className={cn(
        // Base styles
        'flex flex-col h-full',
        'glass-elevated border-r border-glass-subtle',
        'transition-[width] duration-200 ease-in-out',
        // Dynamic width
        collapsed ? 'w-16' : 'w-56'
      )}
    >
      {/* Collapse Toggle */}
      <div className={cn('p-3 border-b border-glass-subtle', collapsed && 'px-2')}>
        <button
          onClick={onToggleCollapse}
          className={cn(
            'flex items-center gap-2 w-full rounded-lg px-3 py-2',
            'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100',
            'hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors',
            collapsed && 'justify-center px-2'
          )}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <svg
            className={cn('w-5 h-5 shrink-0 transition-transform', !collapsed && 'rotate-180')}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
          </svg>
          {!collapsed && <span className="text-sm font-medium">A2A Studio</span>}
        </button>
      </div>

      {/* Navigation Items */}
      <nav className={cn('flex-1 p-3 space-y-1', collapsed && 'p-2')}>
        {A2A_NAV_ITEMS.map((item) => {
          const badge = getBadge(item.id);
          const Icon = item.icon;

          return (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.exact}
              title={collapsed ? item.label : undefined}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-lg transition-colors relative',
                  collapsed ? 'px-2.5 py-2.5 justify-center' : 'px-3 py-2.5',
                  isActive
                    ? 'bg-primary-500 text-white'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800'
                )
              }
            >
              <Icon className="w-5 h-5 shrink-0" />
              {!collapsed && <span className="font-medium">{item.label}</span>}
              {badge !== undefined && (
                <span
                  className={cn(
                    'flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full text-xs font-medium',
                    'bg-accent-500 text-white',
                    collapsed && 'absolute -top-1 -right-1 min-w-[1rem] h-4 text-[10px]'
                  )}
                >
                  {badge}
                </span>
              )}
            </NavLink>
          );
        })}
      </nav>

      {/* Settings Button */}
      <div className={cn('p-3 border-t border-glass-subtle', collapsed && 'p-2')}>
        <button
          onClick={onSettingsClick}
          title={collapsed ? 'Settings' : undefined}
          className={cn(
            'flex items-center gap-3 w-full rounded-lg transition-colors',
            collapsed ? 'px-2.5 py-2.5 justify-center' : 'px-3 py-2.5',
            'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100',
            'hover:bg-gray-100 dark:hover:bg-gray-800'
          )}
        >
          <SettingsIcon className="w-5 h-5 shrink-0" />
          {!collapsed && <span className="font-medium">Settings</span>}
        </button>
      </div>
    </aside>
  );
});
