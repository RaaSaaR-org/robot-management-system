/**
 * @file TrajectoryPanels.tsx
 * @description Joint trajectory chart (state solid, action dashed) and the reward-model progress curve
 * @feature training
 */

import { useMemo } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Activity } from 'lucide-react';
import { EmptyState, Panel, SkeletonText, StatusTag, chartColors, chartSeriesColor, chartTheme } from '@/shared/components/ui';
import type { EpisodeReward } from '@/features/evaluation/types/evaluation.types';
import type { FrameData } from '../../types';
import { scoreTone } from './episodeFormat';

export interface JointChartPanelProps {
  frames: FrameData[];
  jointNames: string[];
  isLoading: boolean;
  currentTime: number;
}

const tsFormat = (v: number) => v.toFixed(1);
const labelFormat = (v: unknown) => `t = ${Number(v).toFixed(2)}s`;

export function JointChartPanel({ frames, jointNames, isLoading, currentTime }: JointChartPanelProps) {
  const data = useMemo(
    () =>
      frames.map((frame) => {
        const point: Record<string, number> = { timestamp: frame.timestamp };
        jointNames.forEach((name, i) => {
          point[`action_${name}`] = frame.action[i] ?? 0;
          point[`obs_${name}`] = frame.observationState[i] ?? 0;
        });
        return point;
      }),
    [frames, jointNames],
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
        ) : data.length === 0 ? (
          <EmptyState size="sm" icon={<Activity />} title="No trajectory data for this episode" />
        ) : (
          <>
            <div className="h-[200px] sm:h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data}>
                  <CartesianGrid {...chartTheme.grid} />
                  <XAxis dataKey="timestamp" type="number" domain={['dataMin', 'dataMax']} tickFormatter={tsFormat} {...chartTheme.xAxis} />
                  <YAxis {...chartTheme.yAxis} width={40} />
                  <Tooltip {...chartTheme.tooltip} labelFormatter={labelFormat} />
                  {jointNames.map((name, i) => (
                    <Line key={`obs_${name}`} type="monotone" dataKey={`obs_${name}`} stroke={chartSeriesColor(i)} dot={false} strokeWidth={1.5} name={`state:${name}`} isAnimationActive={false} />
                  ))}
                  {jointNames.map((name, i) => (
                    <Line key={`action_${name}`} type="monotone" dataKey={`action_${name}`} stroke={chartSeriesColor(i)} dot={false} strokeWidth={1} strokeDasharray="4 2" name={`action:${name}`} isAnimationActive={false} />
                  ))}
                  {currentTime > 0 && <ReferenceLine x={currentTime} stroke={chartColors.primary} strokeWidth={1.5} />}
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
              {jointNames.map((name, i) => (
                <span key={name} className="flex items-center gap-1.5 text-xs text-ink-tertiary">
                  <span className="inline-block h-0.5 w-3 rounded-full" style={{ backgroundColor: chartSeriesColor(i) }} />
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
          <ResponsiveContainer width="100%" height="100%">
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
