/**
 * @file Sidebar.tsx
 * @description Desktop sidebar (≥768px): a matte column on the inset ground
 *              with a hairline right edge. Expanded it shows the six groups
 *              under static eyebrows; collapsed it is a 64px icon rail with
 *              tooltips. The column stretches the full page height so its
 *              ground never ends mid-page; the list inside sticks under the
 *              top bar and scrolls on its own.
 * @feature layout
 */

import { cn } from '@/shared/utils/cn';
import { useUIStore } from '@/features/settings/store/uiStore';
import { NavList } from './NavList';
import { useVisibleNavGroups } from './navigation';

// ============================================================================
// TYPES
// ============================================================================

export interface SidebarProps {
  className?: string;
}

// ============================================================================
// COMPONENT
// ============================================================================

export function Sidebar({ className }: SidebarProps) {
  const collapsed = useUIStore((state) => state.sidebarCollapsed);
  const groups = useVisibleNavGroups();

  return (
    <aside
      data-collapsed={collapsed || undefined}
      className={cn(
        'hidden md:block shrink-0 bg-inset border-r border-line-subtle',
        'transition-[width] duration-150 ease-[var(--ease-instrument)]',
        collapsed ? 'w-16' : 'w-56',
        className,
      )}
    >
      <nav
        aria-label="Main navigation"
        className="sticky top-14 max-h-[calc(100dvh-3.5rem)] overflow-y-auto overscroll-contain px-3 py-5"
      >
        <NavList groups={groups} variant={collapsed ? 'rail' : 'expanded'} />
      </nav>
    </aside>
  );
}
