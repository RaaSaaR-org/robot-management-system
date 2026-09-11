/**
 * @file chartColors.ts
 * @description Token-based colours for recharts (and any SVG chart), as CSS var
 *              strings so charts follow the theme and never hard-code hex.
 *              Series colours are for categories; when a line *means* a state
 *              (fault, estimate) use the named signal colour instead.
 * @feature shared
 */

import type { CSSProperties } from 'react';

/** Named colours. Every value is a `var(--…)` string usable in stroke/fill/style. */
export const chartColors = {
  primary: 'var(--color-primary)',
  accent: 'var(--color-accent)',
  measured: 'var(--signal-measured)',
  estimated: 'var(--signal-estimated)',
  unknown: 'var(--signal-unknown)',
  stopped: 'var(--signal-stopped)',
  /** Categorical order: mint, lavender, amber, ink, accent, red (red last — it reads as a fault) */
  series: [
    'var(--color-primary)',
    'var(--signal-estimated)',
    'var(--signal-unknown)',
    'var(--text-secondary)',
    'var(--color-accent)',
    'var(--signal-stopped)',
  ],
  grid: 'var(--border-subtle)',
  axis: 'var(--border-color)',
  tick: 'var(--text-tertiary)',
  label: 'var(--text-secondary)',
  muted: 'var(--text-muted)',
  surface: 'var(--bg-secondary)',
  tooltipBg: 'var(--bg-elevated)',
  tooltipBorder: 'var(--border-color-strong)',
  tooltipText: 'var(--text-primary)',
} as const;

/** The n-th categorical series colour (wraps). */
export function chartSeriesColor(index: number): string {
  return chartColors.series[((index % chartColors.series.length) + chartColors.series.length) % chartColors.series.length];
}

const tick = { fill: chartColors.tick, fontSize: 11 } as const;

/**
 * Props to spread onto recharts parts.
 *
 * @example
 * ```tsx
 * <LineChart data={data}>
 *   <CartesianGrid {...chartTheme.grid} />
 *   <XAxis dataKey="t" {...chartTheme.xAxis} />
 *   <YAxis {...chartTheme.yAxis} />
 *   <Tooltip {...chartTheme.tooltip} />
 *   <Line dataKey="battery" stroke={chartColors.primary} dot={false} strokeWidth={1.75} />
 * </LineChart>
 * ```
 */
export const chartTheme = {
  grid: { stroke: chartColors.grid, strokeDasharray: '3 3', vertical: false },
  xAxis: { stroke: chartColors.axis, tick, tickLine: false, axisLine: { stroke: chartColors.axis } },
  yAxis: { stroke: chartColors.axis, tick, tickLine: false, axisLine: false, width: 40 },
  tooltip: {
    contentStyle: {
      background: chartColors.tooltipBg,
      border: `1px solid ${chartColors.tooltipBorder}`,
      borderRadius: 10,
      color: chartColors.tooltipText,
      fontSize: 12,
      boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
      padding: '8px 10px',
    } satisfies CSSProperties,
    labelStyle: { color: chartColors.label, fontSize: 11, marginBottom: 4 } satisfies CSSProperties,
    itemStyle: { color: chartColors.tooltipText, padding: 0 } satisfies CSSProperties,
    cursor: { stroke: chartColors.axis, strokeWidth: 1 },
  },
  legend: { wrapperStyle: { fontSize: 12, color: chartColors.label } satisfies CSSProperties },
} as const;
