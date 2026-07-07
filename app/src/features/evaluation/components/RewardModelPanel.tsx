/**
 * @file RewardModelPanel.tsx
 * @description Reward-model evaluation panel — scores dataset episodes with
 * Robometer / TOPReward (LeRobot 0.6.0) and renders per-episode task-progress
 * curves plus a score table. (TASK-179)
 * @feature evaluation
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { Gauge, Play } from 'lucide-react';
import { Button } from '@/shared/components/ui';
import { trainingApi } from '@/features/training/api/trainingApi';
import type { Dataset } from '@/features/training/types/training.types';
import type { EpisodeReward, RewardType, RewardModelJobStatus } from '../types';
import { evaluationApi } from '../api';

const EPISODE_COLORS = ['#2563eb', '#dc2626', '#16a34a', '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16'];

const POLL_INTERVAL_MS = 3000;

/** Consecutive failed polls after which polling gives up (~30s of silence). */
const MAX_POLL_FAILURES = 10;

const RUNNING_STATUSES = new Set(['pending', 'queued', 'running']);

/**
 * Resamples every episode curve onto a shared 0–100 % x-axis so episodes of
 * different lengths overlay in a single chart. Linear interpolation.
 */
function buildCurveChartData(rewards: EpisodeReward[]): {
  data: Record<string, number>[];
  episodeKeys: { key: string; episodeIndex: number }[];
} {
  const withCurves = rewards.filter((r) => r.curve.length > 1);
  const episodeKeys = withCurves.map((r) => ({
    key: `ep${r.episodeIndex}`,
    episodeIndex: r.episodeIndex,
  }));

  const data: Record<string, number>[] = [];
  for (let pct = 0; pct <= 100; pct += 2) {
    const point: Record<string, number> = { pct };
    for (const r of withCurves) {
      const pos = (pct / 100) * (r.curve.length - 1);
      const lo = Math.floor(pos);
      const hi = Math.min(lo + 1, r.curve.length - 1);
      const frac = pos - lo;
      point[`ep${r.episodeIndex}`] = +(r.curve[lo] + (r.curve[hi] - r.curve[lo]) * frac).toFixed(4);
    }
    data.push(point);
  }
  return { data, episodeKeys };
}

function scoreColorCls(score: number): string {
  if (score > 0.7) return 'text-green-400 bg-green-500/10';
  if (score > 0.4) return 'text-orange-400 bg-orange-500/10';
  return 'text-red-400 bg-red-500/10';
}

export function RewardModelPanel() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [datasetId, setDatasetId] = useState<string>('');
  const [rewardType, setRewardType] = useState<RewardType>('robometer');
  const [rewards, setRewards] = useState<EpisodeReward[]>([]);
  const [job, setJob] = useState<RewardModelJobStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load ready datasets once
  useEffect(() => {
    trainingApi
      .listDatasets({ status: 'ready' })
      .then((res) => {
        setDatasets(res.datasets);
        if (res.datasets.length > 0) setDatasetId((prev) => prev || res.datasets[0].id);
      })
      .catch(() => setDatasets([]));
  }, []);

  // Load stored rewards whenever the dataset changes
  useEffect(() => {
    if (!datasetId) {
      setRewards([]);
      return;
    }
    evaluationApi
      .listRewards(datasetId)
      .then(setRewards)
      .catch(() => setRewards([]));
  }, [datasetId]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // Clean up the poll interval on unmount
  useEffect(() => stopPolling, [stopPolling]);

  const pollInFlightRef = useRef(false);
  const pollFailuresRef = useRef(0);

  const pollJob = useCallback(
    (jobId: string) => {
      stopPolling();
      pollInFlightRef.current = false;
      pollFailuresRef.current = 0;
      pollRef.current = setInterval(async () => {
        // Skip the tick while the previous request is still in flight so a
        // slow server never accumulates overlapping polls.
        if (pollInFlightRef.current) return;
        pollInFlightRef.current = true;
        try {
          const res = await evaluationApi.getRewardModelEval(jobId);
          pollFailuresRef.current = 0;
          setJob(res.job);
          if (res.rewards.length > 0) setRewards(res.rewards);
          if (!RUNNING_STATUSES.has(res.job.status)) {
            stopPolling();
            if (res.job.status === 'failed') {
              setError(res.job.error ?? 'Reward-model evaluation failed');
            }
          }
        } catch {
          // Transient poll errors are retried, but persistent failure (job
          // deleted, server gone) must not poll forever.
          pollFailuresRef.current += 1;
          if (pollFailuresRef.current >= MAX_POLL_FAILURES) {
            stopPolling();
            setJob(null);
            setError('Lost contact with the reward-model job — polling stopped.');
          }
        } finally {
          pollInFlightRef.current = false;
        }
      }, POLL_INTERVAL_MS);
    },
    [stopPolling]
  );

  const handleStart = useCallback(async () => {
    if (!datasetId) return;
    setError(null);
    setStarting(true);
    try {
      const { jobId } = await evaluationApi.createRewardModelEval({ datasetId, rewardType });
      setJob({ id: jobId, status: 'pending', progress: 0 });
      pollJob(jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start reward-model evaluation');
    } finally {
      setStarting(false);
    }
  }, [datasetId, rewardType, pollJob]);

  const isRunning = job !== null && RUNNING_STATUSES.has(job.status);
  const { data: curveData, episodeKeys } = buildCurveChartData(rewards);
  const sortedRewards = [...rewards].sort((a, b) => a.episodeIndex - b.episodeIndex);

  return (
    <div className="rounded-lg border border-theme section-primary p-5 min-w-0 overflow-hidden">
      <div className="flex items-center gap-2 mb-1">
        <Gauge className="w-5 h-5 text-cobalt-400" />
        <h2 className="text-lg font-semibold text-theme-primary">Reward-Model Evaluation</h2>
      </div>
      <p className="text-sm text-theme-secondary mb-4">
        Score dataset episodes with a VLM reward model (LeRobot 0.6.0) — per-frame task-progress
        curves + episode scores, no simulator needed.
      </p>

      {/* Controls */}
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <label className="flex flex-col gap-1 text-xs font-medium text-theme-secondary">
          Dataset
          <select
            value={datasetId}
            onChange={(e) => setDatasetId(e.target.value)}
            disabled={isRunning}
            className="px-3 py-2 text-sm rounded-md border border-theme bg-theme-elevated text-theme-primary min-w-[220px]"
          >
            {datasets.length === 0 && <option value="">No ready datasets</option>}
            {datasets.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.demonstrationCount} eps)
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium text-theme-secondary">
          Reward model
          <select
            value={rewardType}
            onChange={(e) => setRewardType(e.target.value as RewardType)}
            disabled={isRunning}
            className="px-3 py-2 text-sm rounded-md border border-theme bg-theme-elevated text-theme-primary"
          >
            <option value="robometer">Robometer — per-frame task progress</option>
            <option value="topreward">TOPReward — zero-shot VLM log-probs</option>
          </select>
        </label>

        <Button onClick={handleStart} disabled={!datasetId || starting || isRunning}>
          <Play className="w-4 h-4 mr-2" />
          {isRunning ? 'Scoring…' : 'Score episodes'}
        </Button>

        {job && (
          <span className="text-xs text-theme-tertiary pb-2">
            Job {job.id.slice(0, 8)} — {job.status}
            {isRunning ? ` (${Math.round(job.progress)}%)` : ''}
          </span>
        )}
      </div>

      {error && <p className="text-sm text-red-400 mb-3">{error}</p>}

      {rewards.length === 0 ? (
        <div className="flex items-center justify-center h-32 bg-theme-secondary/10 rounded-lg">
          <p className="text-sm text-theme-secondary">
            No episode rewards yet — pick a dataset and start a scoring run.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Progress curves — one line per episode over a shared 0–100% x-axis */}
          <div className="lg:col-span-2 min-w-0">
            <h3 className="text-sm font-medium text-theme-primary mb-2">
              Task-progress curves ({rewards[0]?.rewardType})
            </h3>
            {episodeKeys.length === 0 ? (
              <p className="text-sm text-theme-tertiary">No progress curves recorded.</p>
            ) : (
              <div className="w-full min-w-0" style={{ height: 260 }}>
                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                  <LineChart data={curveData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis
                      dataKey="pct"
                      type="number"
                      domain={[0, 100]}
                      tickFormatter={(v: number) => `${v}%`}
                      stroke="#6b7280"
                      fontSize={11}
                    />
                    <YAxis domain={[0, 1]} stroke="#6b7280" fontSize={11} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#1E1F24',
                        border: '1px solid rgba(255,255,255,0.08)',
                        borderRadius: '8px',
                        fontSize: 11,
                      }}
                      labelFormatter={(v) => `episode progress ${v}%`}
                    />
                    <Legend />
                    {episodeKeys.map(({ key, episodeIndex }, i) => (
                      <Line
                        key={key}
                        type="monotone"
                        dataKey={key}
                        name={`Episode ${episodeIndex}`}
                        stroke={EPISODE_COLORS[i % EPISODE_COLORS.length]}
                        strokeWidth={2}
                        dot={false}
                        connectNulls
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Score table */}
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-theme-primary mb-2">Episode scores</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-theme-tertiary border-b border-theme">
                  <th className="py-1.5 pr-2 font-medium">Episode</th>
                  <th className="py-1.5 pr-2 font-medium">Score</th>
                  <th className="py-1.5 font-medium">Success</th>
                </tr>
              </thead>
              <tbody>
                {sortedRewards.map((r) => (
                  <tr key={r.id} className="border-b border-theme/50">
                    <td className="py-1.5 pr-2 text-theme-primary">Episode {r.episodeIndex}</td>
                    <td className="py-1.5 pr-2">
                      <span
                        className={`px-1.5 py-0.5 rounded text-xs font-mono font-medium ${scoreColorCls(r.score)}`}
                      >
                        {r.score.toFixed(2)}
                      </span>
                    </td>
                    <td className="py-1.5 text-theme-secondary">
                      {r.success === null ? '—' : r.success ? 'yes' : 'no'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
