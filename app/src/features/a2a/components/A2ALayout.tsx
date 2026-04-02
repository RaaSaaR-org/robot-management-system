/**
 * @file A2ALayout.tsx
 * @description Layout wrapper for A2A feature with responsive navigation
 * @feature a2a
 */

import { memo, useState, useCallback, type ReactNode } from 'react';
import { cn } from '@/shared/utils/cn';
import { useIsMobile } from '@/shared/hooks/useMediaQuery';
import { useA2AStore } from '../store';
import { A2ASideNav } from './A2ASideNav';
import { A2ABottomNav } from './A2ABottomNav';

// ============================================================================
// TYPES
// ============================================================================

export interface A2ALayoutProps {
  /** Page content */
  children: ReactNode;
  /** Additional class names for the content area */
  className?: string;
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Layout wrapper for all A2A feature pages.
 * Provides responsive navigation (side nav on desktop, bottom nav on mobile).
 */
export const A2ALayout = memo(function A2ALayout({ children, className }: A2ALayoutProps) {
  const isMobile = useIsMobile();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // Get state from store
  const tasks = useA2AStore((state) => state.tasks);
  const registeredAgents = useA2AStore((state) => state.registeredAgents);

  // Compute active tasks count
  const activeTasksCount = tasks.filter(
    (t) => !['completed', 'failed', 'canceled'].includes(t.status.state)
  ).length;

  const handleToggleCollapse = useCallback(() => {
    setSidebarCollapsed((prev) => !prev);
  }, []);


  return (
    <div className="flex h-full overflow-hidden">
      {/* Desktop Side Navigation */}
      {!isMobile && (
        <A2ASideNav
          collapsed={sidebarCollapsed}
          onToggleCollapse={handleToggleCollapse}
          activeTasksCount={activeTasksCount}
          agentsCount={registeredAgents.length}
        />
      )}

      {/* Main Content Area */}
      <main
        className={cn(
          'flex-1 flex flex-col overflow-hidden',
          // Add bottom padding on mobile for bottom nav
          isMobile && 'pb-16',
          className
        )}
      >
        {children}
      </main>

      {/* Mobile Bottom Navigation */}
      {isMobile && (
        <A2ABottomNav
          activeTasksCount={activeTasksCount}
          agentsCount={registeredAgents.length}
        />
      )}

    </div>
  );
});
