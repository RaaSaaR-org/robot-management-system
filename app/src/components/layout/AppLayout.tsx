/**
 * @file AppLayout.tsx
 * @description Main application layout with responsive sidebar and mobile nav
 * @feature layout
 * @dependencies @/shared/utils/cn, @/features/settings/store/uiStore, @/shared/hooks/useMediaQuery
 */

import { ReactNode } from 'react';
import { cn } from '@/shared/utils/cn';
import { useUIStore } from '@/features/settings/store/uiStore';
import { useIsMobile } from '@/shared/hooks/useMediaQuery';
import { useRobotWebSocket } from '@/features/robots/hooks/useRobotWebSocket';
import { TopBar } from './TopBar';
import { Sidebar } from './Sidebar';
import { MobileNav } from './MobileNav';

// ============================================================================
// TYPES
// ============================================================================

interface AppLayoutProps {
  children: ReactNode;
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Main application layout with responsive sidebar behavior.
 *
 * - Mobile (< 768px): Full width content, MobileNav drawer
 * - Tablet+ with collapsed sidebar: pl-16 (64px)
 * - Tablet+ with expanded sidebar: pl-56 (224px)
 *
 * @example
 * ```tsx
 * <AppLayout>
 *   <DashboardPage />
 * </AppLayout>
 * ```
 */
export function AppLayout({ children }: AppLayoutProps) {
  const isMobile = useIsMobile();
  const sidebarCollapsed = useUIStore((state) => state.sidebarCollapsed);
  const mobileMenuOpen = useUIStore((state) => state.mobileMenuOpen);
  const setMobileMenuOpen = useUIStore((state) => state.setMobileMenuOpen);

  // Connect to WebSocket for real-time robot updates
  useRobotWebSocket();

  return (
    <div className="min-h-screen section-primary">
      <TopBar />
      <Sidebar />

      {/* Mobile navigation drawer */}
      <MobileNav
        isOpen={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
      />

      <main
        className={cn(
          'pt-14 transition-[padding] duration-200 ease-in-out',
          // On mobile: no left padding (sidebar hidden)
          // On tablet+: dynamic left padding based on sidebar state
          isMobile
            ? 'pl-0'
            : sidebarCollapsed
              ? 'md:pl-16'
              : 'md:pl-56'
        )}
      >
        <div className="p-6">
          {children}
        </div>
      </main>
    </div>
  );
}
