/**
 * @file PageLoader.tsx
 * @description Full-page loading indicator for lazy-loaded routes
 * @feature shared
 * @dependencies shared/components/ui/Spinner
 */

import { Spinner } from './Spinner';
import { cn } from '@/shared/utils/cn';

// ============================================================================
// TYPES
// ============================================================================

export interface PageLoaderProps {
  /** Custom message to display */
  message?: string;
  /** Additional class names */
  className?: string;
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Full-page loading indicator used as Suspense fallback for lazy-loaded routes.
 *
 * @example
 * ```tsx
 * <Suspense fallback={<PageLoader />}>
 *   <LazyRoute />
 * </Suspense>
 * ```
 */
export function PageLoader({ message, className }: PageLoaderProps) {
  return (
    <div
      className={cn(
        'flex min-h-[50vh] flex-col items-center justify-center gap-4',
        'bg-theme-primary',
        className
      )}
    >
      <Spinner size="lg" color="cobalt" label={message || 'Loading page...'} />
      {message && (
        <p className="text-sm text-theme-tertiary animate-pulse">{message}</p>
      )}
    </div>
  );
}
