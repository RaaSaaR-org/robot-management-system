/**
 * @file TrajectoryPanels.tsx
 * @description Joint trajectory chart (state solid, action dashed; one joint group at a time when
 *              the dataset names its groups; a left/right pair of joints in one hue) with the
 *              playback cursor, and the reward-model progress curve
 * @feature training
 */

import { useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, useChartWidth } from 'recharts';
import { Activity } from 'lucide-react';
import { EmptyState, ErrorState, Panel, SegmentedControl, SkeletonText, StatusTag, chartChannelColor, chartColors, chartTheme } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import { focusRing } from '@/shared/components/ui/styles';
import type { EpisodeReward } from '@/features/evaluation/types/evaluation.types';
import type { ChannelGroup, FrameData } from '../../types';
import { channelSides, cursorFraction, groupLabel, mostActiveGroup, scoreTone, shortChannelNames } from './episodeFormat';

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

/**
 * The right-hand joint of a pair: its left twin's hue, stepped back towards the
 * panel behind it (deeper on the dark theme, lighter on the light one), so the
 * two read as one joint on two sides instead of as two unrelated lines.
 */
export function rightSideColor(color: string): string {
  return `color-mix(in oklab, ${color} 55%, var(--bg-secondary))`;
}

/** One line pair (state + action) of the chart. */
interface Channel {
  /** The channel's full name: the data key. */
  name: string;
  /** Its position in the vector. */
  index: number;
  /** What the tooltip shows: the name without a suffix every channel shares. */
  label: string;
  color: string;
  /** The legend entry it belongs to. */
  entry: string;
  /** Its side of the body, when the channels on screen are left/right pairs. */
  side?: 'left' | 'right';
}

/**
 * One entry of the legend: a channel, or the left and right joint of a pair
 * under one name (`elbow`) with a swatch each.
 */
interface LegendEntry {
  key: string;
  label: string;
  /** The full channel names behind it, for hover. */
  title: string;
  /** One colour, or `[left, right]` — null where the pair has no joint on that side. */
  swatches: Array<string | null>;
}

/**
 * The channels on screen with their colours, and the legend for them. Both
 * arms on one chart are fourteen joints, more than there are colours and more
 * than a legend can list beside a video: when every name starts with `left_`
 * or `right_`, a pair shares its hue and its legend entry.
 */
function layoutChannels(shown: Array<{ name: string; index: number }>): { channels: Channel[]; legend: LegendEntry[]; paired: boolean } {
  const labels = shortChannelNames(shown.map((c) => c.name));
  const sides = channelSides(labels);
  if (!sides) {
    const channels = shown.map((c, k) => ({ ...c, label: labels[k]!, color: chartChannelColor(k), entry: c.name }));
    const legend = channels.map((c) => ({ key: c.name, label: c.label, title: c.name, swatches: [c.color] }));
    return { channels, legend, paired: false };
  }
  const legend: LegendEntry[] = [];
  const names: string[][] = [];
  const channels = shown.map((c, k) => {
    const { side, joint } = sides[k]!;
    let at = legend.findIndex((e) => e.key === joint);
    if (at < 0) {
      at = legend.push({ key: joint, label: joint, title: '', swatches: [null, null] }) - 1;
      names.push([]);
    }
    const hue = chartChannelColor(at);
    const color = side === 'left' ? hue : rightSideColor(hue);
    legend[at]!.swatches[side === 'left' ? 0 : 1] = color;
    names[at]!.push(c.name);
    return { ...c, label: labels[k]!, color, entry: joint, side };
  });
  legend.forEach((entry, at) => { entry.title = names[at]!.join(' · '); });
  return { channels, legend, paired: true };
}

/** How far the other lines step back while one joint is picked out. */
const DIMMED_OPACITY = 0.18;

const tsFormat = (v: number) => v.toFixed(1);
const labelFormat = (v: unknown) => `t = ${Number(v).toFixed(2)}s`;
const valueFormat = (v: number | undefined, digits = 3) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(digits) : '–');

const TOOLTIP_TABLE = 'border-separate border-spacing-0 text-[11px] leading-[14px] tabular-nums';
const TOOLTIP_NUMBER = 'whitespace-nowrap pl-2 text-right';
const TOOLTIP_HEAD = 'pl-2 text-right font-normal';

function TooltipSwatch({ color }: { color: string }) {
  return <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ backgroundColor: color }} />;
}

/**
 * From this chart width on, a left/right pair is one row of the tooltip. Under
 * it — the chart beside the video — four number columns do not fit, and the
 * plot is tall enough there for a row per channel.
 */
const PAIRED_TOOLTIP_FROM_PX = 360;

/** Rows of the tooltip that fit over the low, wide plot under the videos. */
const TOOLTIP_ROWS = 8;
/** The width one column of channel rows takes, a full joint name included. */
const TOOLTIP_COLUMN_PX = 260;

/**
 * How many columns the rows of the tooltip are laid out in. One beside the
 * video, where the plot is tall. On the wide plot under the videos fourteen
 * `arms[i]` rows in one column hung out of the panel and the last were cut
 * off: there they go side by side, as many columns as the chart has room for.
 */
export function tooltipColumns(rows: number, chartWidth: number): number {
  if (chartWidth < PAIRED_TOOLTIP_FROM_PX) return 1;
  return Math.max(1, Math.min(Math.ceil(rows / TOOLTIP_ROWS), Math.floor(chartWidth / TOOLTIP_COLUMN_PX)));
}

/**
 * What the chart says under the pointer: a row per joint, its state and its
 * action side by side — and on a wide plot both sides of a left/right pair in
 * that one row, so two arms are seven rows that fit over a low plot. Recharts'
 * own list has a row per line with every digit of the float: twenty-eight.
 */
function JointTooltip({ point, time, channels }: { point: Record<string, number>; time: unknown; channels: Channel[] }) {
  const width = useChartWidth() ?? 0;
  const wide = width >= PAIRED_TOOLTIP_FROM_PX;
  const paired = wide && channels.length > 0 && channels.every((c) => c.side);
  const columns = paired ? 1 : tooltipColumns(channels.length, width);
  const perColumn = Math.ceil(channels.length / columns);
  const joints = paired ? [...new Set(channels.map((c) => c.entry))] : [];
  const cells = (c: Channel | undefined, digits: number) => (
    <>
      <td className={TOOLTIP_NUMBER}>
        {c && <TooltipSwatch color={c.color} />}
        {c ? valueFormat(point[`obs_${c.name}`], digits) : ''}
      </td>
      <td className={TOOLTIP_NUMBER}>{c ? valueFormat(point[`action_${c.name}`], digits) : ''}</td>
    </>
  );
  return (
    <div style={chartTheme.tooltip.contentStyle} data-testid="joint-chart-tooltip">
      <p style={chartTheme.tooltip.labelStyle}>{labelFormat(time)}</p>
      {paired ? (
        <table className={TOOLTIP_TABLE}>
          <thead className="text-ink-tertiary">
            <tr>
              <th />
              <th colSpan={2} className={TOOLTIP_HEAD}>left</th>
              <th colSpan={2} className={TOOLTIP_HEAD}>right</th>
            </tr>
            <tr>
              <th />
              <th className={TOOLTIP_HEAD}>state</th>
              <th className={TOOLTIP_HEAD}>action</th>
              <th className={TOOLTIP_HEAD}>state</th>
              <th className={TOOLTIP_HEAD}>action</th>
            </tr>
          </thead>
          <tbody>
            {joints.map((joint) => (
              <tr key={joint}>
                <th scope="row" className="whitespace-nowrap text-left font-normal">{joint}</th>
                {cells(channels.find((c) => c.entry === joint && c.side === 'left'), 2)}
                {cells(channels.find((c) => c.entry === joint && c.side === 'right'), 2)}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="flex items-start gap-4">
          {Array.from({ length: columns }, (_, column) => (
            <table key={column} className={TOOLTIP_TABLE}>
              <thead className="text-ink-tertiary">
                <tr>
                  <th />
                  <th className={TOOLTIP_HEAD}>state</th>
                  <th className={TOOLTIP_HEAD}>action</th>
                </tr>
              </thead>
              <tbody>
                {channels.slice(column * perColumn, (column + 1) * perColumn).map((c) => (
                  <tr key={c.name}>
                    <th scope="row" className="whitespace-nowrap text-left font-normal">
                      <TooltipSwatch color={c.color} />
                      {c.label}
                    </th>
                    <td className={TOOLTIP_NUMBER}>{valueFormat(point[`obs_${c.name}`])}</td>
                    <td className={TOOLTIP_NUMBER}>{valueFormat(point[`action_${c.name}`])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        </div>
      )}
    </div>
  );
}

const TOOLTIP_ESCAPE = { x: false, y: true } as const;
const TOOLTIP_WRAPPER = { zIndex: 20 } as const;
const TOOLTIP_POSITION = { y: 0 } as const;
const ACTIVE_DOT = { r: 3, strokeWidth: 0 } as const;

export function JointChartPanel({ frames, sampleCount, jointNames, groups, isLoading, currentTime, isPlaying = false, error, onRetry, className }: JointChartPanelProps) {
  // The viewer's choice, kept across episodes; until they make one, the group
  // that moves most in the episode on screen.
  const [pickedGroup, setPickedGroup] = useState<string | null>(null);
  const autoGroup = useMemo(() => (groups?.length ? mostActiveGroup(groups, frames) : null), [groups, frames]);
  const activeGroup = groups?.length
    ? (groups.find((g) => g.name === pickedGroup) ?? groups.find((g) => g.name === autoGroup) ?? groups[0]!)
    : null;

  /** The channels on the chart: the active group's, or all of them. */
  const { channels, legend, paired } = useMemo(() => {
    const all = jointNames.map((name, index) => ({ name, index }));
    return layoutChannels(activeGroup ? all.slice(activeGroup.start, activeGroup.end) : all);
  }, [jointNames, activeGroup]);

  // One joint picked out of the crowd: hovering its legend entry previews it,
  // a click keeps it. An entry that is no longer on the chart picks nothing.
  const [pinned, setPinned] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const wanted = hovered ?? pinned;
  const focused = legend.some((e) => e.key === wanted) ? wanted : null;

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
          <Tooltip
            cursor={chartTheme.tooltip.cursor}
            allowEscapeViewBox={TOOLTIP_ESCAPE}
            wrapperStyle={TOOLTIP_WRAPPER}
            isAnimationActive={false}
            // From the top of the plot down: the panel cuts off what hangs below it.
            position={TOOLTIP_POSITION}
            content={({ active, payload, label }) => {
              const point = payload?.[0]?.payload as Record<string, number> | undefined;
              if (!active || !point) return null;
              return <JointTooltip point={point} time={label} channels={focused ? channels.filter((c) => c.entry === focused) : channels} />;
            }}
          />
          {channels.map(({ name, label, color, entry }) => (
            <Line key={`obs_${name}`} type="monotone" dataKey={`obs_${name}`} stroke={color} strokeOpacity={focused && focused !== entry ? DIMMED_OPACITY : 1} dot={false} activeDot={focused && focused !== entry ? false : ACTIVE_DOT} strokeWidth={focused === entry ? 2.25 : 1.5} name={`state:${label}`} isAnimationActive={false} />
          ))}
          {channels.map(({ name, label, color, entry }) => (
            <Line key={`action_${name}`} type="monotone" dataKey={`action_${name}`} stroke={color} strokeOpacity={focused && focused !== entry ? DIMMED_OPACITY : 1} dot={false} activeDot={focused && focused !== entry ? false : ACTIVE_DOT} strokeWidth={focused === entry ? 1.75 : 1} strokeDasharray="4 2" name={`action:${label}`} isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    ),
    [data, channels, focused],
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
            <div
              // Seven pairs and their key are four lines beside the video; any
              // other legend keeps to three and scrolls, so the plot stays tall.
              className={cn('mt-2 flex shrink-0 flex-wrap gap-x-3 gap-y-1 lg:overflow-y-auto', paired ? 'lg:max-h-[5rem]' : 'lg:max-h-[3.75rem]')}
              data-testid="joint-chart-legend"
            >
              {paired && (
                // Which swatch of a pair is which: every entry keeps this order.
                <span className="flex items-center gap-1.5 whitespace-nowrap text-xs text-ink-tertiary" data-testid="joint-chart-side-key">
                  left
                  <span className="inline-block h-1 w-3.5 rounded-full" style={{ backgroundColor: chartChannelColor(0) }} />
                  <span className="inline-block h-1 w-3.5 rounded-full" style={{ backgroundColor: rightSideColor(chartChannelColor(0)) }} />
                  right
                </span>
              )}
              {legend.map(({ key, label, title, swatches }) => (
                <button
                  key={key}
                  type="button"
                  // The whole name on hover: the legend drops what every joint shares.
                  title={title}
                  aria-pressed={pinned === key}
                  onClick={() => setPinned((p) => (p === key ? null : key))}
                  onMouseEnter={() => setHovered(key)}
                  onMouseLeave={() => setHovered(null)}
                  className={cn(
                    'flex items-center gap-1.5 whitespace-nowrap rounded-tag text-xs text-ink-secondary transition-opacity hover:text-ink-primary',
                    focused && focused !== key && 'opacity-50',
                    pinned === key && 'font-medium text-ink-primary',
                    focusRing,
                  )}
                >
                  {swatches.map((color, side) => (
                    <span
                      key={side}
                      className="inline-block h-1 w-3.5 rounded-full"
                      style={color ? { backgroundColor: color } : undefined}
                      data-testid="joint-chart-swatch"
                    />
                  ))}
                  {label}
                </button>
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
