/**
 * @file RobotErrorBanner.tsx
 * @description Compact, deduplicated banner for robot errors, warnings, and
 *              maintenance notices. Telemetry streams often repeat the same
 *              message every tick, so each severity collapses to a single line
 *              ("Critical battery level +13 more") that expands to the full
 *              unique list on demand — keeping the top of the detail page calm.
 * @feature robots
 */

import { useState } from 'react';
import { cn } from '@/shared/utils';
import type { Robot, RobotTelemetry } from '../types/robots.types';

// ============================================================================
// TYPES
// ============================================================================

export interface RobotErrorBannerProps {
  /** Robot data */
  robot: Robot;
  /** Telemetry data with errors/warnings */
  telemetry: RobotTelemetry | null;
}

type Severity = 'error' | 'warning' | 'maintenance';

const SEVERITY_STYLES: Record<
  Severity,
  { wrap: string; icon: string; title: string; body: string }
> = {
  error: {
    wrap: 'border-red-500/30 bg-red-500/10',
    icon: 'text-red-400',
    title: 'text-red-400',
    body: 'text-red-300/80',
  },
  warning: {
    wrap: 'border-yellow-500/30 bg-yellow-500/10',
    icon: 'text-yellow-400',
    title: 'text-yellow-400',
    body: 'text-yellow-300/80',
  },
  maintenance: {
    wrap: 'border-orange-500/30 bg-orange-500/10',
    icon: 'text-orange-400',
    title: 'text-orange-400',
    body: 'text-orange-300/80',
  },
};

// ============================================================================
// ICONS
// ============================================================================

const WarningIcon = (
  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
  </svg>
);

const MaintenanceIcon = (
  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);

const ChevronIcon = ({ open }: { open: boolean }) => (
  <svg
    className={cn('h-4 w-4 transition-transform duration-150', open && 'rotate-180')}
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={2}
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
  </svg>
);

// ============================================================================
// HELPERS
// ============================================================================

/** Collapse a noisy message list to its unique, non-empty, trimmed entries. */
function uniqueMessages(messages?: string[]): string[] {
  if (!messages) return [];
  return [...new Set(messages.map((m) => m.trim()).filter(Boolean))];
}

// ============================================================================
// ALERT ROW
// ============================================================================

interface AlertRowProps {
  severity: Severity;
  label: string;
  items: string[];
  icon: React.ReactNode;
  mono?: boolean;
}

function AlertRow({ severity, label, items, icon, mono }: AlertRowProps) {
  const [open, setOpen] = useState(false);
  const styles = SEVERITY_STYLES[severity];
  const count = items.length;
  const extra = count - 1;
  const canExpand = count > 1;

  return (
    <div className={cn('rounded-xl border glass-subtle', styles.wrap)}>
      <button
        type="button"
        onClick={() => canExpand && setOpen((o) => !o)}
        aria-expanded={canExpand ? open : undefined}
        className={cn(
          'flex w-full items-center gap-3 px-4 py-2.5 text-left',
          canExpand && 'cursor-pointer'
        )}
      >
        <span className={cn('flex-shrink-0', styles.icon)}>{icon}</span>
        <span className={cn('flex-shrink-0 text-sm font-semibold', styles.title)}>{label}</span>
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-sm',
            styles.body,
            mono && 'font-mono'
          )}
        >
          {items[0]}
        </span>
        {extra > 0 && (
          <span className={cn('flex-shrink-0 text-xs font-medium', styles.body)}>
            +{extra} more
          </span>
        )}
        {canExpand && <span className={cn('flex-shrink-0', styles.icon)}><ChevronIcon open={open} /></span>}
      </button>

      {open && canExpand && (
        <ul className="space-y-1 px-4 pb-3 pl-11">
          {items.map((item, i) => (
            <li key={i} className={cn('text-sm', styles.body, mono && 'font-mono')}>
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ============================================================================
// COMPONENT
// ============================================================================

export function RobotErrorBanner({ robot, telemetry }: RobotErrorBannerProps) {
  const errorCode = robot.metadata?.errorCode as string | undefined;
  const errorMessage = robot.metadata?.errorMessage as string | undefined;
  const maintenanceReason = robot.metadata?.maintenanceReason as string | undefined;

  const errors = uniqueMessages([
    errorCode ? `${errorCode}${errorMessage ? `: ${errorMessage}` : ''}` : '',
    ...(telemetry?.errors ?? []),
  ]);
  const warnings = uniqueMessages(telemetry?.warnings);

  if (errors.length === 0 && warnings.length === 0 && !maintenanceReason) {
    return null;
  }

  return (
    <div className="space-y-2">
      {errors.length > 0 && (
        <AlertRow
          severity="error"
          label={errors.length === 1 ? 'Error' : `${errors.length} Errors`}
          items={errors}
          icon={WarningIcon}
          mono
        />
      )}
      {warnings.length > 0 && (
        <AlertRow
          severity="warning"
          label={warnings.length === 1 ? 'Warning' : `${warnings.length} Warnings`}
          items={warnings}
          icon={WarningIcon}
        />
      )}
      {maintenanceReason && (
        <AlertRow
          severity="maintenance"
          label="Maintenance"
          items={[maintenanceReason]}
          icon={MaintenanceIcon}
        />
      )}
    </div>
  );
}
