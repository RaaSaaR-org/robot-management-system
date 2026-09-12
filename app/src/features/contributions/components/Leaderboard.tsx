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
import { UI_DATE_LOCALE } from '@/shared/utils/format';

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
      return <Trophy className="w-6 h-6 text-signal-unknown" />;
    case 2:
      return <Medal className="w-6 h-6 text-ink-muted" />;
    case 3:
      return <Award className="w-6 h-6 text-signal-unknown" />;
    default:
      return null;
  }
}

function getRankBgClass(rank: number): string {
  switch (rank) {
    case 1:
      return 'bg-inset border-signal-unknown/30 ';
    case 2:
      return 'bg-inset border-line ';
    case 3:
      return 'bg-inset border-primary/40 ';
    default:
      return 'bg-panel border-line ';
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
            className="h-16 bg-inset rounded-lg animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div
        className={cn(
          'flex flex-col items-center justify-center py-12 text-ink-tertiary ',
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
        <div className="mb-4 p-4 bg-primary/10 border border-primary/40 rounded-lg">
          <div className="flex items-center gap-4">
            <div className="flex items-center justify-center w-10 h-10 bg-primary/10 rounded-full">
              <User className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1">
              <p className="font-medium text-ink-primary">
                Your Rank: #{currentUserStats.rank}
              </p>
              <p className="text-sm text-primary">
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
              isCurrentUser && 'ring-2 ring-primary'
            )}
          >
            {/* Rank */}
            <div className="flex items-center justify-center w-10 h-10">
              {rankIcon || (
                <span className="text-lg font-bold text-ink-muted">
                  {entry.rank}
                </span>
              )}
            </div>

            {/* User Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-medium text-ink-primary truncate">
                  {entry.displayName || `User ${entry.userId.slice(0, 8)}`}
                </p>
                {isCurrentUser && (
                  <span className="px-2 py-0.5 text-xs bg-primary/10 text-primary rounded">
                    You
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 text-sm text-ink-tertiary">
                <span>{entry.totalContributions} contributions</span>
                <span>{entry.totalTrajectories.toLocaleString(UI_DATE_LOCALE)} trajectories</span>
                <span>Quality: {entry.averageQuality.toFixed(0)}%</span>
              </div>
            </div>

            {/* Tier & Credits */}
            <div className="flex items-center gap-4">
              <TierBadge tier={entry.tier} size="sm" />
              <div className="text-right">
                <p className="font-semibold text-ink-primary">
                  {formatCredits(entry.totalCredits)}
                </p>
                <p className="text-xs text-ink-tertiary">credits</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
