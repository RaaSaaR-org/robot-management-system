/**
 * @file PageLoader.tsx
 * @description Full-page loading indicator for lazy-loaded routes
 * @feature shared
 * @dependencies shared/components/ui/Spinner
 */

import { Spinner } from './Spinner';
import { cn } from '@/shared/utils/cn';

export interface PageLoaderProps {
  /** Custom message to display */
  message?: string;
  /** Additional class names */
  className?: string;
}

/**
 * Suspense fallback for lazy routes.
 *
 * @example
 * ```tsx
 * <Suspense fallback={<PageLoader />}><LazyRoute /></Suspense>
 * ```
 */
export function PageLoader({ message, className }: PageLoaderProps) {
  return (
    <div className={cn('flex min-h-[50vh] flex-col items-center justify-center gap-4', className)}>
      <Spinner size="lg" color="primary" label={message || 'Loading page...'} />
      {message && <p className="text-sm text-ink-tertiary">{message}</p>}
    </div>
  );
}
