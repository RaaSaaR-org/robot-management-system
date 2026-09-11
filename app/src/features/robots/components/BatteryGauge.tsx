/**
 * @file BatteryGauge.tsx
 * @description Visual battery indicator component with level, voltage, and temperature
 * @feature robots
 */

import {
  BatteryCharging,
  BatteryFull,
  BatteryLow,
  BatteryMedium,
  PlugZap,
  Zap,
} from 'lucide-react';
import { cn } from '@/shared/utils/cn';

// ============================================================================
// TYPES
// ============================================================================

export interface BatteryGaugeProps {
  /** Battery level 0-100, or null for AC-powered (no battery) */
  level: number | null;
  /** Battery voltage (optional) */
  voltage?: number | null;
  /** Battery temperature in Celsius (optional) */
  temperature?: number | null;
  /** Whether the battery is charging */
  charging?: boolean;
  /** Power source type */
  powerSource?: 'battery' | 'ac_powered';
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Show detailed metrics below gauge */
  showDetails?: boolean;
  /** Show percentage label */
  showPercentage?: boolean;
  /** Additional class names */
  className?: string;
}

// ============================================================================
// HELPERS
// ============================================================================

type BatteryState = 'critical' | 'low' | 'ok';

function getBatteryState(level: number): BatteryState {
  if (level <= 15) return 'critical';
  if (level <= 30) return 'low';
  return 'ok';
}

/** Signal tokens: ok = measured, low = unknown (amber), critical = stopped. */
const BATTERY_COLORS: Record<BatteryState, { fill: string; text: string }> = {
  critical: { fill: 'bg-signal-stopped', text: 'text-signal-stopped' },
  low: { fill: 'bg-signal-unknown', text: 'text-signal-unknown' },
  ok: { fill: 'bg-signal-measured', text: 'text-signal-measured' },
};

const SIZE_CONFIG = {
  sm: { container: 'w-9 h-4', terminal: 'w-0.5 h-1.5', text: 'text-xs', icon: 'h-4 w-4' },
  md: { container: 'w-12 h-6', terminal: 'w-1 h-2.5', text: 'text-sm', icon: 'h-5 w-5' },
  lg: { container: 'w-16 h-8', terminal: 'w-1 h-3', text: 'text-base', icon: 'h-6 w-6' },
};

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Visual battery indicator with customizable size and optional details.
 *
 * @example
 * ```tsx
 * // Basic usage
 * <BatteryGauge level={75} />
 *
 * // With details
 * <BatteryGauge
 *   level={45}
 *   voltage={24.2}
 *   temperature={38}
 *   showDetails
 * />
 *
 * // Charging state
 * <BatteryGauge level={62} charging />
 * ```
 */
export function BatteryGauge({
  level,
  voltage,
  temperature,
  charging = false,
  powerSource,
  size = 'md',
  showDetails = false,
  showPercentage = true,
  className,
}: BatteryGaugeProps) {
  const sizeConfig = SIZE_CONFIG[size];
  const isAcPowered = level === null || powerSource === 'ac_powered';

  if (isAcPowered) {
    return (
      <div className={cn('inline-flex items-center gap-2', className)}>
        <PlugZap
          className={cn('text-signal-measured', sizeConfig.icon)}
          strokeWidth={1.75}
          aria-label="AC powered"
        />
        {showPercentage && (
          <span className={cn('font-semibold text-ink-primary', sizeConfig.text)}>AC powered</span>
        )}
      </div>
    );
  }

  const clampedLevel = Math.max(0, Math.min(100, level));
  const colors = BATTERY_COLORS[getBatteryState(clampedLevel)];

  return (
    <div className={cn('inline-flex flex-col gap-1.5', className)}>
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-0.5">
          <div
            className={cn(
              'relative overflow-hidden rounded-[3px] border border-line-strong bg-inset p-px',
              sizeConfig.container
            )}
            role="meter"
            aria-valuenow={clampedLevel}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Battery level: ${Math.round(clampedLevel)}%`}
          >
            <div
              className={cn('h-full rounded-[2px] transition-[width] duration-500', colors.fill)}
              style={{ width: `${clampedLevel}%` }}
            />
          </div>
          <div className={cn('rounded-r-sm bg-line-strong', sizeConfig.terminal)} />
        </div>
        {showPercentage && (
          <span className={cn('font-semibold tabular-nums text-ink-primary', sizeConfig.text)}>
            {Math.round(clampedLevel)}
            <span className="ml-0.5 font-normal text-ink-tertiary">%</span>
          </span>
        )}
        {charging && (
          <Zap className="h-4 w-4 text-signal-measured" strokeWidth={1.75} aria-label="Charging" />
        )}
      </div>

      {showDetails && (voltage != null || temperature != null) && (
        <div className="flex items-center gap-3 text-xs tabular-nums text-ink-secondary">
          {voltage != null && (
            <span>
              {voltage.toFixed(1)}
              <span className="ml-0.5 text-ink-tertiary">V</span>
            </span>
          )}
          {temperature != null && (
            <span>
              {temperature.toFixed(0)}
              <span className="ml-0.5 text-ink-tertiary">°C</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// COMPACT VARIANT
// ============================================================================

/**
 * Compact inline battery indicator with just level and optional icon.
 */
export function BatteryIndicator({
  level,
  charging = false,
  powerSource,
  className,
}: {
  level: number | null;
  charging?: boolean;
  powerSource?: 'battery' | 'ac_powered';
  className?: string;
}) {
  const isAcPowered = level === null || powerSource === 'ac_powered';

  if (isAcPowered) {
    return (
      <div className={cn('inline-flex items-center gap-1.5', className)}>
        <PlugZap className="h-4 w-4 text-signal-measured" strokeWidth={1.75} />
        <span className="text-sm font-medium text-ink-primary">AC</span>
      </div>
    );
  }

  const colors = BATTERY_COLORS[getBatteryState(level)];
  const Icon = level <= 15 ? BatteryLow : level <= 60 ? BatteryMedium : BatteryFull;

  return (
    <div className={cn('inline-flex items-center gap-1.5', className)}>
      {charging ? (
        <BatteryCharging className={cn('h-4 w-4', colors.text)} strokeWidth={1.75} />
      ) : (
        <Icon className={cn('h-4 w-4', colors.text)} strokeWidth={1.75} />
      )}
      <span className="text-sm font-medium tabular-nums text-ink-primary">{Math.round(level)}%</span>
    </div>
  );
}
