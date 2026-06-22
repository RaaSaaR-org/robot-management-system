/**
 * @file EmbodimentService.test.ts
 * @description Unit tests for EmbodimentService — embodiment CRUD, robot-type linking, YAML validation, and events
 * @feature vla
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock for the Prisma client (the service does `new PrismaClient()`)
// ---------------------------------------------------------------------------

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    embodiment: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    robotType: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('@prisma/client', () => ({
  PrismaClient: class {
    embodiment = mockPrisma.embodiment;
    robotType = mockPrisma.robotType;
  },
}));

import { EmbodimentService, embodimentService } from '../EmbodimentService.js';
import type { CreateEmbodimentInput } from '../../types/embodiment.types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_YAML = `
embodiment_tag: so101
manufacturer: TheRobotStudio
model: SO-ARM100
action:
  dim: 6
  normalization:
    mean: [0, 0, 0, 0, 0, 0]
    std: [1, 1, 1, 1, 1, 1]
proprioception:
  dim: 6
  joint_names: [j1, j2, j3, j4, j5, j6]
`;

function makeInput(overrides: Partial<CreateEmbodimentInput> = {}): CreateEmbodimentInput {
  return {
    tag: 'so101',
    manufacturer: 'TheRobotStudio',
    model: 'SO-ARM100',
    description: 'arm',
    configYaml: VALID_YAML,
    actionDim: 6,
    proprioceptionDim: 6,
    ...overrides,
  };
}

function makeEmbodimentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'emb-1',
    tag: 'so101',
    manufacturer: 'TheRobotStudio',
    model: 'SO-ARM100',
    description: 'arm',
    configYaml: VALID_YAML,
    actionDim: 6,
    proprioceptionDim: 6,
    robotTypeId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    robotType: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ===========================================================================
// initialize / isInitialized / getInstance
// ===========================================================================

describe('lifecycle', () => {
  it('getInstance returns a stable singleton equal to the exported instance', () => {
    expect(EmbodimentService.getInstance()).toBe(embodimentService);
  });

  it('initialize flips isInitialized and is idempotent', async () => {
    await embodimentService.initialize();
    expect(embodimentService.isInitialized()).toBe(true);
    // second call returns without error
    await expect(embodimentService.initialize()).resolves.toBeUndefined();
  });
});

// ===========================================================================
// validateYamlConfig / parseYamlConfig
// ===========================================================================

describe('validateYamlConfig', () => {
  it('accepts a fully-formed config and returns parsedConfig', () => {
    const result = embodimentService.validateYamlConfig(VALID_YAML);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.parsedConfig?.embodiment_tag).toBe('so101');
  });

  it('reports required-field errors for missing top-level fields', () => {
    const result = embodimentService.validateYamlConfig(`
action:
  dim: 6
  normalization:
    mean: [0]
    std: [1]
proprioception:
  dim: 6
  joint_names: [a]
`);
    expect(result.valid).toBe(false);
    const paths = result.errors.map((e) => e.path);
    expect(paths).toContain('embodiment_tag');
    expect(paths).toContain('manufacturer');
    expect(paths).toContain('model');
    expect(result.parsedConfig).toBeUndefined();
  });

  it('flags invalid action.dim and missing normalization arrays', () => {
    const result = embodimentService.validateYamlConfig(`
embodiment_tag: t
manufacturer: m
model: mo
action:
  dim: 0
  normalization:
    mean: notarray
proprioception:
  dim: 6
  joint_names: [a]
`);
    const paths = result.errors.map((e) => e.path);
    expect(paths).toContain('action.dim');
    expect(paths).toContain('action.normalization.mean');
    expect(paths).toContain('action.normalization.std');
  });

  it('flags invalid proprioception config', () => {
    const result = embodimentService.validateYamlConfig(`
embodiment_tag: t
manufacturer: m
model: mo
action:
  dim: 6
  normalization:
    mean: [0]
    std: [1]
proprioception:
  dim: -1
  joint_names: notarray
`);
    const paths = result.errors.map((e) => e.path);
    expect(paths).toContain('proprioception.dim');
    expect(paths).toContain('proprioception.joint_names');
  });

  it('returns a parse_error for malformed YAML', () => {
    const result = embodimentService.validateYamlConfig('::: not: valid: yaml: [');
    expect(result.valid).toBe(false);
    expect(result.errors[0].code).toBe('parse_error');
  });

  it('parseYamlConfig returns the parsed config when valid, null otherwise', () => {
    expect(embodimentService.parseYamlConfig(VALID_YAML)?.model).toBe('SO-ARM100');
    expect(embodimentService.parseYamlConfig('embodiment_tag: only')).toBeNull();
  });
});

// ===========================================================================
// createEmbodiment
// ===========================================================================

describe('createEmbodiment', () => {
  it('creates an embodiment, emits an event, and returns the row', async () => {
    const row = makeEmbodimentRow();
    mockPrisma.embodiment.create.mockResolvedValue(row);
    const events: unknown[] = [];
    const unsubscribe = embodimentService.onEmbodimentEvent((e) => events.push(e));

    const result = await embodimentService.createEmbodiment(makeInput());

    expect(result).toBe(row);
    expect(mockPrisma.embodiment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tag: 'so101', manufacturer: 'TheRobotStudio' }),
      })
    );
    expect(events).toHaveLength(1);
    expect((events[0] as { type: string }).type).toBe('embodiment:created');
    unsubscribe();
  });

  it('throws on invalid YAML without touching the DB', async () => {
    await expect(
      embodimentService.createEmbodiment(makeInput({ configYaml: 'embodiment_tag: only' }))
    ).rejects.toThrow('Invalid YAML configuration');
    expect(mockPrisma.embodiment.create).not.toHaveBeenCalled();
  });

  it('validates a provided robotTypeId and throws when it does not exist', async () => {
    mockPrisma.robotType.findUnique.mockResolvedValue(null);
    await expect(
      embodimentService.createEmbodiment(makeInput({ robotTypeId: 'rt-x' }))
    ).rejects.toThrow('Robot type not found: rt-x');
    expect(mockPrisma.embodiment.create).not.toHaveBeenCalled();
  });

  it('creates when the provided robotTypeId exists', async () => {
    mockPrisma.robotType.findUnique.mockResolvedValue({ id: 'rt-1' });
    mockPrisma.embodiment.create.mockResolvedValue(makeEmbodimentRow({ robotTypeId: 'rt-1' }));
    const result = await embodimentService.createEmbodiment(makeInput({ robotTypeId: 'rt-1' }));
    expect(result.robotTypeId).toBe('rt-1');
    expect(mockPrisma.robotType.findUnique).toHaveBeenCalledWith({ where: { id: 'rt-1' } });
  });
});

// ===========================================================================
// getEmbodiment / getEmbodimentById
// ===========================================================================

describe('getEmbodiment / getEmbodimentById', () => {
  it('looks up by tag', async () => {
    const row = makeEmbodimentRow();
    mockPrisma.embodiment.findUnique.mockResolvedValue(row);
    const result = await embodimentService.getEmbodiment('so101');
    expect(result).toBe(row);
    expect(mockPrisma.embodiment.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tag: 'so101' } })
    );
  });

  it('returns null when tag not found', async () => {
    mockPrisma.embodiment.findUnique.mockResolvedValue(null);
    expect(await embodimentService.getEmbodiment('nope')).toBeNull();
  });

  it('looks up by id', async () => {
    const row = makeEmbodimentRow();
    mockPrisma.embodiment.findUnique.mockResolvedValue(row);
    const result = await embodimentService.getEmbodimentById('emb-1');
    expect(result).toBe(row);
    expect(mockPrisma.embodiment.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'emb-1' } })
    );
  });
});

// ===========================================================================
// listEmbodiments
// ===========================================================================

describe('listEmbodiments', () => {
  it('applies defaults and computes pagination', async () => {
    mockPrisma.embodiment.count.mockResolvedValue(45);
    mockPrisma.embodiment.findMany.mockResolvedValue([makeEmbodimentRow()]);

    const result = await embodimentService.listEmbodiments();

    expect(result.pagination).toEqual({ total: 45, page: 1, pageSize: 20, totalPages: 3 });
    expect(mockPrisma.embodiment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 20, orderBy: { createdAt: 'desc' } })
    );
  });

  it('builds a where clause from filters and honors page/pageSize', async () => {
    mockPrisma.embodiment.count.mockResolvedValue(10);
    mockPrisma.embodiment.findMany.mockResolvedValue([]);

    await embodimentService.listEmbodiments({
      page: 2,
      pageSize: 5,
      manufacturer: 'Acme',
      model: 'X',
      robotTypeId: 'rt-1',
    });

    expect(mockPrisma.embodiment.count).toHaveBeenCalledWith({
      where: { manufacturer: 'Acme', model: 'X', robotTypeId: 'rt-1' },
    });
    expect(mockPrisma.embodiment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 5, take: 5 })
    );
  });
});

// ===========================================================================
// updateEmbodiment
// ===========================================================================

describe('updateEmbodiment', () => {
  it('returns null when the embodiment does not exist', async () => {
    mockPrisma.embodiment.findUnique.mockResolvedValue(null);
    const result = await embodimentService.updateEmbodiment('nope', { description: 'x' });
    expect(result).toBeNull();
    expect(mockPrisma.embodiment.update).not.toHaveBeenCalled();
  });

  it('updates an existing embodiment and emits an updated event', async () => {
    mockPrisma.embodiment.findUnique.mockResolvedValue(makeEmbodimentRow());
    const updated = makeEmbodimentRow({ description: 'new' });
    mockPrisma.embodiment.update.mockResolvedValue(updated);
    const events: { type: string }[] = [];
    const unsub = embodimentService.onEmbodimentEvent((e) => events.push(e as { type: string }));

    const result = await embodimentService.updateEmbodiment('so101', { description: 'new' });

    expect(result).toBe(updated);
    expect(events.map((e) => e.type)).toContain('embodiment:updated');
    unsub();
  });

  it('validates configYaml when provided and throws on invalid', async () => {
    mockPrisma.embodiment.findUnique.mockResolvedValue(makeEmbodimentRow());
    await expect(
      embodimentService.updateEmbodiment('so101', { configYaml: 'embodiment_tag: only' })
    ).rejects.toThrow('Invalid YAML configuration');
    expect(mockPrisma.embodiment.update).not.toHaveBeenCalled();
  });

  it('throws when the provided robotTypeId does not exist', async () => {
    mockPrisma.embodiment.findUnique.mockResolvedValue(makeEmbodimentRow());
    mockPrisma.robotType.findUnique.mockResolvedValue(null);
    await expect(
      embodimentService.updateEmbodiment('so101', { robotTypeId: 'rt-x' })
    ).rejects.toThrow('Robot type not found: rt-x');
  });
});

// ===========================================================================
// deleteEmbodiment
// ===========================================================================

describe('deleteEmbodiment', () => {
  it('returns false when nothing to delete', async () => {
    mockPrisma.embodiment.findUnique.mockResolvedValue(null);
    expect(await embodimentService.deleteEmbodiment('nope')).toBe(false);
    expect(mockPrisma.embodiment.delete).not.toHaveBeenCalled();
  });

  it('deletes and emits a deleted event when found', async () => {
    mockPrisma.embodiment.findUnique.mockResolvedValue(makeEmbodimentRow());
    mockPrisma.embodiment.delete.mockResolvedValue(makeEmbodimentRow());
    const events: { type: string }[] = [];
    const unsub = embodimentService.onEmbodimentEvent((e) => events.push(e as { type: string }));

    const result = await embodimentService.deleteEmbodiment('so101');

    expect(result).toBe(true);
    expect(mockPrisma.embodiment.delete).toHaveBeenCalledWith({ where: { tag: 'so101' } });
    expect(events.map((e) => e.type)).toContain('embodiment:deleted');
    unsub();
  });
});

// ===========================================================================
// upsertEmbodiment
// ===========================================================================

describe('upsertEmbodiment', () => {
  it('updates when the embodiment already exists', async () => {
    // getEmbodiment -> existing; updateEmbodiment findUnique -> existing; update -> row
    mockPrisma.embodiment.findUnique
      .mockResolvedValueOnce(makeEmbodimentRow()) // getEmbodiment
      .mockResolvedValueOnce(makeEmbodimentRow()); // updateEmbodiment existence check
    const updated = makeEmbodimentRow({ description: 'upserted' });
    mockPrisma.embodiment.update.mockResolvedValue(updated);

    const result = await embodimentService.upsertEmbodiment(makeInput({ description: 'upserted' }));

    expect(result).toBe(updated);
    expect(mockPrisma.embodiment.create).not.toHaveBeenCalled();
  });

  it('creates when the embodiment does not exist', async () => {
    mockPrisma.embodiment.findUnique.mockResolvedValue(null); // getEmbodiment -> not found
    const created = makeEmbodimentRow();
    mockPrisma.embodiment.create.mockResolvedValue(created);

    const result = await embodimentService.upsertEmbodiment(makeInput());

    expect(result).toBe(created);
    expect(mockPrisma.embodiment.create).toHaveBeenCalled();
  });
});

// ===========================================================================
// linkToRobotType / unlinkFromRobotType
// ===========================================================================

describe('linkToRobotType', () => {
  it('throws when the robot type does not exist', async () => {
    mockPrisma.robotType.findUnique.mockResolvedValue(null);
    await expect(embodimentService.linkToRobotType('so101', 'rt-x')).rejects.toThrow(
      'Robot type not found: rt-x'
    );
  });

  it('throws when the embodiment does not exist', async () => {
    mockPrisma.robotType.findUnique.mockResolvedValue({ id: 'rt-1' });
    mockPrisma.embodiment.findUnique.mockResolvedValue(null);
    await expect(embodimentService.linkToRobotType('nope', 'rt-1')).rejects.toThrow(
      'Embodiment not found: nope'
    );
  });

  it('links and emits a linked event', async () => {
    mockPrisma.robotType.findUnique.mockResolvedValue({ id: 'rt-1' });
    mockPrisma.embodiment.findUnique.mockResolvedValue(makeEmbodimentRow());
    const linked = makeEmbodimentRow({ robotTypeId: 'rt-1' });
    mockPrisma.embodiment.update.mockResolvedValue(linked);
    const events: { type: string; data?: { robotTypeId?: string | null } }[] = [];
    const unsub = embodimentService.onEmbodimentEvent((e) =>
      events.push(e as { type: string; data?: { robotTypeId?: string | null } })
    );

    const result = await embodimentService.linkToRobotType('so101', 'rt-1');

    expect(result).toBe(linked);
    expect(mockPrisma.embodiment.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tag: 'so101' }, data: { robotTypeId: 'rt-1' } })
    );
    const linkedEvent = events.find((e) => e.type === 'embodiment:linked');
    expect(linkedEvent?.data?.robotTypeId).toBe('rt-1');
    unsub();
  });
});

describe('unlinkFromRobotType', () => {
  it('throws when the embodiment does not exist', async () => {
    mockPrisma.embodiment.findUnique.mockResolvedValue(null);
    await expect(embodimentService.unlinkFromRobotType('nope')).rejects.toThrow(
      'Embodiment not found: nope'
    );
  });

  it('clears the robotTypeId and emits a linked event with null', async () => {
    mockPrisma.embodiment.findUnique.mockResolvedValue(makeEmbodimentRow({ robotTypeId: 'rt-1' }));
    const unlinked = makeEmbodimentRow({ robotTypeId: null });
    mockPrisma.embodiment.update.mockResolvedValue(unlinked);
    const events: { type: string; data?: { robotTypeId?: string | null } }[] = [];
    const unsub = embodimentService.onEmbodimentEvent((e) =>
      events.push(e as { type: string; data?: { robotTypeId?: string | null } })
    );

    const result = await embodimentService.unlinkFromRobotType('so101');

    expect(result).toBe(unlinked);
    expect(mockPrisma.embodiment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { robotTypeId: null } })
    );
    const linkedEvent = events.find((e) => e.type === 'embodiment:linked');
    expect(linkedEvent?.data?.robotTypeId).toBeNull();
    unsub();
  });
});

// ===========================================================================
// onEmbodimentEvent subscription mechanics
// ===========================================================================

describe('onEmbodimentEvent', () => {
  it('stops delivering events after the returned unsubscribe is called', async () => {
    mockPrisma.embodiment.create.mockResolvedValue(makeEmbodimentRow());
    const cb = vi.fn();
    const unsubscribe = embodimentService.onEmbodimentEvent(cb);

    await embodimentService.createEmbodiment(makeInput());
    expect(cb).toHaveBeenCalledTimes(1);

    unsubscribe();
    await embodimentService.createEmbodiment(makeInput());
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
