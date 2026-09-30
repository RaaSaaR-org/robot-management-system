/**
 * @file SocialService.test.ts
 * @description The rules of the social layer (TASK-241) against an in-memory
 *   repository: agent evidence, evidence existence, one rating per actor,
 *   soft delete, the human/agent summary split, subject checks, the feed and
 *   the compliance entry for agent ratings.
 * @feature social
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../database/index.js', () => ({ prisma: {} }));
vi.mock('../ComplianceLogService.js', () => ({ complianceLogService: { logAIDecision: vi.fn() } }));

import { SocialService, SocialError, type SocialComplianceSink } from '../SocialService.js';
import type {
  SocialRepository,
  CommentRow,
  RatingRow,
  CommentCreateData,
  RatingWriteData,
  DatasetFacts,
} from '../../repositories/SocialRepository.js';
import type { Actor, SubjectRef } from '../../types/social.types.js';

const USER: Actor = { actorType: 'user', actorId: 'u-1', displayName: 'Ada' };
const USER2: Actor = { actorType: 'user', actorId: 'u-2', displayName: 'Bea' };
const AGENT: Actor = { actorType: 'agent', actorId: 'eval-agent', displayName: 'eval-agent' };

/** A tiny in-memory stand-in for SocialRepository. */
class FakeRepo {
  comments: CommentRow[] = [];
  ratings: RatingRow[] = [];
  datasets = new Map<string, DatasetFacts>();
  modelVersions = new Set<string>();
  trainingJobs = new Set<string>();
  experiments = new Set<string>();
  evalEpisodes = new Set<string>();
  validations = new Set<string>();
  rewards = new Set<string>();
  agents = new Set<string>();
  private seq = 0;
  private clock = Date.parse('2026-09-30T10:00:00Z');

  private now(): Date {
    this.clock += 1000;
    return new Date(this.clock);
  }

  async createComment(data: CommentCreateData): Promise<CommentRow> {
    const row: CommentRow = {
      id: `c-${++this.seq}`,
      tenantId: null,
      ...data,
      editedAt: null,
      deletedAt: null,
      createdAt: this.now(),
    };
    this.comments.push(row);
    return row;
  }
  async findComment(id: string) {
    return this.comments.find((c) => c.id === id) ?? null;
  }
  async updateComment(id: string, data: Partial<CommentRow>) {
    const row = this.comments.find((c) => c.id === id)!;
    Object.assign(row, data);
    return row;
  }
  async listComments(subjectType: string, subjectId: string, episodeIndex: number | null) {
    return this.comments.filter(
      (c) => c.subjectType === subjectType && c.subjectId === subjectId && (episodeIndex === null || c.episodeIndex === episodeIndex)
    );
  }
  async countComments(subjectType: string, subjectId: string, episodeIndex: number | null) {
    return (await this.listComments(subjectType, subjectId, episodeIndex)).filter((c) => !c.deletedAt).length;
  }
  async recentComments(f: { actorType?: string; subjectType?: string; limit: number }) {
    return this.comments
      .filter((c) => !c.deletedAt && (!f.actorType || c.actorType === f.actorType) && (!f.subjectType || c.subjectType === f.subjectType))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, f.limit);
  }
  async findRating(subjectType: string, subjectKey: string, actorType: string, actorId: string) {
    return (
      this.ratings.find(
        (r) => r.subjectType === subjectType && r.subjectKey === subjectKey && r.actorType === actorType && r.actorId === actorId
      ) ?? null
    );
  }
  async createRating(data: RatingWriteData): Promise<RatingRow> {
    const t = this.now();
    const row: RatingRow = { id: `r-${++this.seq}`, tenantId: null, ...data, createdAt: t, updatedAt: t };
    this.ratings.push(row);
    return row;
  }
  async updateRating(id: string, data: RatingWriteData) {
    const row = this.ratings.find((r) => r.id === id)!;
    Object.assign(row, data, { updatedAt: this.now() });
    return row;
  }
  async listRatings(subjectType: string, subjectKey: string) {
    return this.ratings.filter((r) => r.subjectType === subjectType && r.subjectKey === subjectKey);
  }
  async recentRatings(f: { actorType?: string; subjectType?: string; limit: number }) {
    return this.ratings
      .filter((r) => (!f.actorType || r.actorType === f.actorType) && (!f.subjectType || r.subjectType === f.subjectType))
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, f.limit);
  }
  async findDataset(id: string) {
    return this.datasets.get(id) ?? null;
  }
  async modelVersionExists(id: string) {
    return this.modelVersions.has(id);
  }
  async trainingJobExists(id: string) {
    return this.trainingJobs.has(id);
  }
  async datasetExists(id: string) {
    return this.datasets.has(id);
  }
  async experimentExists(id: string) {
    return this.experiments.has(id);
  }
  async existingEvaluationEpisodeIds(ids: string[]) {
    return new Set(ids.filter((id) => this.evalEpisodes.has(id)));
  }
  async simToRealValidationExists(id: string) {
    return this.validations.has(id);
  }
  async episodeRewardExists(datasetId: string, rewardType: string) {
    return this.rewards.has(`${datasetId}/${rewardType}`);
  }
  async findAgentCard(name: string) {
    return this.agents.has(name) ? { name } : null;
  }
}

let repo: FakeRepo;
let sink: { logAIDecision: ReturnType<typeof vi.fn> };
let svc: SocialService;

beforeEach(() => {
  repo = new FakeRepo();
  repo.datasets.set('ds-1', { id: 'ds-1', kind: 'materialized', demonstrationCount: 3 });
  repo.datasets.set('view-1', { id: 'view-1', kind: 'view', demonstrationCount: 2 });
  repo.modelVersions.add('mv-1');
  repo.trainingJobs.add('tj-1');
  repo.experiments.add('exp-1');
  repo.evalEpisodes.add('ee-1');
  repo.evalEpisodes.add('ee-2');
  repo.validations.add('s2r-1');
  repo.rewards.add('ds-1/robometer');
  sink = { logAIDecision: vi.fn().mockResolvedValue({}) };
  svc = new SocialService(repo as unknown as SocialRepository, sink as unknown as SocialComplianceSink);
});

async function expectCode(p: Promise<unknown>, status: number, code: string): Promise<SocialError> {
  const err = await p.then(
    () => {
      throw new Error('expected a rejection');
    },
    (e: unknown) => e
  );
  expect(err).toBeInstanceOf(SocialError);
  expect((err as SocialError).statusCode).toBe(status);
  expect((err as SocialError).code).toBe(code);
  return err as SocialError;
}

describe('subjects', () => {
  const all: Array<[string, string, number | undefined]> = [
    ['dataset', 'ds-1', undefined],
    ['dataset_view', 'view-1', undefined],
    ['model_version', 'mv-1', undefined],
    ['episode', 'ds-1', 2],
    ['training_job', 'tj-1', undefined],
    ['experiment', 'exp-1', undefined],
  ];

  it.each(all)('a user can comment and rate on %s', async (type, id, ep) => {
    const subject = await svc.resolveSubject(type, id, ep);
    const c = await svc.createComment(subject, USER, { body: 'looks good' });
    expect(c.subjectType).toBe(type);
    const { rating } = await svc.putRating(subject, USER, { score: 0.8 });
    expect(rating.score).toBe(0.8);
    expect(rating.episodeIndex).toBe(ep ?? null);
    expect(await svc.listThreads(subject)).toHaveLength(1);
  });

  it('rejects a comment on a subject that does not exist', async () => {
    await expectCode(svc.resolveSubject('dataset', 'nope', undefined), 404, 'SOCIAL_SUBJECT_NOT_FOUND');
    await expectCode(svc.resolveSubject('model_version', 'nope', undefined), 404, 'SOCIAL_SUBJECT_NOT_FOUND');
    await expectCode(svc.resolveSubject('training_job', 'nope', undefined), 404, 'SOCIAL_SUBJECT_NOT_FOUND');
    await expectCode(svc.resolveSubject('experiment', 'nope', undefined), 404, 'SOCIAL_SUBJECT_NOT_FOUND');
    await expectCode(svc.resolveSubject('dataset_view', 'ds-1', undefined), 404, 'SOCIAL_SUBJECT_NOT_FOUND');
    await expectCode(svc.resolveSubject('episode', 'ds-1', 3), 404, 'SOCIAL_SUBJECT_NOT_FOUND');
  });

  it('rejects malformed subjects', async () => {
    await expectCode(svc.resolveSubject('robot', 'x', undefined), 400, 'SOCIAL_SUBJECT_TYPE_INVALID');
    await expectCode(svc.resolveSubject('episode', 'ds-1', undefined), 400, 'SOCIAL_SUBJECT_INVALID');
    await expectCode(svc.resolveSubject('episode', 'ds-1', -1), 400, 'SOCIAL_SUBJECT_INVALID');
    await expectCode(svc.resolveSubject('dataset', 'ds-1', 1), 400, 'SOCIAL_SUBJECT_INVALID');
    await expectCode(svc.resolveSubject('dataset', 'view-1', undefined), 400, 'SOCIAL_SUBJECT_INVALID');
  });

  it('accepts an episode index given as a query string', async () => {
    expect(await svc.resolveSubject('episode', 'ds-1', '1')).toEqual({ subjectType: 'episode', subjectId: 'ds-1', episodeIndex: 1 });
  });
});

describe('ratings and evidence', () => {
  let subject: SubjectRef;
  beforeEach(async () => {
    subject = await svc.resolveSubject('model_version', 'mv-1', undefined);
  });

  it('rejects an agent rating without evidence with a 400 that says why', async () => {
    const err = await expectCode(svc.putRating(subject, AGENT, { score: 0.9 }), 400, 'SOCIAL_AGENT_EVIDENCE_REQUIRED');
    expect(err.message).toMatch(/must cite evidence/);
    expect(repo.ratings).toHaveLength(0);
  });

  it('lets a user rate on judgement alone', async () => {
    const { rating } = await svc.putRating(subject, USER, { score: 0.4 });
    expect(rating.evidence).toEqual([]);
    expect(sink.logAIDecision).not.toHaveBeenCalled();
  });

  it('rejects evidence naming an id that does not exist', async () => {
    const cases = [
      { kind: 'evaluation_episode', ids: ['ee-1', 'ghost'] },
      { kind: 'sim_to_real_validation', id: 'ghost' },
      { kind: 'episode_reward', datasetId: 'ds-1', rewardType: 'topreward' },
      { kind: 'training_job', id: 'ghost' },
      { kind: 'model_version', id: 'ghost' },
      { kind: 'dataset', id: 'ghost' },
    ];
    for (const e of cases) {
      await expectCode(svc.putRating(subject, AGENT, { score: 0.9, evidence: [e as never] }), 400, 'SOCIAL_EVIDENCE_NOT_FOUND');
      await expectCode(svc.putRating(subject, USER, { score: 0.9, evidence: [e as never] }), 400, 'SOCIAL_EVIDENCE_NOT_FOUND');
    }
    expect(repo.ratings).toHaveLength(0);
  });

  it('rejects malformed evidence and dimensions', async () => {
    await expectCode(svc.putRating(subject, AGENT, { score: 0.9, evidence: [{ kind: 'vibes' } as never] }), 400, 'SOCIAL_EVIDENCE_INVALID');
    await expectCode(
      svc.putRating(subject, AGENT, { score: 0.9, evidence: [{ kind: 'external', uri: 'javascript:alert(1)', note: 'x' }] }),
      400,
      'SOCIAL_EVIDENCE_INVALID'
    );
    await expectCode(svc.putRating(subject, USER, { score: 1.5 }), 400, 'SOCIAL_RATING_INVALID');
    await expectCode(svc.putRating(subject, USER, { score: 0.5, dimensions: { coverage: 0.5 } }), 400, 'SOCIAL_RATING_INVALID');
    await expectCode(svc.putRating(subject, USER, { score: 0.5, dimensions: { latency: 2 } }), 400, 'SOCIAL_RATING_INVALID');
  });

  it('accepts an agent rating with existing evidence and logs it to compliance', async () => {
    const evidence = [
      { kind: 'evaluation_episode' as const, ids: ['ee-1', 'ee-2'] },
      { kind: 'sim_to_real_validation' as const, id: 's2r-1' },
      { kind: 'episode_reward' as const, datasetId: 'ds-1', rewardType: 'robometer' },
      { kind: 'external' as const, uri: 'https://example.org/report', note: 'bench report' },
    ];
    const { rating, created } = await svc.putRating(subject, AGENT, { score: 0.72, dimensions: { successRate: 0.72 }, evidence });
    expect(created).toBe(true);
    expect(rating.evidence).toEqual(evidence);
    expect(sink.logAIDecision).toHaveBeenCalledTimes(1);
    const call = sink.logAIDecision.mock.calls[0][0];
    expect(call.payload.metadata.evidence).toEqual(evidence);
    expect(call.payload.metadata.ratingId).toBe(rating.id);
    expect(call.payload.metadata.actorId).toBe('eval-agent');
  });

  it('keeps one rating per actor per subject — a second PUT updates', async () => {
    const first = await svc.putRating(subject, USER, { score: 0.2 });
    const second = await svc.putRating(subject, USER, { score: 0.9, comment: 'changed my mind' });
    expect(second.created).toBe(false);
    expect(second.rating.id).toBe(first.rating.id);
    expect(repo.ratings).toHaveLength(1);
    expect(repo.ratings[0].score).toBe(0.9);
    // A different episode of the same dataset is a different subject.
    const ep0 = await svc.resolveSubject('episode', 'ds-1', 0);
    const ep1 = await svc.resolveSubject('episode', 'ds-1', 1);
    await svc.putRating(ep0, USER, { score: 0.1 });
    await svc.putRating(ep1, USER, { score: 0.3 });
    await svc.putRating(ep1, USER, { score: 0.5 });
    expect(repo.ratings).toHaveLength(3);
  });

  it('updates the winner when a concurrent create hits the unique index', async () => {
    const spy = vi.spyOn(repo, 'findRating').mockResolvedValueOnce(null);
    await repo.createRating({
      subjectType: 'model_version', subjectId: 'mv-1', episodeIndex: null, subjectKey: 'mv-1',
      actorType: 'user', actorId: 'u-1', displayName: 'Ada', score: 0.1, dimensionsJson: '{}', evidenceJson: '[]', comment: null,
    });
    vi.spyOn(repo, 'createRating').mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }));
    const { rating, created } = await svc.putRating(subject, USER, { score: 0.6 });
    expect(created).toBe(false);
    expect(rating.score).toBe(0.6);
    expect(repo.ratings).toHaveLength(1);
    spy.mockRestore();
  });

  it('reports human and agent means separately', async () => {
    await svc.putRating(subject, USER, { score: 1, dimensions: { robustness: 0.5 } });
    await svc.putRating(subject, USER2, { score: 0.6 });
    await svc.putRating(subject, AGENT, { score: 0.2, dimensions: { robustness: 0.1 }, evidence: [{ kind: 'training_job', id: 'tj-1' }] });
    await svc.createComment(subject, USER, { body: 'hi' });
    const s = await svc.summary(subject);
    expect(s.count).toBe(3);
    expect(s.byActorType.user).toEqual({ count: 2, mean: 0.8 });
    expect(s.byActorType.agent).toEqual({ count: 1, mean: 0.2 });
    expect(s.byActorType.system).toEqual({ count: 0, mean: null });
    expect(s.byDimension.robustness.count).toBe(2);
    expect(s.byDimension.robustness.mean).toBeCloseTo(0.3);
    expect(s.commentCount).toBe(1);
  });
});

describe('comments', () => {
  let subject: SubjectRef;
  beforeEach(async () => {
    subject = await svc.resolveSubject('dataset', 'ds-1', undefined);
  });

  it('threads one level deep', async () => {
    const top = await svc.createComment(subject, USER, { body: 'top' });
    const reply = await svc.createComment(subject, USER2, { body: 'reply', parentId: top.id });
    await expectCode(svc.createComment(subject, USER, { body: 'deeper', parentId: reply.id }), 400, 'SOCIAL_COMMENT_INVALID');
    const threads = await svc.listThreads(subject);
    expect(threads).toHaveLength(1);
    expect(threads[0].replies.map((r) => r.body)).toEqual(['reply']);
  });

  it('refuses a parent from another subject', async () => {
    const other = await svc.resolveSubject('training_job', 'tj-1', undefined);
    const top = await svc.createComment(other, USER, { body: 'elsewhere' });
    await expectCode(svc.createComment(subject, USER, { body: 'x', parentId: top.id }), 400, 'SOCIAL_COMMENT_INVALID');
  });

  it('soft-deleting a comment with replies keeps the thread readable', async () => {
    const top = await svc.createComment(subject, USER, { body: 'top secret' });
    await svc.createComment(subject, USER2, { body: 'the reply' });
    await svc.createComment(subject, USER2, { body: 'a reply', parentId: top.id });
    const deleted = await svc.deleteComment(top.id, USER);
    expect(deleted.deletedAt).not.toBeNull();
    expect(deleted.body).toBe('');
    const threads = await svc.listThreads(subject);
    const thread = threads.find((t) => t.id === top.id)!;
    expect(thread.deletedAt).not.toBeNull();
    expect(thread.body).toBe('');
    expect(thread.replies.map((r) => r.body)).toEqual(['a reply']);
  });

  it('drops a soft-deleted comment without replies from the thread list', async () => {
    const lone = await svc.createComment(subject, USER, { body: 'lonely' });
    await svc.deleteComment(lone.id, USER);
    expect(await svc.listThreads(subject)).toEqual([]);
  });

  it('only the author edits or deletes', async () => {
    const c = await svc.createComment(subject, USER, { body: 'mine' });
    await expectCode(svc.editComment(c.id, USER2, 'hijack'), 403, 'SOCIAL_NOT_AUTHOR');
    await expectCode(svc.deleteComment(c.id, AGENT), 403, 'SOCIAL_NOT_AUTHOR');
    const edited = await svc.editComment(c.id, USER, 'mine, edited');
    expect(edited.body).toBe('mine, edited');
    expect(edited.editedAt).not.toBeNull();
    await expectCode(svc.editComment('ghost', USER, 'x'), 404, 'SOCIAL_COMMENT_NOT_FOUND');
  });

  it('validates comment evidence too', async () => {
    await expectCode(
      svc.createComment(subject, AGENT, { body: 'see run', evidence: [{ kind: 'training_job', id: 'ghost' }] }),
      400,
      'SOCIAL_EVIDENCE_NOT_FOUND'
    );
    const c = await svc.createComment(subject, AGENT, { body: 'see run', evidence: [{ kind: 'training_job', id: 'tj-1' }] });
    expect(c.evidence).toEqual([{ kind: 'training_job', id: 'tj-1' }]);
  });
});

describe('feed', () => {
  it('returns activity across subject types, newest first, with filters', async () => {
    const ds = await svc.resolveSubject('dataset', 'ds-1', undefined);
    const mv = await svc.resolveSubject('model_version', 'mv-1', undefined);
    const tj = await svc.resolveSubject('training_job', 'tj-1', undefined);
    await svc.createComment(ds, USER, { body: 'first' });
    await svc.putRating(mv, AGENT, { score: 0.5, evidence: [{ kind: 'training_job', id: 'tj-1' }] });
    await svc.createComment(tj, AGENT, { body: 'third' });

    const items = await svc.feed({});
    expect(items.map((i) => [i.kind, i.subjectType])).toEqual([
      ['comment', 'training_job'],
      ['rating', 'model_version'],
      ['comment', 'dataset'],
    ]);
    expect((await svc.feed({ actorType: 'agent' })).map((i) => i.subjectType)).toEqual(['training_job', 'model_version']);
    expect((await svc.feed({ subjectType: 'dataset' })).map((i) => i.text)).toEqual(['first']);
    expect(await svc.feed({ limit: 1 })).toHaveLength(1);
  });
});
