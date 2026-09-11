/**
 * @file AppLayout.tsx
 * @description The app shell: sticky top bar, the sidebar column (md+) or the
 *              mobile drawer, and the padded content column. The root carries
 *              `data-app-shell`, which switches off backdrop-filter for
 *              everything inside it and gives bare h1/h2 the display face.
 * @feature layout
 */

import { ReactNode } from 'react';
import { useUIStore } from '@/features/settings/store/uiStore';
import { useRobotWebSocket } from '@/features/robots/hooks/useRobotWebSocket';
import { AlertBanner } from '@/features/alerts/components/AlertBanner';
import { TopBar } from './TopBar';
import { Sidebar } from './Sidebar';
import { SectionRail } from './SectionRail';
import { MobileNav } from './MobileNav';
import { ImpersonationBanner } from './ImpersonationBanner';

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
 * - Mobile (< 768px): full-width content, navigation in the MobileNav drawer
 * - md+: a 224px sidebar column, or a 64px icon rail when collapsed
 *
 * @example
 * ```tsx
 * <AppLayout>
 *   <DashboardPage />
 * </AppLayout>
 * ```
 */
export function AppLayout({ children }: AppLayoutProps) {
  const mobileMenuOpen = useUIStore((state) => state.mobileMenuOpen);
  const setMobileMenuOpen = useUIStore((state) => state.setMobileMenuOpen);

  // Real-time robot updates for every page in the shell
  useRobotWebSocket();

  return (
    <div data-app-shell className="min-h-screen bg-canvas text-ink-primary">
      <TopBar />
      <div className="flex">
        <Sidebar />
        <main className="min-w-0 flex-1">
          <div className="flex flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
            <ImpersonationBanner />
            {/* In-flow alarm banner: pushes content down instead of covering it */}
            <AlertBanner />
            {/* The active row's second level, or nothing when it has no rail */}
            <SectionRail />
            {children}
          </div>
        </main>
      </div>
      <MobileNav isOpen={mobileMenuOpen} onClose={() => setMobileMenuOpen(false)} />
    </div>
  );
}
