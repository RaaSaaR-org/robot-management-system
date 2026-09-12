/**
 * @file RolloutTimeline.tsx
 * @description The most recent evaluation rollouts: task, model, robot, result and when
 * @feature evaluation
 */

import { StatusTag } from '@/shared/components/ui';
import type { EvaluationEpisode } from '../types';

export interface RolloutTimelineProps {
  episodes: EvaluationEpisode[];
  maxItems?: number;
}

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function timeAgo(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.floor(hours / 24)} d ago`;
}

const humanError = (e: string) => e.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

export function RolloutTimeline({ episodes, maxItems = 10 }: RolloutTimelineProps) {
  const recent = episodes.slice(0, maxItems);
  if (recent.length === 0) {
    return <p className="py-6 text-center text-sm text-ink-tertiary">No rollouts in this period.</p>;
  }

  return (
    <ul className="flex flex-col divide-y divide-line-subtle">
      {recent.map((ep) => (
        <li key={ep.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 first:pt-0 last:pb-0">
          <StatusTag tone={ep.success ? 'success' : 'danger'} dot>{ep.success ? 'Success' : 'Failed'}</StatusTag>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-ink-primary">{ep.taskPrompt}</p>
            <p className="truncate text-xs text-ink-tertiary">
              {ep.modelVersion} · {ep.robot?.name ?? ep.robotId}
              {ep.errorType ? ` · ${humanError(ep.errorType)}` : ''}
            </p>
          </div>
          <span className="shrink-0 text-xs tabular-nums text-ink-secondary">{formatDuration(ep.durationMs)}</span>
          <span className="shrink-0 text-xs text-ink-tertiary">{timeAgo(ep.createdAt)}</span>
        </li>
      ))}
    </ul>
  );
}
