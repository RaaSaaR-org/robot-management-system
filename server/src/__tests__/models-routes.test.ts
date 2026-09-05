/**
 * @file models-routes.test.ts
 * @description Tests for the writable model registry (TASK-238): route
 *   validation on POST/PATCH /api/models/versions, checkpoint upsert
 *   idempotency on a repeated (trainingJobId, epoch), and lineage resolution
 *   including the cycle guard that keeps a model out of its own ancestry.
 *   The routes run against a mocked repository; the two repository suites run
 *   the real repository against an in-memory Prisma double.
 * @feature deployment
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const { mockModelVersionRepository, mockSkillDefinitionRepository, prismaDouble } = vi.hoisted(() => ({
  mockModelVersionRepository: {
    findAll: vi.fn(),
    findById: vi.fn(),
    findByIdWithRelations: vi.fn(),
    getEvaluationSummary: vi.fn(),
    getLineage: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  mockSkillDefinitionRepository: {
    findAll: vi.fn(),
    update: vi.fn(),
  },
  prismaDouble: {
    modelVersions: new Map<string, Record<string, unknown>>(),
    checkpoints: new Map<string, Record<string, unknown>>(),
  },
}));

vi.mock('../repositories/index.js', () => ({
  modelVersionRepository: mockModelVersionRepository,
  skillDefinitionRepository: mockSkillDefinitionRepository,
}));

vi.mock('../database/index.js', () => ({
  prisma: {
    modelVersion: {
      findUnique: vi.fn(
        async ({
          where,
          include,
        }: {
          where: { id: string };
          include?: { children?: unknown };
        }) => {
          const row = prismaDouble.modelVersions.get(where.id);
          if (!row) return null;
          if (!include?.children) return row;
          const children = [...prismaDouble.modelVersions.values()].filter(
            (candidate) => candidate.parentModelVersionId === where.id
          );
          return { ...row, children };
        }
      ),
    },
    modelCheckpoint: {
      upsert: vi.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { trainingJobId_epoch: { trainingJobId: string; epoch: number } };
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          const key = `${where.trainingJobId_epoch.trainingJobId}#${where.trainingJobId_epoch.epoch}`;
          const existing = prismaDouble.checkpoints.get(key);
          const row = existing
            ? { ...existing, ...update }
            : { id: `ckpt-${key}`, createdAt: new Date('2026-09-05T00:00:00Z'), ...create };
          prismaDouble.checkpoints.set(key, row);
          return row;
        }
      ),
      findMany: vi.fn(async ({ where }: { where: { trainingJobId?: string } }) =>
        [...prismaDouble.checkpoints.values()]
          .filter((row) => row.trainingJobId === where.trainingJobId)
          .sort((a, b) => (a.epoch as number) - (b.epoch as number))
      ),
    },
  },
}));

import { modelsRoutes } from '../routes/models.routes.js';
import { ModelCheckpointRepository, ModelVersionRepository } from '../repositories/VLARepository.js';

function createApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api/models', modelsRoutes);
  return app;
}

const MODEL_ROW = {
  id: 'mv-1',
  skillId: null,
  trainingJobId: null,
  name: 'GR00T-N1.7 AppleToPlate',
  sourceKind: 'imported',
  parentModelVersionId: null,
  modelType: 'vla',
  version: 'v1',
  artifactUri: 's3://models/mv-1',
  checkpointUri: null,
  trainingMetrics: '{}',
  validationMetrics: '{}',
  deploymentStatus: 'staging',
  createdAt: new Date('2026-09-05T00:00:00Z'),
  updatedAt: new Date('2026-09-05T00:00:00Z'),
};

/** A domain-shaped ModelVersion, as the repository would hand one back. */
function domainModel(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...MODEL_ROW,
    trainingMetrics: {},
    validationMetrics: {},
    checkpointUri: undefined,
    ...overrides,
  };
}

function seedRow(overrides: Record<string, unknown>): void {
  const row = { ...MODEL_ROW, ...overrides };
  prismaDouble.modelVersions.set(row.id as string, row);
}

/** A paginated repository result carrying the given skills. */
function skillPage(skills: Record<string, unknown>[]): Record<string, unknown> {
  return {
    data: skills,
    pagination: { page: 1, pageSize: 50, total: skills.length, totalPages: 1 },
  };
}

describe('POST /api/models/versions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockModelVersionRepository.create.mockResolvedValue(domainModel());
    mockSkillDefinitionRepository.findAll.mockResolvedValue(skillPage([]));
  });

  it('rejects an artifactUri with no scheme and names the accepted schemes', async () => {
    const res = await request(createApp())
      .post('/api/models/versions')
      .send({ version: 'v1', artifactUri: '/home/humanoid/checkpoints/g1_apple_pnp' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('hf://');
    expect(res.body.error).toContain('s3://');
    expect(res.body.error).toContain('file://');
    expect(mockModelVersionRepository.create).not.toHaveBeenCalled();
  });

  it('rejects a scheme-shaped prefix with nothing after it', async () => {
    const res = await request(createApp())
      .post('/api/models/versions')
      .send({ version: 'v1', artifactUri: 's3://' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('s3://');
  });

  it.each(['hf://lerobot/g1_apple_pnp', 's3://models/g1', 'file:///models/g1'])(
    'accepts %s',
    async (artifactUri) => {
      const res = await request(createApp())
        .post('/api/models/versions')
        .send({ version: 'v1', artifactUri });

      expect(res.status).toBe(201);
      expect(mockModelVersionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ artifactUri })
      );
    }
  );

  it('registers a model with no trainingJobId as sourceKind imported', async () => {
    const res = await request(createApp())
      .post('/api/models/versions')
      .send({
        name: 'GR00T-N1.7 AppleToPlate',
        version: 'v1',
        artifactUri: 's3://models/mv-1',
      });

    expect(res.status).toBe(201);
    expect(mockModelVersionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'GR00T-N1.7 AppleToPlate',
        trainingJobId: null,
        parentModelVersionId: null,
        skillId: null,
        sourceKind: 'imported',
      })
    );
    expect(res.body.modelVersion.id).toBe('mv-1');
  });

  it('registers a model with a parent as sourceKind derived', async () => {
    mockModelVersionRepository.findById.mockResolvedValue(domainModel());

    const res = await request(createApp())
      .post('/api/models/versions')
      .send({ version: 'v2', artifactUri: 's3://models/mv-2', parentModelVersionId: 'mv-1' });

    expect(res.status).toBe(201);
    expect(mockModelVersionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ parentModelVersionId: 'mv-1', sourceKind: 'derived' })
    );
  });

  it('rejects a parentModelVersionId that does not exist', async () => {
    mockModelVersionRepository.findById.mockResolvedValue(null);

    const res = await request(createApp())
      .post('/api/models/versions')
      .send({ version: 'v2', artifactUri: 's3://models/mv-2', parentModelVersionId: 'ghost' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('ghost');
    expect(mockModelVersionRepository.create).not.toHaveBeenCalled();
  });

  it('requires version and rejects an unknown deploymentStatus', async () => {
    const app = createApp();

    const missingVersion = await request(app)
      .post('/api/models/versions')
      .send({ artifactUri: 's3://models/mv-1' });
    expect(missingVersion.status).toBe(400);

    const badStatus = await request(app)
      .post('/api/models/versions')
      .send({ version: 'v1', artifactUri: 's3://models/mv-1', deploymentStatus: 'live' });
    expect(badStatus.status).toBe(400);
    expect(badStatus.body.error).toContain('production');
  });
});

describe('PATCH /api/models/versions/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockModelVersionRepository.findById.mockResolvedValue(domainModel());
    mockModelVersionRepository.update.mockResolvedValue(
      domainModel({ skillId: 'skill-1', deploymentStatus: 'production' })
    );
    mockSkillDefinitionRepository.findAll.mockResolvedValue(skillPage([]));
    mockSkillDefinitionRepository.update.mockResolvedValue({ id: 'skill-1' });
  });

  it('sets skillId and deploymentStatus, leaving absent fields untouched', async () => {
    const res = await request(createApp())
      .patch('/api/models/versions/mv-1')
      .send({ skillId: 'skill-1', deploymentStatus: 'production' });

    expect(res.status).toBe(200);
    expect(mockModelVersionRepository.update).toHaveBeenCalledWith('mv-1', {
      skillId: 'skill-1',
      deploymentStatus: 'production',
    });
    expect(res.body.modelVersion.skillId).toBe('skill-1');
  });

  it('passes an explicit null through as an unlink', async () => {
    await request(createApp()).patch('/api/models/versions/mv-1').send({ skillId: null });

    expect(mockModelVersionRepository.update).toHaveBeenCalledWith('mv-1', { skillId: null });
  });

  it('points the skill back at the model, so the skill resolves it', async () => {
    const res = await request(createApp())
      .patch('/api/models/versions/mv-1')
      .send({ skillId: 'skill-1' });

    expect(res.status).toBe(200);
    // Without the back-pointer the Skill Library card and
    // SkillExecutionService — both of which read
    // SkillDefinition.linkedModelVersionId — resolve nothing.
    expect(mockSkillDefinitionRepository.update).toHaveBeenCalledWith('skill-1', {
      linkedModelVersionId: 'mv-1',
    });
  });

  it('clears the back-pointer of a skill this model no longer claims', async () => {
    mockSkillDefinitionRepository.findAll.mockResolvedValue(
      skillPage([{ id: 'skill-old', linkedModelVersionId: 'mv-1' }])
    );
    mockModelVersionRepository.update.mockResolvedValue(domainModel({ skillId: null }));

    await request(createApp()).patch('/api/models/versions/mv-1').send({ skillId: null });

    expect(mockSkillDefinitionRepository.findAll).toHaveBeenCalledWith({
      linkedModelVersionId: 'mv-1',
    });
    expect(mockSkillDefinitionRepository.update).toHaveBeenCalledWith('skill-old', {
      linkedModelVersionId: null,
    });
  });

  it('moves the link: the previous skill is cleared, the new one set', async () => {
    mockSkillDefinitionRepository.findAll.mockResolvedValue(
      skillPage([{ id: 'skill-old', linkedModelVersionId: 'mv-1' }])
    );

    await request(createApp()).patch('/api/models/versions/mv-1').send({ skillId: 'skill-1' });

    expect(mockSkillDefinitionRepository.update).toHaveBeenCalledWith('skill-old', {
      linkedModelVersionId: null,
    });
    expect(mockSkillDefinitionRepository.update).toHaveBeenCalledWith('skill-1', {
      linkedModelVersionId: 'mv-1',
    });
  });

  it('leaves both edges alone when the PATCH does not mention skillId', async () => {
    await request(createApp())
      .patch('/api/models/versions/mv-1')
      .send({ deploymentStatus: 'production' });

    expect(mockSkillDefinitionRepository.update).not.toHaveBeenCalled();
  });

  it('404s for a model that does not exist', async () => {
    mockModelVersionRepository.findById.mockResolvedValue(null);

    const res = await request(createApp())
      .patch('/api/models/versions/ghost')
      .send({ name: 'nope' });

    expect(res.status).toBe(404);
    expect(mockModelVersionRepository.update).not.toHaveBeenCalled();
  });
});

describe('GET /api/models/versions/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the version with its relations and the evaluation summary', async () => {
    mockModelVersionRepository.findByIdWithRelations.mockResolvedValue(
      domainModel({ children: [], checkpoints: [{ epoch: 1, uri: 's3://ckpt/1' }] })
    );
    mockModelVersionRepository.getEvaluationSummary.mockResolvedValue({
      episodeCount: 4,
      successCount: 3,
      successRate: 0.75,
    });

    const res = await request(createApp()).get('/api/models/versions/mv-1');

    expect(res.status).toBe(200);
    expect(res.body.modelVersion.checkpoints).toHaveLength(1);
    expect(res.body.evaluation).toEqual({
      episodeCount: 4,
      successCount: 3,
      successRate: 0.75,
    });
  });

  it('404s for an unknown id', async () => {
    mockModelVersionRepository.findByIdWithRelations.mockResolvedValue(null);

    const res = await request(createApp()).get('/api/models/versions/ghost');

    expect(res.status).toBe(404);
    expect(mockModelVersionRepository.getEvaluationSummary).not.toHaveBeenCalled();
  });
});

describe('GET /api/models/versions/:id/lineage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the ancestor chain and direct children', async () => {
    mockModelVersionRepository.getLineage.mockResolvedValue({
      modelVersionId: 'mv-2',
      ancestors: [domainModel({ id: 'mv-1' })],
      children: [],
    });

    const res = await request(createApp()).get('/api/models/versions/mv-2/lineage');

    expect(res.status).toBe(200);
    expect(res.body.lineage.ancestors.map((a: { id: string }) => a.id)).toEqual(['mv-1']);
  });

  it('404s for an unknown id', async () => {
    mockModelVersionRepository.getLineage.mockResolvedValue(null);

    const res = await request(createApp()).get('/api/models/versions/ghost/lineage');

    expect(res.status).toBe(404);
  });
});

describe('ModelCheckpointRepository.create (upsert idempotency)', () => {
  const repository = new ModelCheckpointRepository();

  beforeEach(() => {
    prismaDouble.checkpoints.clear();
  });

  it('re-reporting the same (trainingJobId, epoch) updates the row instead of adding one', async () => {
    await repository.create({
      trainingJobId: 'job-1',
      epoch: 3,
      uri: 's3://ckpt/job-1/3',
      metrics: { loss: 0.4 },
    });
    await repository.create({
      trainingJobId: 'job-1',
      epoch: 3,
      uri: 's3://ckpt/job-1/3-retry',
    });

    const checkpoints = await repository.listByJob('job-1');
    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0].uri).toBe('s3://ckpt/job-1/3-retry');
    // The retry carried no metrics, so the first report's must survive.
    expect(checkpoints[0].metrics).toEqual({ loss: 0.4 });
  });

  it('keeps a different epoch of the same job as its own row', async () => {
    await repository.create({ trainingJobId: 'job-1', epoch: 1, uri: 's3://ckpt/job-1/1' });
    await repository.create({ trainingJobId: 'job-1', epoch: 2, uri: 's3://ckpt/job-1/2' });

    const checkpoints = await repository.listByJob('job-1');
    expect(checkpoints.map((c) => c.epoch)).toEqual([1, 2]);
  });
});

describe('ModelVersionRepository.getLineage (cycle guard)', () => {
  const repository = new ModelVersionRepository();

  beforeEach(() => {
    prismaDouble.modelVersions.clear();
  });

  it('walks the chain to the root, nearest parent first', async () => {
    seedRow({ id: 'root', parentModelVersionId: null });
    seedRow({ id: 'mid', parentModelVersionId: 'root' });
    seedRow({ id: 'leaf', parentModelVersionId: 'mid' });

    const lineage = await repository.getLineage('leaf');

    expect(lineage?.ancestors.map((a) => a.id)).toEqual(['mid', 'root']);
    expect(lineage?.children).toEqual([]);
  });

  it('returns the direct children of the queried model', async () => {
    seedRow({ id: 'root', parentModelVersionId: null });
    seedRow({ id: 'child-a', parentModelVersionId: 'root' });
    seedRow({ id: 'child-b', parentModelVersionId: 'root' });
    seedRow({ id: 'grandchild', parentModelVersionId: 'child-a' });

    const lineage = await repository.getLineage('root');

    expect(lineage?.children.map((c) => c.id).sort()).toEqual(['child-a', 'child-b']);
  });

  it('a model that is its own parent is not its own ancestor', async () => {
    seedRow({ id: 'self', parentModelVersionId: 'self' });

    const lineage = await repository.getLineage('self');

    expect(lineage?.ancestors).toEqual([]);
  });

  it('stops on a two-model cycle instead of looping forever', async () => {
    seedRow({ id: 'a', parentModelVersionId: 'b' });
    seedRow({ id: 'b', parentModelVersionId: 'a' });

    const lineage = await repository.getLineage('a');

    expect(lineage?.ancestors.map((x) => x.id)).toEqual(['b']);
    expect(lineage?.ancestors.map((x) => x.id)).not.toContain('a');
  });

  it('returns null for a model that does not exist', async () => {
    expect(await repository.getLineage('ghost')).toBeNull();
  });
});
