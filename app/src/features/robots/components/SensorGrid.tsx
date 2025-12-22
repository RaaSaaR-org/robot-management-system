/**
 * @file SensorGrid.tsx
 * @description Grid display component for robot sensor readings
 * @feature robots
 * @dependencies @/shared/utils/cn
 */

import { cn } from '@/shared/utils/cn';

// ============================================================================
// TYPES
// ============================================================================

export interface SensorGridProps {
  /** Sensor data as key-value pairs */
  sensors: Record<string, number | boolean | string>;
  /** Compact display mode */
  compact?: boolean;
  /** Number of columns */
  columns?: 2 | 3 | 4;
  /** Sensor configuration for labels and units */
  config?: SensorConfig;
  /** Additional class names */
  className?: string;
}

export interface SensorConfig {
  [key: string]: {
    /** Display label */
    label?: string;
    /** Unit for numeric values */
    unit?: string;
    /** Type hint for rendering */
    type?: 'boolean' | 'number' | 'distance' | 'percentage' | 'string';
    /** Maximum value for progress display */
    max?: number;
    /** Threshold for warning state */
    warningThreshold?: number;
    /** Whether high value is bad (for boolean/threshold) */
    invertWarning?: boolean;
  };
}

// ============================================================================
// DEFAULT SENSOR CONFIG
// ============================================================================

const DEFAULT_SENSOR_CONFIG: SensorConfig = {
  frontSonar: { label: 'Front Sonar', unit: 'cm', type: 'distance', max: 300 },
  rearSonar: { label: 'Rear Sonar', unit: 'cm', type: 'distance', max: 300 },
  leftBumper: { label: 'Left Bumper', type: 'boolean' },
  rightBumper: { label: 'Right Bumper', type: 'boolean' },
  cliffDetector: { label: 'Cliff Detector', type: 'boolean' },
  obstacleDetected: { label: 'Obstacle', type: 'boolean' },
  temperature: { label: 'Temperature', unit: '°C', type: 'number', warningThreshold: 50 },
  humidity: { label: 'Humidity', unit: '%', type: 'percentage', max: 100 },
  pressure: { label: 'Pressure', unit: 'hPa', type: 'number' },
  lidar: { label: 'LiDAR', unit: 'm', type: 'distance', max: 10 },
  infrared: { label: 'IR Sensor', type: 'boolean' },
};

// ============================================================================
// HELPERS
// ============================================================================

function formatSensorLabel(key: string, config?: SensorConfig): string {
  if (config?.[key]?.label) {
    return config[key].label;
  }
  if (DEFAULT_SENSOR_CONFIG[key]?.label) {
    return DEFAULT_SENSOR_CONFIG[key].label;
  }
  // Convert camelCase to Title Case
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (str) => str.toUpperCase())
    .trim();
}

function getSensorConfig(key: string, config?: SensorConfig) {
  return config?.[key] ?? DEFAULT_SENSOR_CONFIG[key] ?? {};
}

function inferSensorType(
  value: number | boolean | string,
  config?: { type?: string }
): 'boolean' | 'number' | 'string' {
  if (config?.type === 'boolean' || typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  return 'string';
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

function BooleanSensor({
  label,
  value,
  compact,
}: {
  label: string;
  value: boolean;
  compact?: boolean;
}) {
  const isTriggered = value === true;

  return (
    <div
      className={cn(
        'flex items-center justify-between rounded-lg bg-theme-elevated',
        compact ? 'p-2' : 'p-3'
      )}
    >
      <span className={cn('text-theme-secondary', compact ? 'text-xs' : 'text-sm')}>
        {label}
      </span>
      <div className="flex items-center gap-2">
        <div
          className={cn(
            'rounded-full transition-colors',
            compact ? 'w-2 h-2' : 'w-3 h-3',
            isTriggered ? 'bg-red-500 animate-pulse' : 'bg-green-500'
          )}
        />
        {!compact && (
          <span
            className={cn(
              'text-sm font-medium',
              isTriggered ? 'text-red-500' : 'text-green-500'
            )}
          >
            {isTriggered ? 'Triggered' : 'OK'}
          </span>
        )}
      </div>
    </div>
  );
}

function NumericSensor({
  label,
  value,
  unit,
  max,
  warningThreshold,
  compact,
  showProgress,
}: {
  label: string;
  value: number;
  unit?: string;
  max?: number;
  warningThreshold?: number;
  compact?: boolean;
  showProgress?: boolean;
}) {
  const isWarning = warningThreshold !== undefined && value >= warningThreshold;
  const percentage = max ? Math.min(100, (value / max) * 100) : undefined;

  return (
    <div
      className={cn(
        'rounded-lg bg-theme-elevated',
        compact ? 'p-2' : 'p-3'
      )}
    >
      <div className="flex items-center justify-between">
        <span className={cn('text-theme-secondary', compact ? 'text-xs' : 'text-sm')}>
          {label}
        </span>
        <span
          className={cn(
            'font-medium',
            compact ? 'text-xs' : 'text-sm',
            isWarning ? 'text-orange-500' : 'text-theme-primary'
          )}
        >
          {typeof value === 'number' ? value.toFixed(1) : value}
          {unit && <span className="text-theme-tertiary ml-0.5">{unit}</span>}
        </span>
      </div>

      {/* Progress bar for distance/percentage values */}
      {showProgress && percentage !== undefined && (
        <div className="mt-2 h-1.5 bg-theme-elevated rounded-full overflow-hidden border border-theme">
          <div
            className={cn(
              'h-full transition-all duration-300 rounded-full',
              isWarning ? 'bg-orange-500' : 'bg-cobalt-500'
            )}
            style={{ width: `${percentage}%` }}
          />
        </div>
      )}
    </div>
  );
}

function StringSensor({
  label,
  value,
  compact,
}: {
  label: string;
  value: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between rounded-lg bg-theme-elevated',
        compact ? 'p-2' : 'p-3'
      )}
    >
      <span className={cn('text-theme-secondary', compact ? 'text-xs' : 'text-sm')}>
        {label}
      </span>
      <span className={cn('font-medium text-theme-primary', compact ? 'text-xs' : 'text-sm')}>
        {value}
      </span>
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

/**
 * Displays robot sensor readings in a responsive grid layout.
 *
 * @example
 * ```tsx
 * <SensorGrid
 *   sensors={{
 *     frontSonar: 150,
 *     rearSonar: 220,
 *     leftBumper: false,
 *     rightBumper: false,
 *     obstacleDetected: true,
 *   }}
 *   columns={2}
 * />
 * ```
 */
export function SensorGrid({
  sensors,
  compact = false,
  columns = 2,
  config,
  className,
}: SensorGridProps) {
  const sensorEntries = Object.entries(sensors);

  if (sensorEntries.length === 0) {
    return (
      <div className={cn('text-sm text-theme-tertiary text-center py-4', className)}>
        No sensor data available
      </div>
    );
  }

  const gridCols = {
    2: 'grid-cols-2',
    3: 'grid-cols-3',
    4: 'grid-cols-4',
  };

  return (
    <div
      className={cn(
        'grid gap-2',
        gridCols[columns],
        className
      )}
    >
      {sensorEntries.map(([key, value]) => {
        const sensorConfig = getSensorConfig(key, config);
        const label = formatSensorLabel(key, config);
        const type = inferSensorType(value, sensorConfig);

        if (type === 'boolean') {
          return (
            <BooleanSensor
              key={key}
              label={label}
              value={value as boolean}
              compact={compact}
            />
          );
        }

        if (type === 'number') {
          return (
            <NumericSensor
              key={key}
              label={label}
              value={value as number}
              unit={sensorConfig.unit}
              max={sensorConfig.max}
              warningThreshold={sensorConfig.warningThreshold}
              compact={compact}
              showProgress={sensorConfig.type === 'distance' || sensorConfig.type === 'percentage'}
            />
          );
        }

        return (
          <StringSensor
            key={key}
            label={label}
            value={String(value)}
            compact={compact}
          />
        );
      })}
    </div>
  );
}

// ============================================================================
// GROUPED VARIANT
// ============================================================================

export interface SensorGroupProps {
  /** Group title */
  title: string;
  /** Sensor data */
  sensors: Record<string, number | boolean | string>;
  /** Compact mode */
  compact?: boolean;
  /** Columns */
  columns?: 2 | 3 | 4;
  /** Sensor config */
  config?: SensorConfig;
  /** Class name */
  className?: string;
}

/**
 * Sensor grid with a title header.
 */
export function SensorGroup({
  title,
  sensors,
  compact,
  columns = 2,
  config,
  className,
}: SensorGroupProps) {
  return (
    <div className={className}>
      <h3 className={cn('font-medium text-theme-secondary mb-2', compact ? 'text-xs' : 'text-sm')}>
        {title}
      </h3>
      <SensorGrid sensors={sensors} compact={compact} columns={columns} config={config} />
    </div>
  );
}
