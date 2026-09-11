/**
 * @file RewardModelPanel.tsx
 * @description Reward-model scoring: score a dataset's episodes with Robometer / TOPReward (LeRobot 0.6.0),
 *              then show per-episode task-progress curves and scores. (TASK-179)
 * @feature evaluation
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Gauge } from 'lucide-react';
import {
  Button,
  DataTable,
  EmptyState,
  FormField,
  Panel,
  ProgressBar,
  Select,
  StatusTag,
  chartSeriesColor,
  chartTheme,
  toast,
  type DataTableColumn,
} from '@/shared/components/ui';
import { getErrorMessage } from '@/shared/utils';
import { trainingApi } from '@/features/training/api/trainingApi';
import type { Dataset } from '@/features/training/types/training.types';
import type { EpisodeReward, RewardModelJobStatus, RewardType } from '../types';
import { evaluationApi } from '../api';

const POLL_INTERVAL_MS = 3000;
/** Consecutive failed polls after which polling gives up (~30 s of silence). */
const MAX_POLL_FAILURES = 10;
const RUNNING = new Set(['pending', 'queued', 'running']);

/** Resamples every curve onto a shared 0–100 % axis so episodes of different lengths overlay. */
function buildCurves(rewards: EpisodeReward[]) {
  const withCurves = rewards.filter((r) => r.curve.length > 1);
  const keys = withCurves.map((r) => ({ key: `ep${r.episodeIndex}`, episodeIndex: r.episodeIndex }));
  const data: Record<string, number>[] = [];
  for (let pct = 0; pct <= 100; pct += 2) {
    const point: Record<string, number> = { pct };
    for (const r of withCurves) {
      const pos = (pct / 100) * (r.curve.length - 1);
      const lo = Math.floor(pos);
      const hi = Math.min(lo + 1, r.curve.length - 1);
      point[`ep${r.episodeIndex}`] = +(r.curve[lo] + (r.curve[hi] - r.curve[lo]) * (pos - lo)).toFixed(4);
    }
    data.push(point);
  }
  return { data, keys };
}

const scoreTone = (s: number) => (s > 0.7 ? 'success' : s > 0.4 ? 'warning' : 'danger');

export function RewardModelPanel() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [datasetId, setDatasetId] = useState('');
  const [rewardType, setRewardType] = useState<RewardType>('robometer');
  const [rewards, setRewards] = useState<EpisodeReward[]>([]);
  const [job, setJob] = useState<RewardModelJobStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inFlight = useRef(false);
  const failures = useRef(0);

  useEffect(() => {
    trainingApi
      .listDatasets({ status: 'ready' })
      .then((res) => {
        setDatasets(res.datasets);
        if (res.datasets.length > 0) setDatasetId((prev) => prev || res.datasets[0].id);
      })
      .catch(() => setDatasets([]));
  }, []);

  useEffect(() => {
    if (!datasetId) return setRewards([]);
    evaluationApi.listRewards(datasetId).then(setRewards).catch(() => setRewards([]));
  }, [datasetId]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  }, []);
  useEffect(() => stopPolling, [stopPolling]);

  const poll = useCallback(
    (jobId: string) => {
      stopPolling();
      failures.current = 0;
      pollRef.current = setInterval(async () => {
        // Skip a tick while the previous request is still in flight.
        if (inFlight.current) return;
        inFlight.current = true;
        try {
          const res = await evaluationApi.getRewardModelEval(jobId);
          failures.current = 0;
          setJob(res.job);
          if (res.rewards.length > 0) setRewards(res.rewards);
          if (!RUNNING.has(res.job.status)) {
            stopPolling();
            if (res.job.status === 'failed') toast.error("Couldn't score the episodes", { description: res.job.error ?? 'The scoring job failed' });
            else toast.success('Episodes scored');
          }
        } catch {
          // Persistent failure (job deleted, server gone) must not poll forever.
          failures.current += 1;
          if (failures.current >= MAX_POLL_FAILURES) {
            stopPolling();
            setJob(null);
            toast.error('Lost contact with the scoring job', { description: 'Polling stopped.' });
          }
        } finally {
          inFlight.current = false;
        }
      }, POLL_INTERVAL_MS);
    },
    [stopPolling]
  );

  const start = async () => {
    if (!datasetId) return;
    setStarting(true);
    try {
      const { jobId } = await evaluationApi.createRewardModelEval({ datasetId, rewardType });
      setJob({ id: jobId, status: 'pending', progress: 0 });
      toast.info('Scoring started');
      poll(jobId);
    } catch (err) {
      toast.error("Couldn't start scoring", { description: getErrorMessage(err, 'Unknown error') });
    } finally {
      setStarting(false);
    }
  };

  const running = job !== null && RUNNING.has(job.status);
  const { data, keys } = buildCurves(rewards);
  const rows = [...rewards].sort((a, b) => a.episodeIndex - b.episodeIndex);
  const columns: DataTableColumn<EpisodeReward>[] = [
    { key: 'episodeIndex', header: 'Episode', cell: (r) => `Episode ${r.episodeIndex}` },
    { key: 'score', header: 'Score', align: 'right', cell: (r) => <StatusTag tone={scoreTone(r.score)}>{r.score.toFixed(2)}</StatusTag> },
    { key: 'success', header: 'Success', align: 'right', cell: (r) => (r.success === null ? '—' : r.success ? 'Yes' : 'No') },
  ];

  return (
    <Panel>
      <Panel.Header title="Reward model" description="Score recorded episodes with a VLM reward model. No simulator or robot needed." />
      <Panel.Body className="flex flex-col gap-5">
        <div className="flex flex-wrap items-end gap-3">
          <FormField label="Dataset" className="min-w-[220px] flex-1 sm:max-w-xs">
            <Select disabled={running} value={datasetId} onChange={(e) => setDatasetId(e.target.value)}
              placeholder={datasets.length === 0 ? 'No ready datasets' : undefined}
              options={datasets.map((d) => ({ value: d.id, label: `${d.name} (${d.demonstrationCount} episodes)` }))} />
          </FormField>
          <FormField label="Reward model" className="min-w-[220px] flex-1 sm:max-w-xs">
            <Select disabled={running} value={rewardType} onChange={(e) => setRewardType(e.target.value as RewardType)}
              options={[{ value: 'robometer', label: 'Robometer: per-frame progress' }, { value: 'topreward', label: 'TOPReward: zero-shot VLM' }]} />
          </FormField>
          <Button variant="secondary" leftIcon={<Gauge className="h-4 w-4" />} onClick={() => void start()} isLoading={starting} disabled={!datasetId || running}>
            {running ? 'Scoring…' : 'Score episodes'}
          </Button>
        </div>
        {running && job && <ProgressBar value={job.progress} label="Scoring" size="sm" />}

        {rewards.length === 0 ? (
          <EmptyState size="sm" icon={<Gauge />} title="No scores yet" description="Pick a dataset and score its episodes." />
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="min-w-0 lg:col-span-2">
              <h3 className="mb-2 text-sm font-semibold text-ink-primary">Task progress per episode</h3>
              {keys.length === 0 ? (
                <p className="text-sm text-ink-tertiary">No progress curves recorded.</p>
              ) : (
                <div className="h-64 w-full min-w-0">
                  <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                    <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                      <CartesianGrid {...chartTheme.grid} />
                      <XAxis dataKey="pct" type="number" domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} {...chartTheme.xAxis} />
                      <YAxis domain={[0, 1]} {...chartTheme.yAxis} width={36} />
                      <Tooltip {...chartTheme.tooltip} labelFormatter={(v) => `Episode progress ${v}%`} />
                      <Legend {...chartTheme.legend} />
                      {keys.map(({ key, episodeIndex }, i) => (
                        <Line key={key} type="monotone" dataKey={key} name={`Episode ${episodeIndex}`} stroke={chartSeriesColor(i)} strokeWidth={1.75} dot={false} connectNulls />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
            <div className="min-w-0 overflow-hidden rounded-control border border-line">
              <DataTable caption="Episode scores" columns={columns} rows={rows} getRowId={(r) => r.id} dense />
            </div>
          </div>
        )}
      </Panel.Body>
    </Panel>
  );
}
