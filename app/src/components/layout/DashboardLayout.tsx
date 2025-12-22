/**
 * @file DashboardLayout.tsx
 * @description Dashboard page layout with optional header
 * @feature layout
 * @dependencies @/shared/utils/cn
 */

import { ReactNode } from 'react';
import { cn } from '@/shared/utils/cn';

// ============================================================================
// TYPES
// ============================================================================

export interface DashboardLayoutProps {
  /** Page content */
  children: ReactNode;
  /** Page title */
  title?: string;
  /** Page subtitle/description */
  subtitle?: string;
  /** Action buttons or controls to display in header */
  actions?: ReactNode;
  /** Additional class names for the container */
  className?: string;
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Dashboard page layout wrapper with optional header section.
 * Used inside AppLayout to provide consistent page structure.
 *
 * @example
 * ```tsx
 * <DashboardLayout
 *   title="Fleet Dashboard"
 *   subtitle="Real-time fleet monitoring"
 *   actions={<Button onClick={refresh}>Refresh</Button>}
 * >
 *   <FleetStats />
 *   <FleetMap />
 * </DashboardLayout>
 * ```
 */
export function DashboardLayout({
  children,
  title,
  subtitle,
  actions,
  className,
}: DashboardLayoutProps) {
  const hasHeader = title || subtitle || actions;

  return (
    <div className={cn('space-y-6', className)}>
      {hasHeader && (
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            {title && (
              <h1 className="text-2xl font-bold text-theme-primary">{title}</h1>
            )}
            {subtitle && (
              <p className="text-theme-secondary mt-1">{subtitle}</p>
            )}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </div>
  );
}
