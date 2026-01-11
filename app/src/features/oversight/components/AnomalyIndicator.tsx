/**
 * @file AnomalyIndicator.tsx
 * @description Visual indicator for anomaly alerts
 * @feature oversight
 */

import { AlertTriangle, AlertCircle, Info, XCircle } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import type { AnomalySeverity } from '../types';

// ============================================================================
// TYPES
// ============================================================================

export interface AnomalyIndicatorProps {
  severity: AnomalySeverity;
  count?: number;
  label?: string;
  size?: 'sm' | 'md' | 'lg';
  pulse?: boolean;
  className?: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const SEVERITY_STYLES: Record<AnomalySeverity, { bg: string; text: string; icon: typeof AlertCircle }> = {
  critical: {
    bg: 'bg-red-100 dark:bg-red-900/30',
    text: 'text-red-700 dark:text-red-400',
    icon: XCircle,
  },
  high: {
    bg: 'bg-orange-100 dark:bg-orange-900/30',
    text: 'text-orange-700 dark:text-orange-400',
    icon: AlertTriangle,
  },
  medium: {
    bg: 'bg-yellow-100 dark:bg-yellow-900/30',
    text: 'text-yellow-700 dark:text-yellow-400',
    icon: AlertCircle,
  },
  low: {
    bg: 'bg-blue-100 dark:bg-blue-900/30',
    text: 'text-blue-700 dark:text-blue-400',
    icon: Info,
  },
};

const SIZE_STYLES = {
  sm: { container: 'px-2 py-1 text-xs gap-1', icon: 'h-3 w-3' },
  md: { container: 'px-3 py-1.5 text-sm gap-1.5', icon: 'h-4 w-4' },
  lg: { container: 'px-4 py-2 text-base gap-2', icon: 'h-5 w-5' },
};

// ============================================================================
// COMPONENT
// ============================================================================

export function AnomalyIndicator({
  severity,
  count,
  label,
  size = 'md',
  pulse = false,
  className,
}: AnomalyIndicatorProps) {
  const styles = SEVERITY_STYLES[severity];
  const sizeStyles = SIZE_STYLES[size];
  const Icon = styles.icon;

  return (
    <div
      className={cn(
        'inline-flex items-center rounded-full font-medium',
        styles.bg,
        styles.text,
        sizeStyles.container,
        pulse && severity === 'critical' && 'animate-pulse',
        className
      )}
    >
      <Icon className={sizeStyles.icon} />
      {count !== undefined && <span className="font-bold">{count}</span>}
      {label && <span>{label}</span>}
    </div>
  );
}
