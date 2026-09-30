/**
 * @file socialDemoHandlers.ts
 * @description MSW handlers for `/api/social` (TASK-241) — an in-memory
 *   comment/rating store seeded with one evidence-backed agent rating, so the
 *   demo build shows the discussion layer and a comment survives navigation.
 *   Rules mirrored from the server only as far as the UI needs them: agent
 *   ratings carry evidence, one rating per actor per subject, soft delete.
 * @feature social
 */

import { http, HttpResponse } from 'msw';
import type {
  Actor,
  CommentDTO,
  CommentThreadDTO,
  EvidenceRef,
  FeedItem,
  RatingDTO,
  SubjectType,
} from '@/features/social/types/social.types';

const DEMO_ACTOR: Actor = { actorType: 'system', actorId: 'dev', displayName: 'Demo user' };

let seq = 0;
const nextId = (p: string) => `${p}-demo-${++seq}`;

const comments: CommentDTO[] = [];
const ratings: RatingDTO[] = [
  {
    id: 'rating-demo-agent',
    subjectType: 'dataset',
    subjectId: 'demo-g1-edu',
    episodeIndex: null,
    actorType: 'agent',
    actorId: 'eval-agent',
    displayName: 'eval-agent',
    score: 0.72,
    dimensions: { coverage: 0.6, cleanliness: 0.85 },
    evidence: [
      { kind: 'evaluation_episode', ids: ['demo-eval-1'] },
      { kind: 'episode_reward', datasetId: 'demo-g1-edu', rewardType: 'robometer' },
    ] satisfies EvidenceRef[],
    comment: 'Two of three episodes complete the grasp; episode 1 slips.',
    createdAt: '2026-09-29T22:14:00Z',
    updatedAt: '2026-09-29T22:14:00Z',
  },
];

function episodeOf(url: URL, body?: { episodeIndex?: number | null }): number | null {
  if (body && body.episodeIndex != null) return body.episodeIndex;
  const q = url.searchParams.get('episodeIndex');
  return q === null ? null : Number(q);
}

function matches(r: { subjectType: string; subjectId: string; episodeIndex: number | null }, t: string, id: string, ep: number | null) {
  return r.subjectType === t && r.subjectId === id && (t !== 'episode' || r.episodeIndex === ep);
}

function mean(xs: number[]) {
  return xs.length === 0 ? { count: 0, mean: null } : { count: xs.length, mean: xs.reduce((a, b) => a + b, 0) / xs.length };
}

export const socialDemoHandlers = [
  http.get('/api/social/me', () => HttpResponse.json({ actor: DEMO_ACTOR })),

  http.get('/api/social/feed', ({ request }) => {
    const url = new URL(request.url);
    const actorType = url.searchParams.get('actorType');
    const items: FeedItem[] = [
      ...comments.filter((c) => !c.deletedAt).map((c): FeedItem => ({ kind: 'comment', ...c, text: c.body, score: null, at: c.createdAt })),
      ...ratings.map((r): FeedItem => ({ kind: 'rating', ...r, text: r.comment, score: r.score, at: r.updatedAt })),
    ]
      .filter((i) => !actorType || i.actorType === actorType)
      .sort((a, b) => (a.at < b.at ? 1 : -1));
    return HttpResponse.json({ items });
  }),

  http.patch('/api/social/comments/:id', async ({ params, request }) => {
    const c = comments.find((x) => x.id === params.id);
    if (!c) return HttpResponse.json({ error: 'Comment not found' }, { status: 404 });
    const { body } = (await request.json()) as { body: string };
    Object.assign(c, { body, editedAt: new Date().toISOString() });
    return HttpResponse.json({ comment: c });
  }),

  http.delete('/api/social/comments/:id', ({ params }) => {
    const c = comments.find((x) => x.id === params.id);
    if (!c) return HttpResponse.json({ error: 'Comment not found' }, { status: 404 });
    c.deletedAt = new Date().toISOString();
    return HttpResponse.json({ comment: { ...c, body: '' } });
  }),

  http.get('/api/social/:type/:id/comments', ({ params, request }) => {
    const ep = episodeOf(new URL(request.url));
    const rows = comments.filter((c) => matches(c, String(params.type), String(params.id), ep));
    const threads: CommentThreadDTO[] = rows
      .filter((c) => c.parentId === null)
      .map((t) => ({ ...t, body: t.deletedAt ? '' : t.body, replies: rows.filter((r) => r.parentId === t.id) }))
      .filter((t) => !t.deletedAt || t.replies.length > 0);
    return HttpResponse.json({ threads });
  }),

  http.post('/api/social/:type/:id/comments', async ({ params, request }) => {
    const body = (await request.json()) as { body: string; parentId?: string | null; episodeIndex?: number | null };
    const comment: CommentDTO = {
      id: nextId('comment'),
      subjectType: params.type as SubjectType,
      subjectId: String(params.id),
      episodeIndex: episodeOf(new URL(request.url), body),
      parentId: body.parentId ?? null,
      ...DEMO_ACTOR,
      body: body.body,
      evidence: [],
      editedAt: null,
      deletedAt: null,
      createdAt: new Date().toISOString(),
    };
    comments.push(comment);
    return HttpResponse.json({ comment }, { status: 201 });
  }),

  http.get('/api/social/:type/:id/rating', ({ params, request }) => {
    const ep = episodeOf(new URL(request.url));
    const rows = ratings.filter((r) => matches(r, String(params.type), String(params.id), ep));
    const mine = rows.find((r) => r.actorType === DEMO_ACTOR.actorType && r.actorId === DEMO_ACTOR.actorId) ?? null;
    return HttpResponse.json({ mine, ratings: rows });
  }),

  http.put('/api/social/:type/:id/rating', async ({ params, request }) => {
    const body = (await request.json()) as { score: number; episodeIndex?: number | null };
    const ep = episodeOf(new URL(request.url), body);
    const now = new Date().toISOString();
    let row = ratings.find(
      (r) => matches(r, String(params.type), String(params.id), ep) && r.actorType === DEMO_ACTOR.actorType && r.actorId === DEMO_ACTOR.actorId
    );
    if (row) {
      Object.assign(row, { score: body.score, updatedAt: now });
    } else {
      row = {
        id: nextId('rating'),
        subjectType: params.type as SubjectType,
        subjectId: String(params.id),
        episodeIndex: ep,
        ...DEMO_ACTOR,
        score: body.score,
        dimensions: {},
        evidence: [],
        comment: null,
        createdAt: now,
        updatedAt: now,
      };
      ratings.push(row);
    }
    return HttpResponse.json({ rating: row });
  }),

  http.get('/api/social/:type/:id/summary', ({ params, request }) => {
    const ep = episodeOf(new URL(request.url));
    const rows = ratings.filter((r) => matches(r, String(params.type), String(params.id), ep));
    const by = (t: string) => mean(rows.filter((r) => r.actorType === t).map((r) => r.score));
    return HttpResponse.json({
      summary: {
        ...mean(rows.map((r) => r.score)),
        byDimension: {},
        byActorType: { user: by('user'), agent: by('agent'), system: by('system') },
        commentCount: comments.filter((c) => matches(c, String(params.type), String(params.id), ep) && !c.deletedAt).length,
      },
    });
  }),
];
