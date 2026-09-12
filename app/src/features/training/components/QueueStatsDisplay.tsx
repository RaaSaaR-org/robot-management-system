/**
 * @file QueueStatsDisplay.tsx
 * @description The training queue: waiting times and how jobs split by model and priority
 * @feature training
 */

import { KeyValueList, Panel, SkeletonText } from '@/shared/components/ui';
import type { QueueStats } from '../types';

export interface QueueStatsDisplayProps {
  stats: QueueStats | null;
  isLoading?: boolean;
}

function formatMinutes(minutes: number | undefined): string | undefined {
  if (minutes === undefined) return undefined;
  if (minutes < 1) return '< 1 min';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  return mins === 0 ? `${hours} h` : `${hours} h ${mins} min`;
}

/** Queue detail. The headline counts live in the page's StatRow. */
export function QueueStatsDisplay({ stats, isLoading }: QueueStatsDisplayProps) {
  const byModel = stats?.by_model
    ? Object.entries(stats.by_model)
        .filter(([, c]) => c.running + c.queued > 0)
        .map(([model, c]) => `${model}: ${c.running} running, ${c.queued} queued`)
        .join(' · ')
    : '';

  return (
    <Panel>
      <Panel.Header title="Queue" description="How long jobs wait before a worker takes them." />
      <Panel.Body>
        {isLoading && !stats ? (
          <SkeletonText lines={3} />
        ) : !stats ? (
          <p className="text-sm text-ink-tertiary">Queue stats are unavailable. The server has no job queue connected.</p>
        ) : (
          <KeyValueList
            columns={2}
            items={[
              { label: 'Pending', value: stats.pending },
              { label: 'Failed', value: stats.failed },
              { label: 'Average wait', value: formatMinutes(stats.avg_wait_time_minutes) },
              { label: 'Average training time', value: formatMinutes(stats.avg_training_time_minutes) },
              {
                label: 'By priority',
                value: stats.by_priority
                  ? `${stats.by_priority.high} high · ${stats.by_priority.normal} normal · ${stats.by_priority.low} low`
                  : undefined,
              },
              { label: 'By model', value: byModel || undefined },
            ]}
          />
        )}
      </Panel.Body>
    </Panel>
  );
}
