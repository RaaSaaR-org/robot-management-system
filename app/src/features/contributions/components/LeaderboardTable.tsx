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
            className="h-12 bg-gray-100 dark:bg-gray-800 rounded animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div
        className={cn(
          'text-center py-12 text-gray-500 dark:text-gray-400',
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
          <tr className="border-b border-gray-200 dark:border-gray-700 text-left">
            <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">
              Rank
            </th>
            <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">
              Contributor
            </th>
            <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 text-right">
              Credits
            </th>
            <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 text-right">
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
                  'border-b border-gray-100 dark:border-gray-800 transition-colors',
                  'hover:bg-gray-50 dark:hover:bg-gray-800/50',
                  rank <= 3 && 'font-medium'
                )}
              >
                <td className="px-4 py-3">
                  <span
                    className={cn(
                      'inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold',
                      rank === 1 && 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
                      rank === 2 && 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
                      rank === 3 && 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
                      rank > 3 && 'text-gray-500 dark:text-gray-400'
                    )}
                  >
                    {rank}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-900 dark:text-gray-100 truncate max-w-[200px]">
                  {entry.userId.length > 12
                    ? `${entry.userId.slice(0, 12)}...`
                    : entry.userId}
                </td>
                <td className="px-4 py-3 text-right text-gray-900 dark:text-gray-100 font-mono">
                  {entry.totalCredits.toLocaleString(UI_DATE_LOCALE)}
                </td>
                <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-400 font-mono">
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
