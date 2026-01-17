/**
 * @file Leaderboard.tsx
 * @description Leaderboard component displaying top contributors
 * @feature contributions
 */

import { cn } from '@/shared/utils/cn';
import { Trophy, Medal, Award, User } from 'lucide-react';
import { TierBadge } from './TierBadge';
import type { LeaderboardEntry, ContributorStats } from '../types/contributions.types';
import { formatCredits } from '../types/contributions.types';

// ============================================================================
// TYPES
// ============================================================================

export interface LeaderboardProps {
  entries: LeaderboardEntry[];
  currentUserStats?: ContributorStats | null;
  isLoading?: boolean;
  className?: string;
}

// ============================================================================
// HELPERS
// ============================================================================

function getRankIcon(rank: number) {
  switch (rank) {
    case 1:
      return <Trophy className="w-6 h-6 text-yellow-500" />;
    case 2:
      return <Medal className="w-6 h-6 text-gray-400" />;
    case 3:
      return <Award className="w-6 h-6 text-amber-600" />;
    default:
      return null;
  }
}

function getRankBgClass(rank: number): string {
  switch (rank) {
    case 1:
      return 'bg-gradient-to-r from-yellow-50 to-amber-50 dark:from-yellow-900/20 dark:to-amber-900/20 border-yellow-200 dark:border-yellow-800';
    case 2:
      return 'bg-gradient-to-r from-gray-50 to-slate-50 dark:from-gray-800/50 dark:to-slate-800/50 border-gray-200 dark:border-gray-700';
    case 3:
      return 'bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20 border-amber-200 dark:border-amber-800';
    default:
      return 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700';
  }
}

// ============================================================================
// COMPONENT
// ============================================================================

export function Leaderboard({
  entries,
  currentUserStats,
  isLoading,
  className,
}: LeaderboardProps) {
  if (isLoading) {
    return (
      <div className={cn('space-y-3', className)}>
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="h-16 bg-gray-100 dark:bg-gray-800 rounded-lg animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div
        className={cn(
          'flex flex-col items-center justify-center py-12 text-gray-500 dark:text-gray-400',
          className
        )}
      >
        <Trophy className="w-12 h-12 mb-3 opacity-50" />
        <p className="text-lg">No contributors yet</p>
        <p className="text-sm">Be the first to contribute!</p>
      </div>
    );
  }

  return (
    <div className={cn('space-y-3', className)}>
      {/* Current User Banner (if not in top 10) */}
      {currentUserStats && currentUserStats.rank > 10 && (
        <div className="mb-4 p-4 bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800 rounded-lg">
          <div className="flex items-center gap-4">
            <div className="flex items-center justify-center w-10 h-10 bg-primary-100 dark:bg-primary-800 rounded-full">
              <User className="w-5 h-5 text-primary-600 dark:text-primary-400" />
            </div>
            <div className="flex-1">
              <p className="font-medium text-primary-900 dark:text-primary-100">
                Your Rank: #{currentUserStats.rank}
              </p>
              <p className="text-sm text-primary-600 dark:text-primary-400">
                {formatCredits(currentUserStats.totalCredits)} credits
              </p>
            </div>
            <TierBadge tier={currentUserStats.tier} />
          </div>
        </div>
      )}

      {/* Leaderboard Entries */}
      {entries.map((entry) => {
        const isCurrentUser = currentUserStats?.userId === entry.userId;
        const rankIcon = getRankIcon(entry.rank);

        return (
          <div
            key={entry.userId}
            className={cn(
              'flex items-center gap-4 p-4 rounded-lg border transition-all',
              getRankBgClass(entry.rank),
              isCurrentUser && 'ring-2 ring-primary-500'
            )}
          >
            {/* Rank */}
            <div className="flex items-center justify-center w-10 h-10">
              {rankIcon || (
                <span className="text-lg font-bold text-gray-400 dark:text-gray-500">
                  {entry.rank}
                </span>
              )}
            </div>

            {/* User Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-medium text-gray-900 dark:text-gray-100 truncate">
                  {entry.displayName || `User ${entry.userId.slice(0, 8)}`}
                </p>
                {isCurrentUser && (
                  <span className="px-2 py-0.5 text-xs bg-primary-100 dark:bg-primary-800 text-primary-700 dark:text-primary-300 rounded">
                    You
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
                <span>{entry.totalContributions} contributions</span>
                <span>{entry.totalTrajectories.toLocaleString()} trajectories</span>
                <span>Quality: {entry.averageQuality.toFixed(0)}%</span>
              </div>
            </div>

            {/* Tier & Credits */}
            <div className="flex items-center gap-4">
              <TierBadge tier={entry.tier} size="sm" />
              <div className="text-right">
                <p className="font-semibold text-gray-900 dark:text-gray-100">
                  {formatCredits(entry.totalCredits)}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">credits</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
