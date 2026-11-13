/**
 * @file TrajectoryPanels.tsx
 * @description Joint trajectory chart (state solid, action dashed; one joint group at a time when
 *              the dataset names its groups) with the playback cursor, and the reward-model
 *              progress curve
 * @feature training
 */

import { useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Activity } from 'lucide-react';
import { EmptyState, ErrorState, Panel, SegmentedControl, SkeletonText, StatusTag, chartChannelColor, chartColors, chartTheme } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import type { EpisodeReward } from '@/features/evaluation/types/evaluation.types';
import type { ChannelGroup, FrameData } from '../../types';
import { cursorFraction, groupLabel, mostActiveGroup, scoreTone } from './episodeFormat';

/**
 * The size a chart assumes before its container is measured. Recharts' default
 * is -1 × -1, which logs "The width(-1) and height(-1) of chart should be
 * greater than 0" on every mount; the first ResizeObserver tick replaces this.
 */
export const CHART_INITIAL_SIZE = { width: 1, height: 1 } as const;

/**
 * The plot's frame inside the chart box, in px. Fixed here because the
 * playback cursor is drawn over the chart rather than inside it and has to
 * land on the same pixels: the y axis takes `Y_AXIS_WIDTH` on the left, the x
 * axis `X_AXIS_HEIGHT` at the bottom, the margins the rest.
 */
const PLOT_MARGIN = { top: 6, right: 10, bottom: 0, left: 0 } as const;
const Y_AXIS_WIDTH = 40;
const X_AXIS_HEIGHT = 24;

export interface JointChartPanelProps {
  frames: FrameData[];
  /**
   * How many frames the episode has, when `frames` is a thinned-out selection
   * of them (the page asks for at most a few hundred). Defaults to `frames.length`.
   */
  sampleCount?: number | null;
  jointNames: string[];
  /**
   * Joint groups of the vector (`meta/modality.json`). When given, the chart
   * draws one group at a time and offers the others, instead of every channel
   * at once — a G1 vector is 43 wide.
   */
  groups?: ChannelGroup[];
  isLoading: boolean;
  currentTime: number;
  /** The video is running: the cursor glides between two time updates instead of stepping. */
  isPlaying?: boolean;
  /** Why the frames could not be loaded; shown instead of the chart. */
  error?: string | null;
  onRetry?: () => void;
  /**
   * Sizing comes from the parent (`lg:h-full` in the episode page's stage): on
   * a wide screen the plot then takes whatever height is left in the panel.
   */
  className?: string;
}

const tsFormat = (v: number) => v.toFixed(1);
const labelFormat = (v: unknown) => `t = ${Number(v).toFixed(2)}s`;

export function JointChartPanel({ frames, sampleCount, jointNames, groups, isLoading, currentTime, isPlaying = false, error, onRetry, className }: JointChartPanelProps) {
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

  // The lines are drawn once per episode and group. The cursor is not part of
  // them: it moves several times a second, and redrawing fourteen 600-point
  // lines for each move made playback stutter.
  const plot = useMemo(
    () => (
      <ResponsiveContainer width="100%" height="100%" initialDimension={CHART_INITIAL_SIZE}>
        <LineChart data={data} margin={PLOT_MARGIN}>
          <CartesianGrid {...chartTheme.grid} />
          <XAxis dataKey="timestamp" type="number" domain={['dataMin', 'dataMax']} tickFormatter={tsFormat} {...chartTheme.xAxis} height={X_AXIS_HEIGHT} />
          <YAxis {...chartTheme.yAxis} width={Y_AXIS_WIDTH} />
          <Tooltip {...chartTheme.tooltip} labelFormatter={labelFormat} />
          {channels.map(({ name }, k) => (
            <Line key={`obs_${name}`} type="monotone" dataKey={`obs_${name}`} stroke={chartChannelColor(k)} dot={false} strokeWidth={1.5} name={`state:${name}`} isAnimationActive={false} />
          ))}
          {channels.map(({ name }, k) => (
            <Line key={`action_${name}`} type="monotone" dataKey={`action_${name}`} stroke={chartChannelColor(k)} dot={false} strokeWidth={1} strokeDasharray="4 2" name={`action:${name}`} isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    ),
    [data, channels],
  );

  // Always on the chart: at 0 it sits on the first sample, past the last
  // sample (a video runs one frame longer) on the last.
  const cursor = cursorFraction(currentTime, frames[0]?.timestamp, frames[frames.length - 1]?.timestamp);
  const hasChart = !isLoading && !error && data.length > 0;

  return (
    <Panel padding="none" data-testid="joint-chart-panel" className={cn('flex flex-col lg:min-h-0', className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 pt-3">
        <h2 className="font-display text-base font-semibold tracking-[-0.01em] text-ink-primary">Joint trajectories</h2>
        {hasChart && (
          <p className="text-xs text-ink-tertiary">
            {sampleCount ?? frames.length} samples
            {sampleCount != null && sampleCount > frames.length ? ` (${frames.length} drawn)` : ''} · solid = state, dashed = action
          </p>
        )}
        {hasChart && groups && activeGroup && (
          <SegmentedControl
            label="Joint group"
            size="sm"
            className="ml-auto flex-wrap"
            options={groups.map((g) => ({ value: g.name, label: groupLabel(g.name), title: `Channels ${g.start}–${g.end - 1}` }))}
            value={activeGroup.name}
            onChange={setPickedGroup}
          />
        )}
      </div>
      <div className="flex flex-col px-4 pb-3 pt-2 lg:min-h-0 lg:flex-1">
        {isLoading ? (
          <SkeletonText lines={5} />
        ) : error ? (
          <ErrorState size="sm" title="Couldn't load this episode's frames" message={error} onRetry={onRetry} />
        ) : data.length === 0 ? (
          <EmptyState size="sm" icon={<Activity />} title="No trajectory data for this episode" />
        ) : (
          <>
            <div className="relative h-[200px] lg:h-auto lg:min-h-[96px] lg:flex-1" data-testid="joint-chart-plot">
              <div className="absolute inset-0">{plot}</div>
              {cursor !== null && (
                <div
                  aria-hidden
                  data-testid="joint-chart-cursor"
                  data-position={cursor.toFixed(3)}
                  className="pointer-events-none absolute w-0.5 -translate-x-1/2 rounded-full bg-primary"
                  style={{
                    top: PLOT_MARGIN.top,
                    bottom: X_AXIS_HEIGHT + PLOT_MARGIN.bottom,
                    left: `calc(${Y_AXIS_WIDTH + PLOT_MARGIN.left}px + (100% - ${Y_AXIS_WIDTH + PLOT_MARGIN.left + PLOT_MARGIN.right}px) * ${cursor})`,
                    // A time update arrives about four times a second; gliding
                    // to it reads as motion, jumping to it reads as lag. A seek
                    // while paused lands at once.
                    transition: isPlaying ? 'left 250ms linear' : undefined,
                  }}
                />
              )}
            </div>
            <div className="mt-2 flex shrink-0 flex-wrap gap-x-3 gap-y-1 lg:max-h-[3.75rem] lg:overflow-y-auto" data-testid="joint-chart-legend">
              {channels.map(({ name }, k) => (
                <span key={name} className="flex items-center gap-1.5 whitespace-nowrap text-xs text-ink-secondary">
                  <span className="inline-block h-1 w-3.5 rounded-full" style={{ backgroundColor: chartChannelColor(k) }} />
                  {name}
                </span>
              ))}
            </div>
          </>
        )}
      </div>
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

  // Kept inside the curve's own span, so the cursor is there at 0 and at the end.
  const first = data[0]!.timestamp;
  const last = data[data.length - 1]!.timestamp;
  const cursorAt = Math.min(last, Math.max(first, Number.isFinite(currentTime) ? currentTime : first));

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
              <ReferenceLine x={cursorAt} stroke={chartColors.primary} strokeWidth={1.5} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Panel.Body>
    </Panel>
  );
}
