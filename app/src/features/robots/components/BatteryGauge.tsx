/**
 * @file BatteryGauge.tsx
 * @description Visual battery indicator component with level, voltage, and temperature
 * @feature robots
 * @dependencies @/shared/utils/cn
 */

import { cn } from '@/shared/utils/cn';

// ============================================================================
// TYPES
// ============================================================================

export interface BatteryGaugeProps {
  /** Battery level 0-100 */
  level: number;
  /** Battery voltage (optional) */
  voltage?: number;
  /** Battery temperature in Celsius (optional) */
  temperature?: number;
  /** Whether the battery is charging */
  charging?: boolean;
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

type BatteryState = 'critical' | 'low' | 'medium' | 'good' | 'full';

function getBatteryState(level: number): BatteryState {
  if (level <= 10) return 'critical';
  if (level <= 25) return 'low';
  if (level <= 50) return 'medium';
  if (level <= 80) return 'good';
  return 'full';
}

const BATTERY_COLORS: Record<BatteryState, { fill: string; text: string }> = {
  critical: { fill: 'bg-red-500', text: 'text-red-500' },
  low: { fill: 'bg-orange-500', text: 'text-orange-500' },
  medium: { fill: 'bg-yellow-500', text: 'text-yellow-500' },
  good: { fill: 'bg-green-500', text: 'text-green-500' },
  full: { fill: 'bg-green-500', text: 'text-green-500' },
};

const SIZE_CONFIG = {
  sm: {
    container: 'w-10 h-5',
    terminal: 'w-1 h-2',
    text: 'text-xs',
    details: 'text-xs gap-2',
  },
  md: {
    container: 'w-14 h-7',
    terminal: 'w-1.5 h-3',
    text: 'text-sm',
    details: 'text-xs gap-3',
  },
  lg: {
    container: 'w-20 h-10',
    terminal: 'w-2 h-4',
    text: 'text-base',
    details: 'text-sm gap-4',
  },
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
  size = 'md',
  showDetails = false,
  showPercentage = true,
  className,
}: BatteryGaugeProps) {
  const clampedLevel = Math.max(0, Math.min(100, level));
  const state = getBatteryState(clampedLevel);
  const colors = BATTERY_COLORS[state];
  const sizeConfig = SIZE_CONFIG[size];

  return (
    <div className={cn('inline-flex flex-col items-center', className)}>
      {/* Battery Icon */}
      <div className="flex items-center gap-0.5">
        {/* Battery Body */}
        <div
          className={cn(
            'relative rounded-sm border-2 border-theme overflow-hidden',
            sizeConfig.container
          )}
          role="meter"
          aria-valuenow={clampedLevel}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Battery level: ${Math.round(clampedLevel)}%`}
        >
          {/* Fill Level */}
          <div
            className={cn(
              'absolute inset-y-0 left-0 transition-all duration-500',
              colors.fill,
              charging && 'animate-pulse'
            )}
            style={{ width: `${clampedLevel}%` }}
          />

          {/* Percentage Label (inside battery) */}
          {showPercentage && size !== 'sm' && (
            <span
              className={cn(
                'absolute inset-0 flex items-center justify-center font-semibold',
                sizeConfig.text,
                clampedLevel > 50 ? 'text-white' : 'text-theme-primary'
              )}
            >
              {Math.round(clampedLevel)}%
            </span>
          )}

          {/* Charging Indicator */}
          {charging && (
            <div className="absolute inset-0 flex items-center justify-center">
              <svg
                className={cn(
                  'text-white drop-shadow-md',
                  size === 'sm' ? 'h-3 w-3' : size === 'md' ? 'h-4 w-4' : 'h-5 w-5'
                )}
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M11 21h-1l1-7H7.5c-.58 0-.57-.32-.38-.66.19-.34.05-.08.07-.12C8.48 10.94 10.42 7.54 13 3h1l-1 7h3.5c.49 0 .56.33.47.51l-.07.15C12.96 17.55 11 21 11 21z" />
              </svg>
            </div>
          )}
        </div>

        {/* Battery Terminal */}
        <div
          className={cn(
            'rounded-r-sm bg-theme-secondary',
            sizeConfig.terminal
          )}
        />
      </div>

      {/* Percentage for small size */}
      {showPercentage && size === 'sm' && (
        <span className={cn('mt-1 font-medium', sizeConfig.text, colors.text)}>
          {Math.round(clampedLevel)}%
        </span>
      )}

      {/* Details Section */}
      {showDetails && (
        <div className={cn('flex items-center mt-2', sizeConfig.details)}>
          {voltage !== undefined && (
            <div className="flex items-center gap-1 text-theme-secondary">
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <span>{voltage.toFixed(1)}V</span>
            </div>
          )}
          {temperature !== undefined && (
            <div className="flex items-center gap-1 text-theme-secondary">
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                />
              </svg>
              <span>{temperature.toFixed(0)}°C</span>
            </div>
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
  className,
}: {
  level: number;
  charging?: boolean;
  className?: string;
}) {
  const state = getBatteryState(level);
  const colors = BATTERY_COLORS[state];

  return (
    <div className={cn('inline-flex items-center gap-1.5', className)}>
      {/* Battery icon */}
      <svg
        className={cn('h-4 w-4', colors.text)}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <rect x="2" y="7" width="18" height="10" rx="2" />
        <rect x="20" y="10" width="2" height="4" rx="0.5" className="fill-current" />
        <rect
          x="4"
          y="9"
          width={`${(level / 100) * 14}`}
          height="6"
          rx="1"
          className={cn('fill-current', charging && 'animate-pulse')}
        />
      </svg>

      {/* Percentage */}
      <span className={cn('text-sm font-medium', colors.text)}>
        {Math.round(level)}%
      </span>

      {/* Charging bolt */}
      {charging && (
        <svg className="h-3 w-3 text-yellow-500" fill="currentColor" viewBox="0 0 24 24">
          <path d="M11 21h-1l1-7H7.5c-.58 0-.57-.32-.38-.66.19-.34.05-.08.07-.12C8.48 10.94 10.42 7.54 13 3h1l-1 7h3.5c.49 0 .56.33.47.51l-.07.15C12.96 17.55 11 21 11 21z" />
        </svg>
      )}
    </div>
  );
}
