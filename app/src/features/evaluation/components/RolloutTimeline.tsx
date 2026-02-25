/**
 * @file RolloutTimeline.tsx
 * @description Timeline list of recent evaluation rollouts
 * @feature evaluation
 */

import type { EvaluationEpisode } from '../types';

export interface RolloutTimelineProps {
  episodes: EvaluationEpisode[];
  maxItems?: number;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function RolloutTimeline({ episodes, maxItems = 10 }: RolloutTimelineProps) {
  const recent = episodes.slice(0, maxItems);

  if (recent.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 bg-theme-secondary/10 rounded-lg">
        <p className="text-theme-secondary">No recent rollouts</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {recent.map((ep) => (
        <div
          key={ep.id}
          className="flex items-center gap-3 px-4 py-3 rounded-lg border border-theme section-primary"
        >
          {/* Status indicator */}
          <div
            className={`w-2.5 h-2.5 rounded-full shrink-0 ${
              ep.success ? 'bg-green-500' : 'bg-red-500'
            }`}
          />

          {/* Task info */}
          <div className="flex-1 min-w-0">
            <p className="text-sm text-theme-primary truncate">{ep.taskPrompt}</p>
            <p className="text-xs text-theme-tertiary">
              {ep.modelVersion} &middot; {ep.robot?.name ?? ep.robotId}
            </p>
          </div>

          {/* Duration */}
          <span className="text-xs font-mono text-theme-secondary shrink-0">
            {formatDuration(ep.durationMs)}
          </span>

          {/* Error type badge */}
          {ep.errorType && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/10 text-red-500 shrink-0">
              {ep.errorType}
            </span>
          )}

          {/* Time ago */}
          <span className="text-xs text-theme-tertiary shrink-0">{timeAgo(ep.createdAt)}</span>
        </div>
      ))}
    </div>
  );
}
