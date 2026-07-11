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
import {
  DEMO_MARKETPLACE_LISTINGS,
  DEMO_MARKETPLACE_CREDIT_BALANCE,
  DEMO_MY_PURCHASES,
  DEMO_MY_LISTINGS,
  withoutReviews,
} from './marketplaceDemoData';
import type {
  MarketplaceListing,
  MarketplacePurchase,
  MarketplaceReview,
  MarketplaceLicenseTier,
  CreateListingInput,
  SubmitReviewInput,
} from '@/features/contributions/types/marketplace.types';

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

  // Curation endpoints — echo a plausible revision summary incl. the newly
  // registered dataset revision (matches the real response shape, TASK-168)
  http.post('/api/curation/:id/episodes/delete', async ({ params, request }) => {
    const body = (await request.json()) as { episodes?: number[] };
    const removed = body?.episodes?.length ?? 1;
    return HttpResponse.json({
      datasetId: String(params.id), ok: true, operation: `delete episodes ${body?.episodes ?? []}`,
      output: '/tmp/demo__del', total_episodes: DEMO_EPISODES.length - removed,
      total_frames: 60, stats_recompute_required: false,
      newDatasetId: 'demo-g1-edu-curated', newDatasetName: `${DEMO_DATASET.name} (curated)`,
    });
  }),

  http.post('/api/curation/:id/episodes/:index/trim', async ({ params }) => {
    return HttpResponse.json({
      datasetId: String(params.id), ok: true, operation: `trim episode ${params.index}`,
      output: '/tmp/demo__trim', total_episodes: DEMO_EPISODES.length,
      total_frames: 70, stats_recompute_required: false,
      newDatasetId: 'demo-g1-edu-curated', newDatasetName: `${DEMO_DATASET.name} (curated)`,
    });
  }),

  // AI curation suggestions (Phase-2 "video-use", TASK-168) — canned heuristics
  http.post('/api/curation/:id/suggest', ({ params }) => {
    return HttpResponse.json({
      datasetId: String(params.id), ok: true, operation: 'suggest',
      suggestions: [
        {
          episode: 1, kind: 'trim', start: 3, end: 18,
          reason: 'idle padding: 3 leading / 3 trailing frames below motion threshold 1e-03',
          confidence: 0.78,
        },
        {
          episode: 3, kind: 'delete',
          reason: 'near-zero motion over the whole episode (mean |delta| 4.20e-05 <= 1.00e-03)',
          confidence: 0.9,
        },
        {
          episode: 2, kind: 'trim', start: 0, end: 16,
          reason: 'idle padding: 0 leading / 6 trailing frames below motion threshold 1e-03',
          confidence: 0.77,
        },
      ],
      vlmEnriched: false,
    });
  }),

  // ========================================================================
  // Reward-model evaluation + annotations + incident clips (LeRobot 0.6.0,
  // TASK-179) — demo data so the new panels render in demo mode
  // ========================================================================

  http.get('/api/evaluation/rewards', () => {
    return HttpResponse.json({ rewards: DEMO_EPISODE_REWARDS });
  }),

  http.post('/api/evaluation/reward-model', () => {
    return HttpResponse.json({ jobId: 'demo-reward-job-1' }, { status: 201 });
  }),

  http.get('/api/evaluation/reward-model/:jobId', ({ params }) => {
    return HttpResponse.json({
      job: { id: String(params.jobId), status: 'completed', progress: 100 },
      rewards: DEMO_EPISODE_REWARDS,
    });
  }),

  http.get('/api/datasets/:id/annotations', () => {
    return HttpResponse.json({ annotations: DEMO_ANNOTATIONS });
  }),

  http.post('/api/datasets/:id/annotate', () => {
    return HttpResponse.json({ jobId: 'demo-annotate-job-1' }, { status: 201 });
  }),

  http.get('/api/incidents/:id/clip', () => {
    return HttpResponse.json({
      format: 'jpeg-frames',
      fps: 5,
      capturedAt: '2026-07-04T12:00:00Z',
      frames: Array.from({ length: 15 }, () => DEMO_JPEG_FRAME_B64),
    });
  }),

  http.post('/api/skills/:id/execute', async ({ params, request }) => {
    const body = (await request.json()) as { robotId?: string; parameters?: Record<string, unknown> };
    const startedAt = new Date().toISOString();
    return HttpResponse.json({
      skillId: String(params.id),
      robotId: body?.robotId ?? 'demo-h1-001',
      status: 'completed',
      startedAt,
      completedAt: startedAt,
      duration: 4200,
      parameters: body?.parameters ?? {},
      output: { note: 'demo execution' },
      retryCount: 0,
    });
  }),

  // ========================================================================
  // Marketplace (Skill & Data Marketplace demo data)
  // ========================================================================

  http.get('/api/marketplace/listings', ({ request }) => {
    const url = new URL(request.url);
    const type = url.searchParams.get('type');
    const robotType = url.searchParams.get('robotType');
    const baseModel = url.searchParams.get('baseModel');
    const search = url.searchParams.get('search');
    const featured = url.searchParams.get('featured');
    const trending = url.searchParams.get('trending');

    const listings = demoMarketplaceListings
      .filter((l) => {
        if (type && l.type !== type) return false;
        if (robotType && l.robotType !== robotType) return false;
        if (baseModel && l.baseModel !== baseModel) return false;
        if (featured === 'true' && !l.isFeatured) return false;
        if (trending === 'true' && !l.isTrending) return false;
        if (search) {
          const q = search.toLowerCase();
          return (
            l.title.toLowerCase().includes(q) ||
            l.shortDescription.toLowerCase().includes(q) ||
            l.tags.some((t) => t.toLowerCase().includes(q))
          );
        }
        return true;
      })
      .map(withoutReviews);

    return HttpResponse.json({ listings, total: listings.length });
  }),

  http.post('/api/marketplace/listings', async ({ request }) => {
    const body = (await request.json()) as CreateListingInput;
    const priceTiers = (body.priceTiers ?? []).map((t) => ({
      tier: t.tier,
      label: DEMO_TIER_LABELS[t.tier] ?? t.tier,
      description: t.description ?? '',
      priceCredits: t.priceCredits,
      features: t.features ?? [],
    }));
    const listing: MarketplaceListing = {
      id: `ml-demo-${Date.now()}`,
      type: body.type,
      title: body.title,
      shortDescription: body.shortDescription,
      fullDescription: body.fullDescription,
      seller: {
        id: 'demo-user',
        displayName: 'Demo User',
        tier: 'silver',
        totalSales: 0,
        rating: 0,
        avatarInitials: 'DU',
      },
      robotType: body.robotType,
      baseModel: body.baseModel,
      tags: body.tags ?? [],
      rating: 0,
      reviewCount: 0,
      downloadCount: 0,
      isTrending: false,
      isFeatured: false,
      taskCategory: body.taskCategory,
      successRate: body.successRate,
      adapterSizeMB: body.adapterSizeMB,
      episodeCount: body.episodeCount,
      frameCount: body.frameCount,
      datasetSizeGB: body.datasetSizeGB,
      collectionMethod: body.collectionMethod,
      priceTiers,
      lowestPriceCredits: Math.min(...priceTiers.map((t) => t.priceCredits)),
      createdAt: new Date().toISOString(),
      reviews: [],
    };
    demoMarketplaceListings.unshift(listing);
    demoMyListings.unshift({ listing: withoutReviews(listing), totalRevenue: 0, totalDownloads: 0, status: 'active' as const });
    return HttpResponse.json({ listing }, { status: 201 });
  }),

  http.get('/api/marketplace/listings/:id', ({ params }) => {
    const listing = demoMarketplaceListings.find((l) => l.id === params.id);
    if (!listing) {
      return HttpResponse.json({ error: 'Listing not found' }, { status: 404 });
    }
    return HttpResponse.json({ listing });
  }),

  http.post('/api/marketplace/listings/:id/purchase', async ({ params, request }) => {
    const body = (await request.json()) as { tier: MarketplaceLicenseTier };
    const listing = demoMarketplaceListings.find((l) => l.id === params.id);
    if (!listing) {
      return HttpResponse.json({ error: 'Listing not found' }, { status: 404 });
    }
    const tier = listing.priceTiers.find((t) => t.tier === body.tier);
    if (!tier) {
      return HttpResponse.json({ error: 'Unknown license tier for this listing' }, { status: 400 });
    }
    if (demoMyListings.some((m) => m.listing.id === listing.id)) {
      return HttpResponse.json(
        { error: 'Sellers cannot purchase their own listing' },
        { status: 400 }
      );
    }
    if (demoMyPurchases.some((p) => p.listingId === listing.id)) {
      return HttpResponse.json({ error: 'You already own this listing' }, { status: 400 });
    }
    if (demoCreditBalance < tier.priceCredits) {
      return HttpResponse.json(
        { error: 'Insufficient credits', balance: demoCreditBalance, required: tier.priceCredits },
        { status: 402 }
      );
    }
    demoCreditBalance -= tier.priceCredits;
    const purchase: MarketplacePurchase = {
      id: `mp-demo-${Date.now()}`,
      listingId: listing.id,
      listing: withoutReviews(listing),
      licenseTier: tier.tier,
      purchasedAt: new Date().toISOString(),
      creditsSpent: tier.priceCredits,
    };
    demoMyPurchases.unshift(purchase);
    return HttpResponse.json({ purchase, balance: demoCreditBalance }, { status: 201 });
  }),

  http.get('/api/marketplace/listings/:id/download', ({ params }) => {
    const listing = demoMarketplaceListings.find((l) => l.id === params.id);
    if (!listing) {
      return HttpResponse.json({ error: 'Listing not found' }, { status: 404 });
    }
    if (!demoUserOwnsOrSells(listing.id)) {
      return HttpResponse.json(
        { error: 'You must purchase this listing to download it' },
        { status: 403 }
      );
    }
    listing.downloadCount += 1;
    const slug = listing.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const isSkill = listing.type === 'skill';
    return HttpResponse.json({
      fileName: isSkill ? `${slug}-adapter.safetensors` : `${slug}-lerobot-v3.tar.gz`,
      fileSizeBytes: isSkill
        ? Math.round((listing.adapterSizeMB ?? 128) * 1024 * 1024)
        : Math.round((listing.datasetSizeGB ?? 1) * 1024 * 1024 * 1024),
      checksumSha256: `${listing.id.replace(/-/g, '')}a7f3b2c9e1d4f6081b3c5d7e9f0a2b4c6d8e0f1a2b3c4d5e6f7a8b9c0d1e2f3`.slice(0, 64),
      format: isSkill ? 'safetensors' : 'lerobot-v3',
      version: '1.0.0',
      url: null,
      expiresInSeconds: null,
    });
  }),

  http.get('/api/marketplace/listings/:id/download/file', ({ params }) => {
    const listing = demoMarketplaceListings.find((l) => l.id === params.id);
    if (!listing) {
      return HttpResponse.json({ error: 'Artifact not found' }, { status: 404 });
    }
    if (!demoUserOwnsOrSells(listing.id)) {
      return HttpResponse.json(
        { error: 'You must purchase this listing to download it' },
        { status: 403 }
      );
    }
    // Small deterministic pseudo-random payload (64 KB)
    const bytes = new Uint8Array(64 * 1024);
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = (i * 31 + 7) % 256;
    }
    return new HttpResponse(bytes.buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(bytes.length),
        'Content-Disposition': 'attachment; filename="demo-artifact.bin"',
      },
    });
  }),

  http.post('/api/marketplace/listings/:id/reviews', async ({ params, request }) => {
    const body = (await request.json()) as SubmitReviewInput;
    const listing = demoMarketplaceListings.find((l) => l.id === params.id);
    if (!listing) {
      return HttpResponse.json({ error: 'Listing not found' }, { status: 404 });
    }
    if (demoMyListings.some((m) => m.listing.id === listing.id)) {
      return HttpResponse.json(
        { error: 'Sellers cannot review their own listing' },
        { status: 403 }
      );
    }
    if (!demoMyPurchases.some((p) => p.listingId === listing.id)) {
      return HttpResponse.json(
        { error: 'You must purchase this listing before reviewing it' },
        { status: 403 }
      );
    }
    if (listing.reviews.some((r) => r.authorName === 'Demo User')) {
      return HttpResponse.json(
        { error: 'You already reviewed this listing' },
        { status: 400 }
      );
    }
    const review: MarketplaceReview = {
      id: `r-demo-${Date.now()}`,
      authorName: 'Demo User',
      authorTier: 'silver',
      rating: body.rating,
      body: body.body,
      createdAt: new Date().toISOString(),
      robotType: body.robotType ?? 'Generic',
    };
    const newCount = listing.reviewCount + 1;
    const newRating = +(((listing.rating * listing.reviewCount) + body.rating) / newCount).toFixed(1);
    listing.reviews.unshift(review);
    listing.rating = newRating;
    listing.reviewCount = newCount;
    return HttpResponse.json({ review, rating: newRating, reviewCount: newCount }, { status: 201 });
  }),

  http.get('/api/marketplace/my/purchases', () => {
    return HttpResponse.json({ purchases: demoMyPurchases });
  }),

  http.get('/api/marketplace/my/listings', () => {
    return HttpResponse.json({ listings: demoMyListings });
  }),

  http.get('/api/marketplace/credits/balance', () => {
    return HttpResponse.json({ balance: demoCreditBalance });
  }),

  // ========================================================================
  // Catch-all: other GET /api/* return empty data
  // ========================================================================

  http.get('/api/*', () => {
    return HttpResponse.json({ data: [], total: 0, items: [] });
  }),
];

// ============================================================================
// Marketplace demo state (mutable so purchases/reviews persist per session)
// ============================================================================

const demoMarketplaceListings: MarketplaceListing[] = DEMO_MARKETPLACE_LISTINGS.map((l) => ({
  ...l,
  reviews: [...l.reviews],
}));
const demoMyPurchases: MarketplacePurchase[] = [...DEMO_MY_PURCHASES];
const demoMyListings = [...DEMO_MY_LISTINGS];
let demoCreditBalance = DEMO_MARKETPLACE_CREDIT_BALANCE;

/** Mirrors the real API's download gate: purchaser or seller only. */
function demoUserOwnsOrSells(listingId: string): boolean {
  return (
    demoMyPurchases.some((p) => p.listingId === listingId) ||
    demoMyListings.some((m) => m.listing.id === listingId)
  );
}

const DEMO_TIER_LABELS: Record<MarketplaceLicenseTier, string> = {
  research: 'Research',
  per_robot: 'Per Robot',
  per_fleet: 'Per Fleet',
  enterprise: 'Enterprise',
};

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

// ============================================================================
// Reward-model / annotation / incident-clip demo data (TASK-179)
// ============================================================================

/** Smooth 0→target progress curve with a little noise, `n` samples. */
function demoProgressCurve(n: number, target: number): number[] {
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    const sigmoid = 1 / (1 + Math.exp(-10 * (t - 0.5)));
    const noise = 0.02 * Math.sin(i * 1.7);
    return +Math.min(1, Math.max(0, target * sigmoid + noise)).toFixed(4);
  });
}

const DEMO_EPISODE_REWARDS = [
  {
    id: 'demo-reward-ep0',
    datasetId: 'demo-g1-edu',
    episodeIndex: 0,
    rewardType: 'robometer',
    score: 0.87,
    success: true,
    curve: demoProgressCurve(20, 0.9),
    fps: 30,
    jobId: 'demo-reward-job-1',
    createdAt: '2026-07-04T12:00:00Z',
  },
  {
    id: 'demo-reward-ep1',
    datasetId: 'demo-g1-edu',
    episodeIndex: 1,
    rewardType: 'robometer',
    score: 0.34,
    success: false,
    curve: demoProgressCurve(21, 0.38),
    fps: 30,
    jobId: 'demo-reward-job-1',
    createdAt: '2026-07-04T12:00:00Z',
  },
];

const DEMO_ANNOTATIONS = [
  {
    episodeIndex: 0,
    subtasks: [
      { startS: 0.0, endS: 0.3, text: 'Reach toward the red cube' },
      { startS: 0.3, endS: 0.5, text: 'Grasp the cube with the Dex3 hand' },
      { startS: 0.5, endS: 0.67, text: 'Place the cube in the target bin' },
    ],
    vqa: [
      { question: 'Which object is being manipulated?', answer: 'A red cube on the table.' },
      { question: 'Did the grasp succeed?', answer: 'Yes, the cube is lifted cleanly.' },
    ],
  },
  {
    episodeIndex: 1,
    subtasks: [
      { startS: 0.0, endS: 0.4, text: 'Reach toward the red cube' },
      { startS: 0.4, endS: 0.7, text: 'Attempt grasp — cube slips from the fingers' },
    ],
    vqa: [{ question: 'Did the grasp succeed?', answer: 'No, the cube slipped during closing.' }],
  },
];

/** Minimal valid 1x1 JPEG (base64) reused for every demo clip frame. */
const DEMO_JPEG_FRAME_B64 =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==';
