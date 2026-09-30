/**
 * @file experimentsDemoHandlers.ts
 * @description MSW handlers for `/api/experiments` (TASK-242) — one proposed
 *   experiment awaiting approval and one completed one with its verdict, so
 *   the demo build shows the whole loop. Approving the proposal moves it to
 *   `running` with every arm `training`; nothing else is simulated.
 * @feature experiments
 */

import { http, HttpResponse } from 'msw';
import type { Experiment, ExperimentArm } from '@/features/experiments/types/experiment.types';

const T = '2026-09-29T20:00:00Z';

function arm(over: Partial<ExperimentArm> & Pick<ExperimentArm, 'id' | 'experimentId' | 'name'>): ExperimentArm {
  return {
    label: null,
    isBaseline: false,
    datasetRefs: [{ datasetId: 'demo-g1-edu' }],
    initFromModelVersionId: null,
    hyperparameters: { learning_rate: 0.0001 },
    trainingJobId: null,
    modelVersionId: null,
    simJobId: null,
    status: 'pending',
    failureReason: null,
    result: null,
    varies: [],
    createdAt: T,
    updatedAt: T,
    ...over,
  };
}

const result = (s: number, n: number) => ({
  successRate: s / n,
  successCount: s,
  episodeCount: n,
  meanDurationMs: 11_800,
  domainGapScore: null,
  evaluationEpisodeIds: [],
  simJobId: 'demo-sim',
  taskPrompt: 'move the apple to the plate',
});

const common = {
  actorType: 'agent' as const,
  actorId: 'planner',
  displayName: 'planner',
  baseModel: 'groot_n1_7',
  fineTuneMethod: 'lora',
  budget: { maxArms: 3, maxGpuHours: 12, gpuHoursPerArm: 4 },
  evaluation: { environment: 'g1_apple_pnp', rolloutCount: 50 },
  rejectedReason: null,
  createdAt: T,
  updatedAt: T,
};

const experiments: Experiment[] = [
  {
    ...common,
    id: 'demo-exp-proposed',
    title: 'Drop the lowest-reward episodes',
    hypothesis: 'Training without the lowest robometer band raises the sim success rate.',
    status: 'proposed',
    approvedBy: null,
    approvedAt: null,
    baselineArmId: 'demo-arm-p0',
    verdict: null,
    arms: [
      arm({ id: 'demo-arm-p0', experimentId: 'demo-exp-proposed', name: 'full dataset', isBaseline: true, label: 'baseline' }),
      arm({
        id: 'demo-arm-p1',
        experimentId: 'demo-exp-proposed',
        name: 'drop lowest 10% by robometer',
        datasetRefs: [{ datasetId: 'demo-view-10' }],
        varies: ['data (demo-g1-edu → demo-view-10)'],
      }),
      arm({
        id: 'demo-arm-p2',
        experimentId: 'demo-exp-proposed',
        name: 'drop lowest 25% by robometer',
        datasetRefs: [{ datasetId: 'demo-view-25' }],
        varies: ['data (demo-g1-edu → demo-view-25)'],
      }),
    ],
  },
  {
    ...common,
    id: 'demo-exp-completed',
    title: 'Learning-rate sweep on the apple task',
    hypothesis: 'A learning rate other than 0.0001 changes the sim success rate on this data.',
    status: 'completed',
    approvedBy: 'u-demo',
    approvedAt: T,
    baselineArmId: 'demo-arm-c0',
    arms: [
      arm({ id: 'demo-arm-c0', experimentId: 'demo-exp-completed', name: 'lr 0.0001', isBaseline: true, status: 'scored', modelVersionId: 'mv-demo-c0', result: result(31, 50) }),
      arm({
        id: 'demo-arm-c1',
        experimentId: 'demo-exp-completed',
        name: 'lr 0.0003',
        hyperparameters: { learning_rate: 0.0003 },
        varies: ['learning_rate (0.0001 → 0.0003)'],
        status: 'scored',
        modelVersionId: 'mv-demo-c1',
        result: result(36, 50),
      }),
    ],
    verdict: {
      winnerArmId: null,
      baselineArmId: 'demo-arm-c0',
      baselineSuccessRate: 0.62,
      baselineEpisodeCount: 50,
      deltas: [
        { armId: 'demo-arm-c1', name: 'lr 0.0003', successRate: 0.72, episodeCount: 50, delta: 0.1, standardError: 0.0935, zScore: 1.07, significant: false, direction: 'within_noise' },
      ],
      criticalZ: 1.96,
      confidenceNote:
        'No winner: no arm differs from the baseline by more than sampling noise at these episode counts. Baseline "lr 0.0001" 31/50 (62%). "lr 0.0003" 36/50 (72%), +10 pts — |z| 1.07 ≤ 1.96: within sampling noise. More rollouts per arm would narrow the noise.',
      failedArmIds: [],
      concludedAt: T,
    },
  },
];

export const experimentsDemoHandlers = [
  http.get('/api/experiments', ({ request }) => {
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const mv = url.searchParams.get('modelVersionId');
    return HttpResponse.json({
      experiments: experiments.filter(
        (e) => (!status || e.status === status) && (!mv || e.arms.some((a) => a.modelVersionId === mv))
      ),
    });
  }),

  http.get('/api/experiments/:id', ({ params }) => {
    const e = experiments.find((x) => x.id === params.id);
    return e ? HttpResponse.json({ experiment: e }) : HttpResponse.json({ error: 'Experiment not found' }, { status: 404 });
  }),

  http.post('/api/experiments/:id/:action', ({ params }) => {
    const e = experiments.find((x) => x.id === params.id);
    if (!e) return HttpResponse.json({ error: 'Experiment not found' }, { status: 404 });
    if (params.action === 'approve' && e.status === 'proposed') {
      e.status = 'running';
      e.approvedBy = 'dev';
      e.approvedAt = new Date().toISOString();
      e.arms = e.arms.map((a, i) => ({ ...a, status: 'training', trainingJobId: `demo-job-${i}` }));
    } else if (params.action === 'reject' && e.status === 'proposed') {
      e.status = 'rejected';
    } else if (params.action === 'cancel') {
      e.status = 'cancelled';
      e.arms = e.arms.map((a) => (a.status === 'scored' ? a : { ...a, status: 'cancelled' }));
    } else {
      return HttpResponse.json({ error: `Cannot ${String(params.action)} a ${e.status} experiment` }, { status: 409 });
    }
    return HttpResponse.json({ experiment: e });
  }),
];
