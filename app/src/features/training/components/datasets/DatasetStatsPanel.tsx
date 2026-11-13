/**
 * @file DatasetStatsPanel.tsx
 * @description Dataset-wide statistics of the state and action vectors: min, max, mean and
 *              standard deviation per channel, one joint group at a time when the dataset names its groups
 * @feature training
 */

import { useMemo, useState } from 'react';
import { Sigma } from 'lucide-react';
import { DataTable, EmptyState, Panel, SegmentedControl, SkeletonText } from '@/shared/components/ui';
import type { DataTableColumn } from '@/shared/components/ui';
import type { ChannelGroup, DatasetModality, FeatureStats } from '../../types';
import { channelLabels, channelStats, formatStat, groupLabel, statsFrameCount } from './episodeFormat';
import type { ChannelStats } from './episodeFormat';

type Vector = 'state' | 'action';
const ALL = '__all__';

export interface DatasetStatsPanelProps {
  /** Keyed by feature, as `meta/stats.json` stores it; null when the dataset has none. */
  stats: Record<string, FeatureStats> | null;
  isLoading: boolean;
  /** Joint groups of the two vectors, when the dataset names them. */
  modality: DatasetModality | null;
  /** Channel names from `info.json`, used when they fit the vector and, beside groups, really name its channels. */
  names?: Partial<Record<Vector, string[]>>;
}

/** `observation.state` in a LeRobot stats file; `observation` in rows the older registration scripts wrote. */
function vectorStats(stats: Record<string, FeatureStats> | null, vector: Vector): FeatureStats | undefined {
  if (!stats) return undefined;
  return vector === 'state' ? (stats['observation.state'] ?? stats.observation) : stats.action;
}

interface Row extends ChannelStats {
  label: string;
}

const numeric = (key: 'min' | 'max' | 'mean' | 'std', header: string): DataTableColumn<Row> => ({
  key,
  header,
  align: 'right',
  className: 'tabular-nums',
  cell: (row) => formatStat(row[key]),
});

const COLUMNS: DataTableColumn<Row>[] = [
  { key: 'label', header: 'Channel', cell: (row) => row.label },
  numeric('min', 'Min'),
  numeric('max', 'Max'),
  numeric('mean', 'Mean'),
  numeric('std', 'Std'),
];

export function DatasetStatsPanel({ stats, isLoading, modality, names }: DatasetStatsPanelProps) {
  const available = useMemo(
    () => (['state', 'action'] as const).filter((v) => channelStats(vectorStats(stats, v)).length > 0),
    [stats],
  );
  const [pickedVector, setPickedVector] = useState<Vector>('state');
  const [pickedGroup, setPickedGroup] = useState<string | null>(null);
  const vector = available.includes(pickedVector) ? pickedVector : available[0];

  const feature = vector ? vectorStats(stats, vector) : undefined;
  const rows = useMemo<Row[]>(() => {
    const channels = channelStats(feature);
    const groups = (vector && modality?.[vector]) || [];
    const named = vector ? names?.[vector] : undefined;
    // Inside a group a channel keeps its own name when info.json really names
    // every channel (TASK-494); without groups the names are shown as they are.
    const labels = groups.length > 0 || named?.length !== channels.length
      ? channelLabels(groups, channels.length, named)
      : named;
    return channels.map((c) => ({ ...c, label: labels[c.index] ?? `ch[${c.index}]` }));
  }, [feature, vector, modality, names]);

  const groups: ChannelGroup[] = (vector && modality?.[vector]) || [];
  const group = groups.find((g) => g.name === pickedGroup) ?? (pickedGroup === ALL ? null : groups[0] ?? null);
  const visible = group ? rows.slice(group.start, group.end) : rows;
  const frames = statsFrameCount(feature);

  return (
    <Panel padding="none" data-testid="dataset-stats-panel">
      <Panel.Header
        title="Statistics"
        titleAs="h2"
        description={
          vector
            ? `Per channel, across ${frames ? `${frames.toLocaleString('en-US')} frames of ` : ''}the whole dataset.`
            : undefined
        }
        actions={
          available.length > 1 && vector && (
            <SegmentedControl
              label="Vector"
              size="sm"
              options={[{ value: 'state', label: 'State' }, { value: 'action', label: 'Action' }]}
              value={vector}
              onChange={setPickedVector}
            />
          )
        }
      />
      {isLoading ? (
        <Panel.Body><SkeletonText lines={4} /></Panel.Body>
      ) : !vector ? (
        <Panel.Body>
          <EmptyState
            size="sm"
            icon={<Sigma />}
            title="No statistics for this dataset"
            description="It ships neither meta/stats.json nor per-episode statistics."
          />
        </Panel.Body>
      ) : (
        <>
          {groups.length > 0 && (
            <div className="border-b border-line-subtle px-5 py-3">
              <SegmentedControl
                label="Statistics joint group"
                size="sm"
                options={[
                  ...groups.map((g) => ({ value: g.name, label: groupLabel(g.name), title: `Channels ${g.start}–${g.end - 1}` })),
                  { value: ALL, label: 'All' },
                ]}
                value={group ? group.name : ALL}
                onChange={setPickedGroup}
              />
            </div>
          )}
          <div className="max-h-[420px] overflow-y-auto">
            <DataTable
              dense
              caption={`${vector === 'state' ? 'State' : 'Action'} statistics per channel`}
              columns={COLUMNS}
              rows={visible}
              getRowId={(row) => String(row.index)}
              rowProps={(row) => ({ 'data-testid': `stats-row-${row.index}` })}
            />
          </div>
        </>
      )}
    </Panel>
  );
}
