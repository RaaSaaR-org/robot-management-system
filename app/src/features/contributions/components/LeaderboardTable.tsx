/**
 * @file LeaderboardTable.tsx
 * @description Responsive table showing top contributors (TASK-065)
 * @feature Data Contribution
 */

import { cn } from '@/shared/utils/cn';
import { UI_DATE_LOCALE } from '@/shared/utils/format';

// ============================================================================
// TYPES
// ============================================================================

export interface LeaderboardRow {
  userId: string;
  totalCredits: number;
  totalEpisodes: number;
}

export interface LeaderboardTableProps {
  entries: LeaderboardRow[];
  isLoading?: boolean;
  className?: string;
}

// ============================================================================
// COMPONENT
// ============================================================================

export function LeaderboardTable({ entries, isLoading, className }: LeaderboardTableProps) {
  if (isLoading) {
    return (
      <div className={cn('space-y-2', className)}>
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="h-12 bg-inset rounded animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div
        className={cn(
          'text-center py-12 text-ink-tertiary ',
          className
        )}
      >
        <p className="text-lg">No contributors yet</p>
        <p className="text-sm mt-1">Be the first to contribute data!</p>
      </div>
    );
  }

  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left">
            <th className="px-4 py-3 font-semibold text-ink-secondary">
              Rank
            </th>
            <th className="px-4 py-3 font-semibold text-ink-secondary">
              Contributor
            </th>
            <th className="px-4 py-3 font-semibold text-ink-secondary text-right">
              Credits
            </th>
            <th className="px-4 py-3 font-semibold text-ink-secondary text-right">
              Episodes
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, index) => {
            const rank = index + 1;
            return (
              <tr
                key={entry.userId}
                className={cn(
                  'border-b border-line-subtle transition-colors',
                  'hover:bg-inset ',
                  rank <= 3 && 'font-medium'
                )}
              >
                <td className="px-4 py-3">
                  <span
                    className={cn(
                      'inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold',
                      rank === 1 && 'bg-signal-unknown/10 text-signal-unknown ',
                      rank === 2 && 'bg-inset text-ink-primary ',
                      rank === 3 && 'bg-signal-unknown/10 text-signal-unknown ',
                      rank > 3 && 'text-ink-tertiary '
                    )}
                  >
                    {rank}
                  </span>
                </td>
                <td className="px-4 py-3 text-ink-primary truncate max-w-[200px]">
                  {entry.userId.length > 12
                    ? `${entry.userId.slice(0, 12)}...`
                    : entry.userId}
                </td>
                <td className="px-4 py-3 text-right text-ink-primary font-mono">
                  {entry.totalCredits.toLocaleString(UI_DATE_LOCALE)}
                </td>
                <td className="px-4 py-3 text-right text-ink-secondary font-mono">
                  {entry.totalEpisodes.toLocaleString(UI_DATE_LOCALE)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
