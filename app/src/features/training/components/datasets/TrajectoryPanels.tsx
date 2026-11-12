/**
 * @file TrajectoryPanels.tsx
 * @description Joint trajectory chart (state solid, action dashed; one joint group at a time when
 *              the dataset names its groups) and the reward-model progress curve
 * @feature training
 */

import { useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Activity } from 'lucide-react';
import { EmptyState, ErrorState, Panel, SegmentedControl, SkeletonText, StatusTag, chartColors, chartSeriesColor, chartTheme } from '@/shared/components/ui';
import type { EpisodeReward } from '@/features/evaluation/types/evaluation.types';
import type { ChannelGroup, FrameData } from '../../types';
import { groupLabel, mostActiveGroup, scoreTone } from './episodeFormat';

/**
 * The size a chart assumes before its container is measured. Recharts' default
 * is -1 × -1, which logs "The width(-1) and height(-1) of chart should be
 * greater than 0" on every mount; the first ResizeObserver tick replaces this.
 */
export const CHART_INITIAL_SIZE = { width: 1, height: 1 } as const;

export interface JointChartPanelProps {
  frames: FrameData[];
  jointNames: string[];
  /**
   * Joint groups of the vector (`meta/modality.json`). When given, the chart
   * draws one group at a time and offers the others, instead of every channel
   * at once — a G1 vector is 43 wide.
   */
  groups?: ChannelGroup[];
  isLoading: boolean;
  currentTime: number;
  /** Why the frames could not be loaded; shown instead of the chart. */
  error?: string | null;
  onRetry?: () => void;
}

const tsFormat = (v: number) => v.toFixed(1);
const labelFormat = (v: unknown) => `t = ${Number(v).toFixed(2)}s`;
/** Past the palette's six colours a series repeats one; it is drawn fainter so the two stay apart. */
const seriesOpacity = (k: number) => (k < chartColors.series.length ? 1 : 0.5);

export function JointChartPanel({ frames, jointNames, groups, isLoading, currentTime, error, onRetry }: JointChartPanelProps) {
  // The viewer's choice, kept across episodes; until they make one, the group
  // that moves most in the episode on screen.
  const [pickedGroup, setPickedGroup] = useState<string | null>(null);
  const autoGroup = useMemo(() => (groups?.length ? mostActiveGroup(groups, frames) : null), [groups, frames]);
  const activeGroup = groups?.length
    ? (groups.find((g) => g.name === pickedGroup) ?? groups.find((g) => g.name === autoGroup) ?? groups[0]!)
    : null;

  /** The channels on the chart: the active group's, or all of them. */
  const channels = useMemo(() => {
    const all = jointNames.map((name, index) => ({ name, index }));
    return activeGroup ? all.slice(activeGroup.start, activeGroup.end) : all;
  }, [jointNames, activeGroup]);

  const data = useMemo(
    () =>
      frames.map((frame) => {
        const point: Record<string, number> = { timestamp: frame.timestamp };
        for (const { name, index } of channels) {
          point[`action_${name}`] = frame.action[index] ?? 0;
          point[`obs_${name}`] = frame.observationState[index] ?? 0;
        }
        return point;
      }),
    [frames, channels],
  );

  return (
    <Panel>
      <Panel.Header
        title="Joint trajectories"
        titleAs="h2"
        description={data.length > 0 ? `${frames.length} samples · solid = state, dashed = action` : undefined}
      />
      <Panel.Body>
        {isLoading ? (
          <SkeletonText lines={5} />
        ) : error ? (
          <ErrorState size="sm" title="Couldn't load this episode's frames" message={error} onRetry={onRetry} />
        ) : data.length === 0 ? (
          <EmptyState size="sm" icon={<Activity />} title="No trajectory data for this episode" />
        ) : (
          <>
            {groups && activeGroup && (
              <SegmentedControl
                label="Joint group"
                size="sm"
                className="mb-3"
                options={groups.map((g) => ({ value: g.name, label: groupLabel(g.name), title: `Channels ${g.start}–${g.end - 1}` }))}
                value={activeGroup.name}
                onChange={setPickedGroup}
              />
            )}
            <div className="h-[200px] sm:h-[280px]">
              <ResponsiveContainer width="100%" height="100%" initialDimension={CHART_INITIAL_SIZE}>
                <LineChart data={data}>
                  <CartesianGrid {...chartTheme.grid} />
                  <XAxis dataKey="timestamp" type="number" domain={['dataMin', 'dataMax']} tickFormatter={tsFormat} {...chartTheme.xAxis} />
                  <YAxis {...chartTheme.yAxis} width={40} />
                  <Tooltip {...chartTheme.tooltip} labelFormatter={labelFormat} />
                  {channels.map(({ name }, k) => (
                    <Line key={`obs_${name}`} type="monotone" dataKey={`obs_${name}`} stroke={chartSeriesColor(k)} strokeOpacity={seriesOpacity(k)} dot={false} strokeWidth={1.5} name={`state:${name}`} isAnimationActive={false} />
                  ))}
                  {channels.map(({ name }, k) => (
                    <Line key={`action_${name}`} type="monotone" dataKey={`action_${name}`} stroke={chartSeriesColor(k)} strokeOpacity={seriesOpacity(k)} dot={false} strokeWidth={1} strokeDasharray="4 2" name={`action:${name}`} isAnimationActive={false} />
                  ))}
                  {currentTime > 0 && <ReferenceLine x={currentTime} stroke={chartColors.primary} strokeWidth={1.5} />}
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1" data-testid="joint-chart-legend">
              {channels.map(({ name }, k) => (
                <span key={name} className="flex items-center gap-1.5 text-xs text-ink-tertiary">
                  <span className="inline-block h-0.5 w-3 rounded-full" style={{ backgroundColor: chartSeriesColor(k), opacity: seriesOpacity(k) }} />
                  {name}
                </span>
              ))}
            </div>
          </>
        )}
      </Panel.Body>
    </Panel>
  );
}

export interface RewardCurvePanelProps {
  reward: EpisodeReward;
  fallbackFps: number;
  currentTime: number;
}

/** The reward model's per-episode progress curve (LeRobot 0.6.0, TASK-179). */
export function RewardCurvePanel({ reward, fallbackFps, currentTime }: RewardCurvePanelProps) {
  // `fps` is the CURVE's sampling rate: t(curve[j]) ≈ (j + 1) / fps.
  const data = useMemo(() => {
    const fps = reward.fps ?? fallbackFps;
    return reward.curve.map((value, i) => ({ timestamp: +((i + 1) / fps).toFixed(3), progress: value }));
  }, [reward, fallbackFps]);
  if (data.length < 2) return null;

  const outcome = reward.success === null ? '' : reward.success ? ' · success' : ' · failure';
  return (
    <Panel>
      <Panel.Header
        title="Task progress"
        titleAs="h2"
        description={reward.rewardType}
        actions={<StatusTag tone={scoreTone(reward.score)}>Score {reward.score.toFixed(2)}{outcome}</StatusTag>}
      />
      <Panel.Body>
        <div className="h-[140px]">
          <ResponsiveContainer width="100%" height="100%" initialDimension={CHART_INITIAL_SIZE}>
            <LineChart data={data}>
              <CartesianGrid {...chartTheme.grid} />
              <XAxis dataKey="timestamp" type="number" domain={['dataMin', 'dataMax']} tickFormatter={tsFormat} {...chartTheme.xAxis} />
              <YAxis domain={[0, 1]} {...chartTheme.yAxis} width={40} />
              <Tooltip {...chartTheme.tooltip} labelFormatter={labelFormat} formatter={(v) => [Number(v).toFixed(3), 'progress']} />
              <Line type="monotone" dataKey="progress" stroke={chartColors.accent} dot={false} strokeWidth={1.75} isAnimationActive={false} />
              {currentTime > 0 && <ReferenceLine x={currentTime} stroke={chartColors.primary} strokeWidth={1.5} />}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Panel.Body>
    </Panel>
  );
}
