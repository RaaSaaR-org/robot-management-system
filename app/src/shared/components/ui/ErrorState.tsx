/**
 * @file ErrorState.tsx
 * @description Shown in place of content that failed to load: "Couldn't load
 *              ‹things›", the reason, and Retry.
 * @feature shared
 */

import { AlertTriangle, RotateCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/shared/utils/cn';
import { Button } from './Button';

export interface ErrorStateProps {
  /** Headline (default "Couldn't load this") — prefer "Couldn't load ‹things›" */
  title?: ReactNode;
  /** The reason, usually the error message */
  message?: ReactNode;
  /** Shows a Retry button */
  onRetry?: () => void;
  retryLabel?: string;
  /** Vertical padding preset (default 'md') */
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeStyles: Record<NonNullable<ErrorStateProps['size']>, string> = {
  sm: 'py-8',
  md: 'py-12',
  lg: 'py-20',
};

/**
 * @example
 * ```tsx
 * if (error) return <ErrorState title="Couldn't load routes" message={error} onRetry={refetch} />;
 * ```
 */
export function ErrorState({
  title = "Couldn't load this",
  message,
  onRetry,
  retryLabel = 'Retry',
  size = 'md',
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn('flex flex-col items-center justify-center px-6 text-center', sizeStyles[size], className)}
    >
      <div
        aria-hidden="true"
        className="mb-4 flex h-10 w-10 items-center justify-center rounded-control border border-signal-stopped/30 bg-signal-stopped/10 text-signal-stopped"
      >
        <AlertTriangle className="h-5 w-5" strokeWidth={1.75} />
      </div>
      <p className="text-sm font-semibold text-ink-primary">{title}</p>
      {message && <p className="mt-1 max-w-md break-words text-[13px] leading-relaxed text-ink-tertiary">{message}</p>}
      {onRetry && (
        <Button
          variant="secondary"
          size="sm"
          className="mt-5"
          onClick={onRetry}
          leftIcon={<RotateCw className="h-3.5 w-3.5" strokeWidth={1.75} />}
        >
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
