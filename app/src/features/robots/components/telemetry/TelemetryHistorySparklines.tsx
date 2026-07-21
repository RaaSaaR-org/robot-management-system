/**
 * @file TelemetryHistorySparklines.tsx
 * @description Sparklines of battery SOC and max motor temperature over the last hour
 * @feature robots
 */

import { memo, useEffect, useState } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  YAxis,
  Tooltip as RechartsTooltip,
  ReferenceLine,
} from 'recharts';
import { Card, Spinner } from '@/shared/components/ui';
import { robotsApi } from '../../api/robotsApi';
import { MOTOR_TEMP_WARNING_C } from '../../utils/temperature';
import type { RobotTelemetry } from '../../types/robots.types';
import { UI_DATE_LOCALE } from '@/shared/utils/format';

// ============================================================================
// TYPES & CONSTANTS
// ============================================================================

interface HistoryPoint {
  time: string;
  soc: number | null;
  maxMotorTemp: number | null;
}

const HISTORY_WINDOW_MS = 60 * 60 * 1000; // last hour
const REFRESH_INTERVAL_MS = 60 * 1000;
const HISTORY_LIMIT = 500;

// ============================================================================
// HELPERS
// ============================================================================

/** Battery SOC for a history row: BMS soc first, legacy batteryLevel second. */
function extractSoc(row: RobotTelemetry): number | null {
  if (row.battery?.soc != null) return row.battery.soc;
  return row.batteryLevel ?? null;
}

/** Hottest motor of a history row, or null when no motor temps were recorded. */
function extractMaxMotorTemp(row: RobotTelemetry): number | null {
  const temps = Object.values(row.motorTemperatures ?? {});
  return temps.length > 0 ? Math.max(...temps) : null;
}

// ============================================================================
// SPARKLINE
// ============================================================================

interface SparklineProps {
  label: string;
  unit: string;
  data: HistoryPoint[];
  dataKey: 'soc' | 'maxMotorTemp';
  /** Series stroke color (brand token value) */
  color: string;
  /** Optional horizontal warning threshold */
  warnAt?: number;
  domain: [number | 'auto' | 'dataMin', number | 'auto' | 'dataMax'];
}

function Sparkline({ label, unit, data, dataKey, color, warnAt, domain }: SparklineProps) {
  const points = data.filter((d) => d[dataKey] != null);
  const latest = points.length > 0 ? points[points.length - 1][dataKey] : null;
  const gradientId = `spark-${dataKey}`;

  // Auto domains collapse to a single point when the series is flat (e.g. a
  // steady-state motor temperature), which pins the line to the chart's top
  // edge with zero headroom. Pad it so the line stays visible mid-chart.
  let effectiveDomain: [number | 'auto' | 'dataMin', number | 'auto' | 'dataMax'] = domain;
  if (domain[0] === 'auto' && domain[1] === 'auto') {
    const values = points.map((d) => d[dataKey]).filter((v): v is number => v != null);
    if (values.length > 0) {
      const min = Math.min(...values);
      const max = Math.max(...values);
      const pad = Math.max((max - min) * 0.15, 1);
      effectiveDomain = [min - pad, max + pad];
    }
  }

  return (
    <div className="glass-subtle p-3 rounded-lg">
      <div className="flex items-baseline justify-between mb-1">
        <span className="card-label">{label}</span>
        <span className="font-mono text-sm font-semibold text-theme-primary">
          {latest != null ? `${latest.toFixed(0)}${unit}` : '—'}
        </span>
      </div>
      {points.length >= 2 ? (
        <div className="h-16 min-h-16 min-w-0">
          {/* initialDimension: Recharts measures -1×-1 on first mount before
              its ResizeObserver fires, logging a "width(-1) and height(-1)"
              warning — seed a real size so the initial render isn't zero. */}
          <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height: 64 }}>
            <AreaChart data={points} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={color} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <YAxis hide domain={effectiveDomain} />
              {warnAt !== undefined && (
                <ReferenceLine
                  y={warnAt}
                  stroke="rgba(234,179,8,0.6)"
                  strokeDasharray="4 3"
                  strokeWidth={1}
                  ifOverflow="hidden"
                />
              )}
              <RechartsTooltip
                formatter={(value: number | undefined) =>
                  value != null ? [`${Number(value).toFixed(1)}${unit}`, label] : ['—', label]
                }
                labelFormatter={(time) => new Date(String(time)).toLocaleTimeString(UI_DATE_LOCALE)}
                contentStyle={{
                  backgroundColor: 'var(--glass-bg)',
                  border: '1px solid var(--glass-border)',
                  borderRadius: '8px',
                  fontSize: 12,
                }}
                labelStyle={{ color: 'var(--text-secondary)' }}
                itemStyle={{ color: 'var(--text-primary)' }}
              />
              <Area
                type="monotone"
                dataKey={dataKey}
                stroke={color}
                strokeWidth={2}
                fill={`url(#${gradientId})`}
                dot={false}
                activeDot={{ r: 3 }}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="h-16 flex items-center justify-center text-xs text-theme-muted">
          Not enough history yet
        </div>
      )}
    </div>
  );
}

// ============================================================================
// COMPONENT
// ============================================================================

export interface TelemetryHistorySparklinesProps {
  /** Robot ID to fetch history for */
  robotId: string;
}

/**
 * Battery SOC and max motor temperature over the last hour, fetched from
 * GET /robots/:id/telemetry/history. Renders a friendly empty state when the
 * server has no history (or does not support the endpoint yet).
 */
export const TelemetryHistorySparklines = memo(function TelemetryHistorySparklines({
  robotId,
}: TelemetryHistorySparklinesProps) {
  const [points, setPoints] = useState<HistoryPoint[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchHistory = async () => {
      try {
        const from = new Date(Date.now() - HISTORY_WINDOW_MS).toISOString();
        const rows = await robotsApi.getTelemetryHistory(robotId, {
          from,
          limit: HISTORY_LIMIT,
        });
        if (cancelled) return;
        setPoints(
          rows.map((row) => ({
            time: row.timestamp,
            soc: extractSoc(row),
            maxMotorTemp: extractMaxMotorTemp(row),
          }))
        );
      } catch {
        // Endpoint unavailable (old server) or transient error — show empty state.
        if (!cancelled) setPoints([]);
      }
    };

    setPoints(null);
    fetchHistory();
    const interval = setInterval(fetchHistory, REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [robotId]);

  return (
    <Card>
      <Card.Header>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-theme-primary">Last Hour</h2>
          <span className="text-xs text-theme-tertiary">telemetry history</span>
        </div>
      </Card.Header>
      <Card.Body>
        {points === null ? (
          <div className="flex items-center justify-center py-6">
            <Spinner size="sm" color="cobalt" label="Loading history..." />
          </div>
        ) : points.length === 0 ? (
          <div className="py-6 text-center">
            <p className="text-sm text-theme-secondary">No history recorded yet</p>
            <p className="text-xs text-theme-muted mt-1">
              Sparklines appear once telemetry has been persisted for this robot
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Sparkline
              label="Battery SOC"
              unit="%"
              data={points}
              dataKey="soc"
              color="var(--color-cobalt-500)"
              domain={[0, 100]}
            />
            <Sparkline
              label="Max motor temp"
              unit="°C"
              data={points}
              dataKey="maxMotorTemp"
              color="var(--color-turquoise-600)"
              warnAt={MOTOR_TEMP_WARNING_C}
              domain={['auto', 'auto']}
            />
          </div>
        )}
      </Card.Body>
    </Card>
  );
});
