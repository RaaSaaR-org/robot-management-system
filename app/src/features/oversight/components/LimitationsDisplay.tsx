/**
 * @file LimitationsDisplay.tsx
 * @description Display robot limitations per EU AI Act Art. 14(4)(a)
 * @feature oversight
 */

import { AlertTriangle, AlertCircle, XCircle, Info } from 'lucide-react';
import { cn } from '@/shared/utils/cn';

// ============================================================================
// TYPES
// ============================================================================

export interface LimitationsDisplayProps {
  limitations: string[];
  warnings: string[];
  errors: string[];
  className?: string;
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

interface LimitationItemProps {
  type: 'limitation' | 'warning' | 'error';
  message: string;
}

function LimitationItem({ type, message }: LimitationItemProps) {
  const styles = {
    limitation: {
      bg: 'bg-blue-50 dark:bg-blue-900/20',
      border: 'border-blue-200 dark:border-blue-800',
      text: 'text-blue-700 dark:text-blue-400',
      icon: Info,
    },
    warning: {
      bg: 'bg-yellow-50 dark:bg-yellow-900/20',
      border: 'border-yellow-200 dark:border-yellow-800',
      text: 'text-yellow-700 dark:text-yellow-400',
      icon: AlertTriangle,
    },
    error: {
      bg: 'bg-red-50 dark:bg-red-900/20',
      border: 'border-red-200 dark:border-red-800',
      text: 'text-red-700 dark:text-red-400',
      icon: XCircle,
    },
  };

  const style = styles[type];
  const Icon = style.icon;

  return (
    <div
      className={cn(
        'flex items-start gap-2 p-2 rounded-md border',
        style.bg,
        style.border
      )}
    >
      <Icon className={cn('h-4 w-4 mt-0.5 flex-shrink-0', style.text)} />
      <span className={cn('text-sm', style.text)}>{message}</span>
    </div>
  );
}

// ============================================================================
// COMPONENT
// ============================================================================

export function LimitationsDisplay({
  limitations,
  warnings,
  errors,
  className,
}: LimitationsDisplayProps) {
  const hasContent = limitations.length > 0 || warnings.length > 0 || errors.length > 0;

  if (!hasContent) {
    return null;
  }

  return (
    <div className={cn('space-y-4', className)}>
      <div className="flex items-center gap-2">
        <AlertCircle className="h-5 w-5 text-theme-muted" />
        <h3 className="font-semibold text-theme-primary">
          Limitations & Issues
          <span className="text-xs font-normal text-theme-muted ml-2">
            (Art. 14(4)(a))
          </span>
        </h3>
      </div>

      <div className="space-y-2">
        {/* Errors first (most critical) */}
        {errors.map((error, i) => (
          <LimitationItem key={`error-${i}`} type="error" message={error} />
        ))}

        {/* Warnings second */}
        {warnings.map((warning, i) => (
          <LimitationItem key={`warning-${i}`} type="warning" message={warning} />
        ))}

        {/* Limitations last (informational) */}
        {limitations.map((limitation, i) => (
          <LimitationItem key={`limitation-${i}`} type="limitation" message={limitation} />
        ))}
      </div>

      {/* Summary counts */}
      <div className="flex gap-4 text-xs text-theme-muted pt-2 border-t border-theme-subtle">
        {errors.length > 0 && (
          <span className="flex items-center gap-1">
            <XCircle className="h-3 w-3 text-red-500" />
            {errors.length} error{errors.length !== 1 ? 's' : ''}
          </span>
        )}
        {warnings.length > 0 && (
          <span className="flex items-center gap-1">
            <AlertTriangle className="h-3 w-3 text-yellow-500" />
            {warnings.length} warning{warnings.length !== 1 ? 's' : ''}
          </span>
        )}
        {limitations.length > 0 && (
          <span className="flex items-center gap-1">
            <Info className="h-3 w-3 text-blue-500" />
            {limitations.length} limitation{limitations.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
    </div>
  );
}
