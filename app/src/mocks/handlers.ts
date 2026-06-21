/**
 * @file handlers.ts
 * @description MSW request handlers for API mocking in tests and demo mode
 * @feature mocks
 */

import { http, HttpResponse } from 'msw';
import { MOCK_USER } from './mockData';
import {
  DEMO_ROBOTS,
  DEMO_H1_TELEMETRY,
  DEMO_ALERTS,
  DEMO_ZONES,
} from './demoData';

export const handlers = [
  // ========================================================================
  // Health
  // ========================================================================

  http.get('/api/health', () => {
    return HttpResponse.json({ status: 'ok', timestamp: new Date().toISOString() });
  }),

  // ========================================================================
  // Auth
  // ========================================================================

  http.get('/api/auth/me', () => {
    return HttpResponse.json(MOCK_USER);
  }),

  http.post('/api/auth/login', () => {
    return HttpResponse.json({ token: 'demo-token', refreshToken: 'demo-refresh' });
  }),

  http.post('/api/auth/refresh', () => {
    return HttpResponse.json({ token: 'demo-token' });
  }),

  // ========================================================================
  // Robots
  // ========================================================================

  http.get('/api/robots/stats', () => {
    return HttpResponse.json({
      total: 5,
      online: 2,
      busy: 1,
      charging: 1,
      offline: 1,
      error: 0,
    });
  }),

  http.get('/api/robots', () => {
    return HttpResponse.json({
      robots: DEMO_ROBOTS,
      pagination: {
        page: 1,
        pageSize: DEMO_ROBOTS.length,
        total: DEMO_ROBOTS.length,
        totalPages: 1,
      },
    });
  }),

  http.get('/api/robots/:id/telemetry', ({ params }) => {
    if (params.id === 'demo-h1-001') {
      return HttpResponse.json(DEMO_H1_TELEMETRY);
    }
    return HttpResponse.json({
      robotId: params.id,
      batteryLevel: 50,
      cpuUsage: 30,
      memoryUsage: 45,
      temperature: 35,
      sensors: {},
      timestamp: new Date().toISOString(),
    });
  }),

  http.get('/api/robots/:id/commands', () => {
    return HttpResponse.json({ commands: [], pagination: { page: 1, pageSize: 10, total: 0, totalPages: 0 } });
  }),

  http.get('/api/robots/:id', ({ params }) => {
    const robot = DEMO_ROBOTS.find((r) => r.id === params.id);
    if (!robot) {
      return HttpResponse.json({ error: 'Robot not found' }, { status: 404 });
    }
    return HttpResponse.json(robot);
  }),

  http.post('/api/robots/:id/command', () => {
    return HttpResponse.json({ success: true });
  }),

  // ========================================================================
  // Alerts
  // ========================================================================

  http.get('/api/alerts/active', () => {
    return HttpResponse.json({ alerts: DEMO_ALERTS.filter((a) => !a.acknowledged) });
  }),

  http.get('/api/alerts/counts', () => {
    return HttpResponse.json({ counts: { critical: 1, error: 0, warning: 1, info: 1 } });
  }),

  http.get('/api/alerts/history', () => {
    return HttpResponse.json({
      data: DEMO_ALERTS,
      pagination: { page: 1, pageSize: 10, total: DEMO_ALERTS.length, totalPages: 1 },
    });
  }),

  http.get('/api/alerts', () => {
    return HttpResponse.json({
      data: DEMO_ALERTS,
      pagination: { page: 1, pageSize: 10, total: DEMO_ALERTS.length, totalPages: 1 },
    });
  }),

  http.patch('/api/alerts/:id/acknowledge', () => {
    return HttpResponse.json({ success: true });
  }),

  // ========================================================================
  // Zones
  // ========================================================================

  http.get('/api/zones', () => {
    return HttpResponse.json({
      data: DEMO_ZONES,
      pagination: { page: 1, pageSize: DEMO_ZONES.length, total: DEMO_ZONES.length, totalPages: 1 },
    });
  }),

  // ========================================================================
  // Jobs / Simulation (empty for demo)
  // ========================================================================

  http.get('/api/jobs/*', () => {
    return HttpResponse.json({ data: [], total: 0 });
  }),

  http.get('/api/simulation/*', () => {
    return HttpResponse.json({ data: [], total: 0 });
  }),

  // ========================================================================
  // Datasets + episodes (demo data for the curation GUI / episode viewer)
  // ========================================================================

  http.get('/api/datasets', () => {
    return HttpResponse.json({ datasets: [DEMO_DATASET], pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 } });
  }),

  http.get('/api/datasets/:id', ({ params }) => {
    return HttpResponse.json({ dataset: { ...DEMO_DATASET, id: params.id } });
  }),

  http.get('/api/datasets/:id/episodes', () => {
    return HttpResponse.json({ episodes: DEMO_EPISODES });
  }),

  http.get('/api/datasets/:id/episodes/:index/frames', ({ params }) => {
    const ep = DEMO_EPISODES.find((e) => e.index === Number(params.index)) ?? DEMO_EPISODES[0];
    const frames = Array.from({ length: ep.frameCount }, (_, i) => ({
      frameIndex: i,
      timestamp: +(i / DEMO_DATASET.fps).toFixed(3),
      action: Array.from({ length: 6 }, (_, j) => +Math.sin(i * 0.1 + j).toFixed(3)),
      observationState: Array.from({ length: 6 }, (_, j) => +Math.sin(i * 0.1 + j).toFixed(3)),
    }));
    return HttpResponse.json({ frames, total: frames.length });
  }),

  // Curation endpoints — echo a plausible revision summary
  http.post('/api/curation/:id/episodes/delete', async ({ request }) => {
    const body = (await request.json()) as { episodes?: number[] };
    const removed = body?.episodes?.length ?? 1;
    return HttpResponse.json({
      datasetId: 'demo', ok: true, operation: `delete episodes ${body?.episodes ?? []}`,
      output: '/tmp/demo__del', total_episodes: DEMO_EPISODES.length - removed,
      total_frames: 60, stats_recompute_required: true,
    });
  }),

  http.post('/api/curation/:id/episodes/:index/trim', async ({ params }) => {
    return HttpResponse.json({
      datasetId: 'demo', ok: true, operation: `trim episode ${params.index}`,
      output: '/tmp/demo__trim', total_episodes: DEMO_EPISODES.length,
      total_frames: 70, stats_recompute_required: true,
    });
  }),

  // ========================================================================
  // Catch-all: other GET /api/* return empty data
  // ========================================================================

  http.get('/api/*', () => {
    return HttpResponse.json({ data: [], total: 0, items: [] });
  }),
];

// Demo dataset/episodes for the episode viewer + curation GUI
const DEMO_DATASET = {
  id: 'demo-g1-edu',
  name: 'G1 EDU — pick & place (demo)',
  description: 'Synthetic Unitree G1 EDU (Dex3-1) teleop demo dataset',
  robotTypeId: 'unitree-g1-edu',
  storagePath: '/tmp/neodem-datasets/demo-g1-edu',
  lerobotVersion: 'v2.1',
  fps: 30,
  totalFrames: 86,
  totalDuration: 2.87,
  demonstrationCount: 4,
  qualityScore: 82,
  infoJson: { features: {} },
  statsJson: {},
  status: 'ready',
  createdAt: '2026-06-21T10:00:00Z',
  updatedAt: '2026-06-21T10:00:00Z',
  robotType: { id: 'unitree-g1-edu', name: 'Unitree G1 + Dex3', manufacturer: 'Unitree Robotics', model: 'G1 EDU (Dex3-1)' },
};

const DEMO_EPISODES = [
  { index: 0, frameCount: 20, durationSeconds: 0.67, flagged: false },
  { index: 1, frameCount: 21, durationSeconds: 0.7, flagged: false },
  { index: 2, frameCount: 22, durationSeconds: 0.73, flagged: false },
  { index: 3, frameCount: 23, durationSeconds: 0.77, flagged: true },
];
