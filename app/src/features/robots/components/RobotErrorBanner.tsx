/**
 * @file RobotErrorBanner.tsx
 * @description Compact, deduplicated banner for robot errors, warnings, and
 *              maintenance notices. Telemetry streams often repeat the same
 *              message every tick, so each severity collapses to a single line
 *              ("Critical battery level +13 more") that expands to the full
 *              unique list on demand — keeping the top of the detail page calm.
 * @feature robots
 */

import { useState, type ReactNode } from 'react';
import { AlertTriangle, ChevronDown, OctagonAlert, Wrench } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
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

/** Signal colors: stopped = fault, unknown = warning, estimated = maintenance. */
const SEVERITY_STYLES: Record<Severity, { wrap: string; accent: string }> = {
  error: {
    wrap: 'border-signal-stopped/30 bg-signal-stopped/10',
    accent: 'text-signal-stopped',
  },
  warning: {
    wrap: 'border-signal-unknown/30 bg-signal-unknown/10',
    accent: 'text-signal-unknown',
  },
  maintenance: {
    wrap: 'border-signal-estimated/30 bg-signal-estimated/10',
    accent: 'text-signal-estimated',
  },
};

const ICON = 'h-4 w-4';

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
  icon: ReactNode;
  /** Render items as code (error codes) */
  mono?: boolean;
}

function AlertRow({ severity, label, items, icon, mono }: AlertRowProps) {
  const [open, setOpen] = useState(false);
  const styles = SEVERITY_STYLES[severity];
  const extra = items.length - 1;
  const canExpand = items.length > 1;

  return (
    <div className={cn('rounded-control border', styles.wrap)}>
      <button
        type="button"
        onClick={() => canExpand && setOpen((o) => !o)}
        aria-expanded={canExpand ? open : undefined}
        className={cn(
          'flex w-full items-center gap-3 px-4 py-2.5 text-left',
          canExpand ? 'cursor-pointer' : 'cursor-default'
        )}
      >
        <span className={cn('shrink-0', styles.accent)}>{icon}</span>
        <span className={cn('shrink-0 text-sm font-semibold', styles.accent)}>{label}</span>
        <span className={cn('min-w-0 flex-1 truncate text-sm text-ink-secondary', mono && 'font-mono')}>
          {items[0]}
        </span>
        {extra > 0 && (
          <span className="shrink-0 text-xs font-medium text-ink-tertiary">+{extra} more</span>
        )}
        {canExpand && (
          <ChevronDown
            className={cn(ICON, 'shrink-0 transition-transform duration-150', styles.accent, open && 'rotate-180')}
            strokeWidth={1.75}
            aria-hidden="true"
          />
        )}
      </button>

      {open && canExpand && (
        <ul className="space-y-1 px-4 pb-3 pl-11">
          {items.map((item, i) => (
            <li key={i} className={cn('text-sm text-ink-secondary', mono && 'font-mono')}>
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
          icon={<OctagonAlert className={ICON} strokeWidth={1.75} />}
          mono
        />
      )}
      {warnings.length > 0 && (
        <AlertRow
          severity="warning"
          label={warnings.length === 1 ? 'Warning' : `${warnings.length} Warnings`}
          items={warnings}
          icon={<AlertTriangle className={ICON} strokeWidth={1.75} />}
        />
      )}
      {maintenanceReason && (
        <AlertRow
          severity="maintenance"
          label="Maintenance"
          items={[maintenanceReason]}
          icon={<Wrench className={ICON} strokeWidth={1.75} />}
        />
      )}
    </div>
  );
}
