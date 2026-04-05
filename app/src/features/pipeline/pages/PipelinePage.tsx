/**
 * @file PipelinePage.tsx
 * @description Unified "Train a Skill" pipeline — 5-stage overview with next-step CTAs
 * @feature pipeline
 */

import { useEffect, useState, useCallback } from 'react';
import {
  Workflow,
  Camera,
  Database,
  Brain,
  FlaskConical,
  Rocket,
} from 'lucide-react';
import { Card } from '@/shared/components/ui/Card';
import { Spinner } from '@/shared/components/ui/Spinner';
import { StageCard, type StageStatus } from '../components/StageCard';
import { FirstRunWizard } from '../components/FirstRunWizard';
import { datacollectionApi } from '@/features/datacollection/api/datacollectionApi';
import { trainingApi } from '@/features/training/api/trainingApi';
import { deploymentApi } from '@/features/deployment/api/deploymentApi';
import { simulationApi } from '@/features/simulation/api/simulationApi';

// ============================================================================
// TIME HELPERS
// ============================================================================

function formatRelativeTime(isoDate: string | Date | undefined | null): string {
  if (!isoDate) return '';
  const date = typeof isoDate === 'string' ? new Date(isoDate) : isoDate;
  const diff = Date.now() - date.getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return date.toLocaleDateString();
}

// ============================================================================
// STAGE STATE SHAPE
// ============================================================================

interface StageState {
  status: StageStatus;
  statLine: string;
  hintLine: string;
}

interface PipelineState {
  collect: StageState;
  dataset: StageState;
  train: StageState;
  evaluate: StageState;
  deploy: StageState;
  totalRecords: number;
}

const EMPTY_STAGE: StageState = {
  status: 'empty',
  statLine: 'No records yet',
  hintLine: '',
};

// ============================================================================
// DATA FETCHING — per-stage, isolated so one failure doesn't break others
// ============================================================================

async function fetchCollectStage(): Promise<StageState> {
  try {
    const resp = await datacollectionApi.listSessions({ limit: 10 });
    const sessions = resp.sessions ?? [];
    if (sessions.length === 0) return EMPTY_STAGE;
    const recording = sessions.filter((s) => s.status === 'recording').length;
    const completed = sessions.filter((s) => s.status === 'completed').length;
    const latest = sessions[0];
    return {
      status: recording > 0 ? 'running' : completed > 0 ? 'done' : 'active',
      statLine: `${sessions.length} session${sessions.length === 1 ? '' : 's'} · ${completed} completed`,
      hintLine: latest ? `Last activity: ${formatRelativeTime(latest.updatedAt)}` : '',
    };
  } catch (err) {
    console.error('[Pipeline] collect stage failed:', err);
    return { status: 'empty', statLine: 'Could not load sessions', hintLine: '' };
  }
}

async function fetchDatasetStage(hasUpstream: boolean): Promise<StageState> {
  try {
    const resp = await trainingApi.listDatasets({ pageSize: 10 });
    const datasets = resp.datasets ?? [];
    if (datasets.length === 0) {
      return hasUpstream
        ? { ...EMPTY_STAGE, statLine: 'Ready to create a dataset' }
        : { ...EMPTY_STAGE, status: 'blocked' };
    }
    const ready = datasets.filter((d) => d.status === 'ready').length;
    const processing = datasets.filter((d) =>
      ['uploading', 'importing', 'validating'].includes(d.status)
    ).length;
    const latest = datasets[0];
    return {
      status: processing > 0 ? 'running' : ready > 0 ? 'done' : 'active',
      statLine: `${datasets.length} dataset${datasets.length === 1 ? '' : 's'} · ${ready} ready`,
      hintLine: latest ? `Last activity: ${formatRelativeTime(latest.updatedAt)}` : '',
    };
  } catch (err) {
    console.error('[Pipeline] dataset stage failed:', err);
    return { status: 'empty', statLine: 'Could not load datasets', hintLine: '' };
  }
}

async function fetchTrainStage(hasUpstream: boolean): Promise<StageState> {
  try {
    const resp = await trainingApi.listTrainingJobs({ pageSize: 10 });
    const jobs = resp.jobs ?? [];
    if (jobs.length === 0) {
      return hasUpstream
        ? { ...EMPTY_STAGE, statLine: 'Ready to start training' }
        : { ...EMPTY_STAGE, status: 'blocked' };
    }
    const running = jobs.filter((j) => ['running', 'queued'].includes(j.status)).length;
    const completed = jobs.filter((j) => j.status === 'completed').length;
    const latest = jobs[0];
    return {
      status: running > 0 ? 'running' : completed > 0 ? 'done' : 'active',
      statLine: `${jobs.length} job${jobs.length === 1 ? '' : 's'} · ${completed} completed`,
      hintLine: latest ? `Last activity: ${formatRelativeTime(latest.updatedAt)}` : '',
    };
  } catch (err) {
    console.error('[Pipeline] train stage failed:', err);
    return { status: 'empty', statLine: 'Could not load jobs', hintLine: '' };
  }
}

async function fetchEvaluateStage(hasUpstream: boolean): Promise<StageState> {
  try {
    // Prefer sim runs over real-robot eval episodes for this pipeline view
    const simJobs = await simulationApi.listJobs();
    if (simJobs.length === 0) {
      return hasUpstream
        ? { ...EMPTY_STAGE, statLine: 'Ready to evaluate in simulation' }
        : { ...EMPTY_STAGE, status: 'blocked' };
    }
    const running = simJobs.filter((j) => ['running', 'queued'].includes(j.status)).length;
    const completed = simJobs.filter((j) => j.status === 'completed').length;
    const latest = simJobs[0];
    // Quality hint: best recent success rate
    const withMetrics = simJobs.filter((j) => j.metrics?.successRate !== undefined);
    const bestRate = withMetrics.length
      ? Math.max(...withMetrics.map((j) => j.metrics!.successRate))
      : null;
    return {
      status: running > 0 ? 'running' : completed > 0 ? 'done' : 'active',
      statLine: `${simJobs.length} sim run${simJobs.length === 1 ? '' : 's'}${
        bestRate !== null ? ` · best ${(bestRate * 100).toFixed(0)}%` : ''
      }`,
      hintLine: latest ? `Last activity: ${formatRelativeTime(latest.updatedAt)}` : '',
    };
  } catch (err) {
    console.error('[Pipeline] evaluate stage failed:', err);
    return { status: 'empty', statLine: 'Could not load sim runs', hintLine: '' };
  }
}

async function fetchDeployStage(hasUpstream: boolean): Promise<StageState> {
  try {
    const resp = await deploymentApi.listDeployments({ pageSize: 10 });
    const deployments = resp.deployments ?? [];
    if (deployments.length === 0) {
      return hasUpstream
        ? { ...EMPTY_STAGE, statLine: 'Ready to deploy to fleet' }
        : { ...EMPTY_STAGE, status: 'blocked' };
    }
    const active = deployments.filter((d) =>
      ['deploying', 'canary'].includes(d.status)
    ).length;
    const production = deployments.filter((d) => d.status === 'production').length;
    const latest = deployments[0];
    return {
      status: active > 0 ? 'running' : production > 0 ? 'done' : 'active',
      statLine: `${deployments.length} deployment${
        deployments.length === 1 ? '' : 's'
      } · ${production} in production`,
      hintLine: latest ? `Last activity: ${formatRelativeTime(latest.updatedAt)}` : '',
    };
  } catch (err) {
    console.error('[Pipeline] deploy stage failed:', err);
    return { status: 'empty', statLine: 'Could not load deployments', hintLine: '' };
  }
}

// ============================================================================
// PAGE
// ============================================================================

export function PipelinePage() {
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<PipelineState | null>(null);

  const fetchAll = useCallback(async () => {
    const collect = await fetchCollectStage();
    const hasSessions = collect.status !== 'empty' && collect.status !== 'blocked';
    // Datasets are not strictly downstream of sessions — you can upload directly.
    // So datasets are never blocked by missing sessions; they stand alone.
    const dataset = await fetchDatasetStage(true);
    const hasDatasets = dataset.status !== 'empty' && dataset.status !== 'blocked';
    const train = await fetchTrainStage(hasDatasets);
    const hasTrainingDone = train.status === 'done' || train.status === 'active';
    const evaluate = await fetchEvaluateStage(hasTrainingDone);
    const hasEvalDone = evaluate.status === 'done';
    const deploy = await fetchDeployStage(hasEvalDone);

    const totalRecords =
      (collect.status === 'empty' ? 0 : 1) +
      (dataset.status === 'empty' ? 0 : 1) +
      (train.status === 'empty' || train.status === 'blocked' ? 0 : 1) +
      (evaluate.status === 'empty' || evaluate.status === 'blocked' ? 0 : 1) +
      (deploy.status === 'empty' || deploy.status === 'blocked' ? 0 : 1);

    setState({ collect, dataset, train, evaluate, deploy, totalRecords });
    setLoading(false);

    // Suppress unused warning — kept for future use
    void hasSessions;
  }, []);

  useEffect(() => {
    fetchAll();
    // Poll every 10 seconds to reflect progress
    const interval = setInterval(fetchAll, 10000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner size="lg" color="cobalt" label="Loading pipeline…" />
      </div>
    );
  }

  if (!state) return null;

  const showFirstRun = state.totalRecords === 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <header>
        <div className="flex items-center gap-3 mb-1">
          <div className="p-2 rounded-brand bg-cobalt-500/10">
            <Workflow className="w-6 h-6 text-cobalt-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-theme-primary">Train a Skill</h1>
            <p className="text-sm text-theme-muted">
              Walk through the 5 stages to take a robot skill from demos to production
            </p>
          </div>
        </div>
      </header>

      {/* First-run wizard (only when fully empty) */}
      {showFirstRun && <FirstRunWizard />}

      {/* Pipeline flow */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
        <StageCard
          number={1}
          title="Collect"
          description="Record teleoperation demos of the task you want the robot to learn."
          icon={<Camera className="w-5 h-5" />}
          status={state.collect.status}
          statLine={state.collect.statLine}
          hintLine={state.collect.hintLine}
          ctaLabel={
            state.collect.status === 'empty' ? 'Record demos' : 'Open data collection'
          }
          ctaHref="/data-collection"
          viewAllHref="/data-collection"
        />
        <StageCard
          number={2}
          title="Dataset"
          description="Package demos into a LeRobot-format dataset, or import one from HuggingFace."
          icon={<Database className="w-5 h-5" />}
          status={state.dataset.status}
          statLine={state.dataset.statLine}
          hintLine={state.dataset.hintLine}
          ctaLabel={state.dataset.status === 'empty' ? 'Create dataset' : 'Manage datasets'}
          ctaHref="/datasets"
          viewAllHref="/datasets"
        />
        <StageCard
          number={3}
          title="Train"
          description="Fine-tune a base VLA model (SmolVLA, pi0.5) on your dataset."
          icon={<Brain className="w-5 h-5" />}
          status={state.train.status}
          statLine={state.train.statLine}
          hintLine={state.train.hintLine}
          ctaLabel={state.train.status === 'empty' ? 'Start training' : 'View jobs'}
          ctaHref="/training"
          viewAllHref="/training"
        />
        <StageCard
          number={4}
          title="Evaluate"
          description="Verify the model solves the task in simulation before touching hardware."
          icon={<FlaskConical className="w-5 h-5" />}
          status={state.evaluate.status}
          statLine={state.evaluate.statLine}
          hintLine={state.evaluate.hintLine}
          ctaLabel={state.evaluate.status === 'empty' ? 'Run simulation' : 'View results'}
          ctaHref="/simulation"
          viewAllHref="/simulation"
        />
        <StageCard
          number={5}
          title="Deploy"
          description="Canary-roll the model to the fleet with automatic rollback on regressions."
          icon={<Rocket className="w-5 h-5" />}
          status={state.deploy.status}
          statLine={state.deploy.statLine}
          hintLine={state.deploy.hintLine}
          ctaLabel={state.deploy.status === 'empty' ? 'Deploy model' : 'View deployments'}
          ctaHref="/deployments"
          viewAllHref="/deployments"
        />
      </div>

      {/* Footer hint */}
      <Card variant="subtle">
        <div className="flex items-center gap-3 px-4 py-3 text-sm">
          <div className="text-theme-muted">
            Pipeline refreshes every 10s · Each stage links to its full detail page for deeper work.
          </div>
        </div>
      </Card>
    </div>
  );
}
