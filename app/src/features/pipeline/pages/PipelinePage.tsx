/**
 * @file PipelinePage.tsx
 * @description Pipeline overview: the five stages from demonstrations to a
 *              deployed policy as one vertical stepper, with the next stage as
 *              the header's primary action.
 * @feature pipeline
 */

import { useCallback, useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { LinkButton, PageHeader, Panel, SkeletonRows } from '@/shared/components/ui';
import { StageCard, type StageStatus } from '../components/StageCard';
import { FirstRunWizard } from '../components/FirstRunWizard';
import { datacollectionApi } from '@/features/datacollection/api/datacollectionApi';
import { trainingApi } from '@/features/training/api/trainingApi';
import { deploymentApi } from '@/features/deployment/api/deploymentApi';
import { simulationApi } from '@/features/simulation/api/simulationApi';
import { UI_DATE_LOCALE } from '@/shared/utils/format';

// ============================================================================
// HELPERS
// ============================================================================

function formatRelativeTime(isoDate: string | Date | undefined | null): string {
  if (!isoDate) return '';
  const date = typeof isoDate === 'string' ? new Date(isoDate) : isoDate;
  const sec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return date.toLocaleDateString(UI_DATE_LOCALE);
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const lastActivity = (at?: string | Date | null) => (at ? `Last activity ${formatRelativeTime(at)}` : '');

interface StageState {
  status: StageStatus;
  statLine: string;
  hintLine: string;
  loadError?: boolean;
}

type StageKey = 'collect' | 'dataset' | 'train' | 'evaluate' | 'deploy';

const EMPTY: StageState = { status: 'empty', statLine: 'Nothing yet', hintLine: '' };
const FAILED: StageState = { status: 'empty', statLine: '', hintLine: '', loadError: true };

/** Empty stage: ready when upstream work exists, else waiting on it. */
const emptyStage = (hasUpstream: boolean, readyLine: string): StageState =>
  hasUpstream ? { ...EMPTY, statLine: readyLine } : { ...EMPTY, status: 'blocked' };

const pick = (running: number, done: number): StageStatus =>
  running > 0 ? 'running' : done > 0 ? 'done' : 'active';

// ============================================================================
// DATA — one fetch per stage, isolated so one failure doesn't break others
// ============================================================================

async function fetchCollect(): Promise<StageState> {
  try {
    const sessions = (await datacollectionApi.listSessions({ limit: 10 })).sessions ?? [];
    if (sessions.length === 0) return { ...EMPTY, statLine: 'No sessions yet' };
    const completed = sessions.filter((s) => s.status === 'completed').length;
    return {
      status: pick(sessions.filter((s) => s.status === 'recording').length, completed),
      statLine: `${plural(sessions.length, 'session')} · ${completed} completed`,
      hintLine: lastActivity(sessions[0]?.updatedAt),
    };
  } catch {
    return FAILED;
  }
}

async function fetchDataset(): Promise<StageState> {
  try {
    const datasets = (await trainingApi.listDatasets({ pageSize: 10 })).datasets ?? [];
    if (datasets.length === 0) return emptyStage(true, 'Ready to create a dataset');
    const ready = datasets.filter((d) => d.status === 'ready').length;
    const processing = datasets.filter((d) => ['uploading', 'importing', 'validating'].includes(d.status)).length;
    return {
      status: pick(processing, ready),
      statLine: `${plural(datasets.length, 'dataset')} · ${ready} ready`,
      hintLine: lastActivity(datasets[0]?.updatedAt),
    };
  } catch {
    return FAILED;
  }
}

async function fetchTrain(hasUpstream: boolean): Promise<StageState> {
  try {
    const jobs = (await trainingApi.listTrainingJobs({ pageSize: 10 })).jobs ?? [];
    if (jobs.length === 0) return emptyStage(hasUpstream, 'Ready to train');
    const completed = jobs.filter((j) => j.status === 'completed').length;
    return {
      status: pick(jobs.filter((j) => ['running', 'queued'].includes(j.status)).length, completed),
      statLine: `${plural(jobs.length, 'job')} · ${completed} completed`,
      hintLine: lastActivity(jobs[0]?.updatedAt),
    };
  } catch {
    return FAILED;
  }
}

async function fetchEvaluate(hasUpstream: boolean): Promise<StageState> {
  try {
    const runs = await simulationApi.listJobs();
    if (runs.length === 0) return emptyStage(hasUpstream, 'Ready to evaluate in simulation');
    const rates = runs.flatMap((j) => (j.metrics?.successRate !== undefined ? [j.metrics.successRate] : []));
    const best = rates.length ? ` · best ${(Math.max(...rates) * 100).toFixed(0)}%` : '';
    return {
      status: pick(
        runs.filter((j) => ['running', 'queued'].includes(j.status)).length,
        runs.filter((j) => j.status === 'completed').length,
      ),
      statLine: `${plural(runs.length, 'sim run')}${best}`,
      hintLine: lastActivity(runs[0]?.updatedAt),
    };
  } catch {
    return FAILED;
  }
}

async function fetchDeploy(hasUpstream: boolean): Promise<StageState> {
  try {
    const deployments = (await deploymentApi.listDeployments({ pageSize: 10 })).deployments ?? [];
    if (deployments.length === 0) return emptyStage(hasUpstream, 'Ready to deploy to the fleet');
    const production = deployments.filter((d) => d.status === 'production').length;
    return {
      status: pick(deployments.filter((d) => ['deploying', 'canary'].includes(d.status)).length, production),
      statLine: `${plural(deployments.length, 'deployment')} · ${production} in production`,
      hintLine: lastActivity(deployments[0]?.updatedAt),
    };
  } catch {
    return FAILED;
  }
}

// ============================================================================
// STAGES
// ============================================================================

interface StageDef {
  key: StageKey;
  title: string;
  description: string;
  href: string;
  linkLabel: string;
  nextLabel: string;
  nextHref: string;
}

const STAGES: StageDef[] = [
  { key: 'collect', title: 'Collect', description: 'Record teleoperated demonstrations of the task.',
    href: '/data-collection', linkLabel: 'Open sessions', nextLabel: 'Start collecting', nextHref: '/data-collection/new' },
  { key: 'dataset', title: 'Dataset', description: 'Package demonstrations as a LeRobot dataset, or import one from the Hub.',
    href: '/datasets', linkLabel: 'Open datasets', nextLabel: 'Create dataset', nextHref: '/datasets' },
  { key: 'train', title: 'Train', description: 'Fine-tune a base VLA model such as SmolVLA or pi0.5 on your dataset.',
    href: '/training', linkLabel: 'Open training', nextLabel: 'Train a model', nextHref: '/training' },
  { key: 'evaluate', title: 'Evaluate', description: 'Check that the model solves the task in simulation before it touches hardware.',
    href: '/training?tab=simulation', linkLabel: 'Open evaluation', nextLabel: 'Run simulation', nextHref: '/training?tab=simulation' },
  { key: 'deploy', title: 'Deploy', description: 'Canary-roll the model to the fleet with automatic rollback on regressions.',
    href: '/deployments', linkLabel: 'Open deployments', nextLabel: 'Deploy model', nextHref: '/deployments' },
];

type PipelineState = Record<StageKey, StageState>;

/** The stage to work on now: the first open stage after the last finished one. */
function nextStageIndex(state: PipelineState): number {
  const statuses = STAGES.map((s) => state[s.key].status);
  const lastDone = statuses.lastIndexOf('done');
  const after = statuses.findIndex((st, i) => i > lastDone && st !== 'done' && st !== 'blocked');
  if (after >= 0) return after;
  return statuses.findIndex((st) => st !== 'done' && st !== 'blocked');
}

// ============================================================================
// PAGE
// ============================================================================

const TITLE = 'Pipeline';
const DESCRIPTION = 'From demonstrations to a deployed policy, one stage at a time.';

export function PipelinePage() {
  const [state, setState] = useState<PipelineState | null>(null);

  const fetchAll = useCallback(async () => {
    const [collect, dataset] = await Promise.all([fetchCollect(), fetchDataset()]);
    const train = await fetchTrain(dataset.status !== 'empty' && dataset.status !== 'blocked');
    const evaluate = await fetchEvaluate(train.status === 'done' || train.status === 'active');
    const deploy = await fetchDeploy(evaluate.status === 'done');
    setState({ collect, dataset, train, evaluate, deploy });
  }, []);

  useEffect(() => {
    void fetchAll();
    // Silent refresh so running stages tick over without a reload.
    const interval = setInterval(() => void fetchAll(), 10000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  if (!state) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader eyebrow="Build" title={TITLE} description={DESCRIPTION} />
        <Panel padding="none">
          <SkeletonRows rows={5} columns={3} />
        </Panel>
      </div>
    );
  }

  const nextIdx = nextStageIndex(state);
  const next = nextIdx >= 0 ? STAGES[nextIdx] : null;
  const nothingYet = STAGES.every((s) => ['empty', 'blocked'].includes(state[s.key].status));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Build"
        title={TITLE}
        description={DESCRIPTION}
        actions={
          next ? (
            <LinkButton to={next.nextHref} rightIcon={<ArrowRight className="h-4 w-4" strokeWidth={1.75} />}>
              {next.nextLabel}
            </LinkButton>
          ) : (
            <LinkButton to="/deployments" variant="secondary">Open deployments</LinkButton>
          )
        }
      />

      {nothingYet && <FirstRunWizard />}

      <Panel padding="none">
        <Panel.Header title="Stages" description="Each stage opens its own page." />
        <ol className="divide-y divide-line-subtle">
          {STAGES.map((stage, i) => {
            const s = state[stage.key];
            return (
              <StageCard
                key={stage.key}
                number={i + 1}
                title={stage.title}
                description={stage.description}
                status={s.status}
                isNext={i === nextIdx}
                statLine={s.statLine}
                hintLine={s.hintLine}
                ctaLabel={stage.linkLabel}
                ctaHref={stage.href}
                loadError={s.loadError}
                onRetry={() => void fetchAll()}
              />
            );
          })}
        </ol>
      </Panel>
    </div>
  );
}
