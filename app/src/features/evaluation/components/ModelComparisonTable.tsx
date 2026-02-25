/**
 * @file ModelComparisonTable.tsx
 * @description Table comparing two model versions side-by-side
 * @feature evaluation
 */

import type { ModelComparisonResult } from '../types';

export interface ModelComparisonTableProps {
  comparison: ModelComparisonResult | null;
  loading?: boolean;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function ModelComparisonTable({ comparison, loading }: ModelComparisonTableProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 bg-theme-secondary/10 rounded-lg">
        <p className="text-theme-secondary">Loading comparison...</p>
      </div>
    );
  }

  if (!comparison) {
    return (
      <div className="flex items-center justify-center h-48 bg-theme-secondary/10 rounded-lg">
        <p className="text-theme-secondary">Select two model versions to compare</p>
      </div>
    );
  }

  const { versionA, versionB } = comparison;

  const rows = [
    {
      label: 'Success Rate',
      a: `${versionA.successRate.toFixed(1)}%`,
      b: `${versionB.successRate.toFixed(1)}%`,
      better: versionA.successRate > versionB.successRate ? 'a' : versionB.successRate > versionA.successRate ? 'b' : null,
    },
    {
      label: 'Total Episodes',
      a: String(versionA.totalEpisodes),
      b: String(versionB.totalEpisodes),
      better: null,
    },
    {
      label: 'Avg Duration',
      a: formatDuration(versionA.avgDurationMs),
      b: formatDuration(versionB.avgDurationMs),
      better: versionA.avgDurationMs < versionB.avgDurationMs ? 'a' : versionB.avgDurationMs < versionA.avgDurationMs ? 'b' : null,
    },
    {
      label: 'Top Error',
      a: versionA.errorBreakdown[0]?.errorType ?? 'none',
      b: versionB.errorBreakdown[0]?.errorType ?? 'none',
      better: null,
    },
  ];

  return (
    <div className="overflow-hidden rounded-lg border border-theme">
      <table className="w-full text-sm">
        <thead>
          <tr className="section-secondary">
            <th className="px-4 py-3 text-left text-theme-secondary font-medium">Metric</th>
            <th className="px-4 py-3 text-center text-theme-secondary font-medium">
              {versionA.modelVersion}
            </th>
            <th className="px-4 py-3 text-center text-theme-secondary font-medium">
              {versionB.modelVersion}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-theme">
          {rows.map((row) => (
            <tr key={row.label} className="section-primary">
              <td className="px-4 py-3 text-theme-secondary">{row.label}</td>
              <td
                className={`px-4 py-3 text-center font-mono ${
                  row.better === 'a' ? 'text-green-500 font-semibold' : 'text-theme-primary'
                }`}
              >
                {row.a}
              </td>
              <td
                className={`px-4 py-3 text-center font-mono ${
                  row.better === 'b' ? 'text-green-500 font-semibold' : 'text-theme-primary'
                }`}
              >
                {row.b}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
