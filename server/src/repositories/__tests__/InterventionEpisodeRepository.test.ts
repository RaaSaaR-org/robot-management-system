/**
 * @file InterventionEpisodeRepository.test.ts
 * @description Unit tests for the InterventionEpisode data-access repository
 *   (TASK-179 §7). Prisma is mocked; the real db→domain mapper runs so the
 *   tests exercise stepsJson serialization/parsing.
 * @feature datasets
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  interventionEpisode: {
    create: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
  },
}));

vi.mock('../../database/index.js', () => ({
  prisma: prismaMock,
}));

import { interventionEpisodeRepository } from '../InterventionEpisodeRepository.js';

const STARTED = new Date('2026-07-07T10:00:00.000Z');
const ENDED = new Date('2026-07-07T10:01:30.000Z');

const STEPS = [
  { t: 0, source: 'policy' as const, action: [0.1, 0.2] },
  { t: 1, source: 'human' as const, action: [0.3, 0.4] },
];

function makeDbIntervention(overrides: Record<string, unknown> = {}) {
  return {
    id: 'iv-1',
    tenantId: null,
    robotId: 'robot-1',
    skillId: 'skill-1',
    taskPrompt: 'pick up the cube',
    strategy: 'dagger',
    startedAt: STARTED,
    endedAt: ENDED,
    stepsJson: JSON.stringify(STEPS),
    createdAt: STARTED,
    ...overrides,
  };
}

describe('InterventionEpisodeRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('create serializes steps to stepsJson and defaults strategy to dagger', async () => {
    prismaMock.interventionEpisode.create.mockResolvedValue(makeDbIntervention());

    const episode = await interventionEpisodeRepository.create({
      robotId: 'robot-1',
      skillId: 'skill-1',
      taskPrompt: 'pick up the cube',
      startedAt: STARTED,
      endedAt: ENDED,
      steps: STEPS,
    });

    expect(prismaMock.interventionEpisode.create).toHaveBeenCalledWith({
      data: {
        robotId: 'robot-1',
        skillId: 'skill-1',
        taskPrompt: 'pick up the cube',
        strategy: 'dagger',
        startedAt: STARTED,
        endedAt: ENDED,
        stepsJson: JSON.stringify(STEPS),
      },
    });
    expect(episode.steps).toEqual(STEPS);
  });

  it('findAll filters by robotId and parses stepsJson', async () => {
    prismaMock.interventionEpisode.findMany.mockResolvedValue([
      makeDbIntervention(),
      makeDbIntervention({ id: 'iv-2', stepsJson: 'not-json' }),
    ]);

    const episodes = await interventionEpisodeRepository.findAll('robot-1');

    expect(prismaMock.interventionEpisode.findMany).toHaveBeenCalledWith({
      where: { robotId: 'robot-1' },
      orderBy: { createdAt: 'desc' },
    });
    expect(episodes[0].steps).toEqual(STEPS);
    expect(episodes[1].steps).toEqual([]); // invalid JSON → []
  });

  it('findAll without robotId lists everything', async () => {
    prismaMock.interventionEpisode.findMany.mockResolvedValue([]);

    await interventionEpisodeRepository.findAll();

    expect(prismaMock.interventionEpisode.findMany).toHaveBeenCalledWith({
      where: undefined,
      orderBy: { createdAt: 'desc' },
    });
  });
});
