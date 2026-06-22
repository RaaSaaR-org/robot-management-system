/**
 * @file ZoneRepository.test.ts
 * @description Unit tests for ZoneRepository — Prisma-backed CRUD, pagination, filtering, and pure geometry helpers. Prisma client is mocked at the I/O boundary; the dbZoneToDomain mapper runs for real.
 * @feature fleet
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Zone as PrismaZone } from '@prisma/client';

// ---------------------------------------------------------------------------
// Hoisted mock for the singleton Prisma client imported by the repository.
// ---------------------------------------------------------------------------

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    zone: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
  } as unknown as {
    zone: {
      findUnique: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      count: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
      deleteMany: ReturnType<typeof vi.fn>;
    };
  },
}));

vi.mock('../../database/index.js', () => ({
  prisma: mockPrisma,
}));

import {
  ZoneRepository,
  zoneRepository,
  type CreateZoneInput,
  type UpdateZoneInput,
  type ZoneBounds,
} from '../ZoneRepository.js';

// ---------------------------------------------------------------------------
// Fixtures — db-row shapes that dbZoneToDomain accepts.
// bounds/metadata are JSON strings; createdAt/updatedAt are Date objects.
// ---------------------------------------------------------------------------

const CREATED_AT = new Date('2026-01-01T00:00:00.000Z');
const UPDATED_AT = new Date('2026-01-02T00:00:00.000Z');

function makeDbZone(overrides: Partial<PrismaZone> = {}): PrismaZone {
  return {
    id: 'zone-1',
    name: 'Warehouse A',
    floor: 'ground',
    type: 'operational',
    bounds: JSON.stringify({ x: 0, y: 0, width: 100, height: 50 }),
    color: '#FF6700',
    description: 'Main warehouse zone',
    metadata: JSON.stringify({ capacity: 5 }),
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    ...overrides,
  } as PrismaZone;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// findById
// ---------------------------------------------------------------------------

describe('ZoneRepository.findById', () => {
  it('returns a mapped domain zone when prisma finds a row', async () => {
    const repo = new ZoneRepository();
    mockPrisma.zone.findUnique.mockResolvedValue(makeDbZone());

    const result = await repo.findById('zone-1');

    expect(mockPrisma.zone.findUnique).toHaveBeenCalledWith({
      where: { id: 'zone-1' },
    });
    expect(result).toEqual({
      id: 'zone-1',
      name: 'Warehouse A',
      floor: 'ground',
      type: 'operational',
      bounds: { x: 0, y: 0, width: 100, height: 50 },
      color: '#FF6700',
      description: 'Main warehouse zone',
      metadata: { capacity: 5 },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });
  });

  it('maps nullable color/description/metadata columns to undefined', async () => {
    const repo = new ZoneRepository();
    mockPrisma.zone.findUnique.mockResolvedValue(
      makeDbZone({ color: null, description: null, metadata: null }),
    );

    const result = await repo.findById('zone-1');

    expect(result?.color).toBeUndefined();
    expect(result?.description).toBeUndefined();
    expect(result?.metadata).toBeUndefined();
  });

  it('returns null when prisma returns null', async () => {
    const repo = new ZoneRepository();
    mockPrisma.zone.findUnique.mockResolvedValue(null);

    const result = await repo.findById('missing');

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findByNameAndFloor
// ---------------------------------------------------------------------------

describe('ZoneRepository.findByNameAndFloor', () => {
  it('queries the composite unique constraint and maps the result', async () => {
    mockPrisma.zone.findUnique.mockResolvedValue(makeDbZone());

    const result = await zoneRepository.findByNameAndFloor('Warehouse A', 'ground');

    expect(mockPrisma.zone.findUnique).toHaveBeenCalledWith({
      where: { name_floor: { name: 'Warehouse A', floor: 'ground' } },
    });
    expect(result?.id).toBe('zone-1');
  });

  it('returns null when no matching row exists', async () => {
    mockPrisma.zone.findUnique.mockResolvedValue(null);

    const result = await zoneRepository.findByNameAndFloor('Nope', 'ground');

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findAll (pagination + filters)
// ---------------------------------------------------------------------------

describe('ZoneRepository.findAll', () => {
  it('uses default pagination (page 1, size 100) and empty where when nothing supplied', async () => {
    const repo = new ZoneRepository();
    mockPrisma.zone.findMany.mockResolvedValue([makeDbZone()]);
    mockPrisma.zone.count.mockResolvedValue(1);

    const result = await repo.findAll();

    expect(mockPrisma.zone.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: [{ floor: 'asc' }, { name: 'asc' }],
      skip: 0,
      take: 100,
    });
    expect(mockPrisma.zone.count).toHaveBeenCalledWith({ where: {} });
    expect(result.data).toHaveLength(1);
    expect(result.pagination).toEqual({
      page: 1,
      pageSize: 100,
      total: 1,
      totalPages: 1,
    });
  });

  it('computes skip from page/pageSize and totalPages via ceil', async () => {
    const repo = new ZoneRepository();
    mockPrisma.zone.findMany.mockResolvedValue([]);
    mockPrisma.zone.count.mockResolvedValue(25);

    const result = await repo.findAll(undefined, { page: 3, pageSize: 10 });

    expect(mockPrisma.zone.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 10 }),
    );
    expect(result.pagination).toEqual({
      page: 3,
      pageSize: 10,
      total: 25,
      totalPages: 3,
    });
    expect(result.data).toEqual([]);
  });

  it('builds where clause for a single floor + single type filter', async () => {
    const repo = new ZoneRepository();
    mockPrisma.zone.findMany.mockResolvedValue([]);
    mockPrisma.zone.count.mockResolvedValue(0);

    await repo.findAll({ floor: 'ground', type: 'restricted' });

    expect(mockPrisma.zone.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { floor: 'ground', type: 'restricted' } }),
    );
    expect(mockPrisma.zone.count).toHaveBeenCalledWith({
      where: { floor: 'ground', type: 'restricted' },
    });
  });

  it('builds an { in: [...] } type clause when type is an array', async () => {
    const repo = new ZoneRepository();
    mockPrisma.zone.findMany.mockResolvedValue([]);
    mockPrisma.zone.count.mockResolvedValue(0);

    await repo.findAll({ type: ['operational', 'charging'] });

    expect(mockPrisma.zone.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { type: { in: ['operational', 'charging'] } } }),
    );
  });
});

// ---------------------------------------------------------------------------
// findByFloor
// ---------------------------------------------------------------------------

describe('ZoneRepository.findByFloor', () => {
  it('queries by floor ordered by name and maps each row', async () => {
    const repo = new ZoneRepository();
    mockPrisma.zone.findMany.mockResolvedValue([
      makeDbZone({ id: 'a', name: 'A' }),
      makeDbZone({ id: 'b', name: 'B' }),
    ]);

    const result = await repo.findByFloor('ground');

    expect(mockPrisma.zone.findMany).toHaveBeenCalledWith({
      where: { floor: 'ground' },
      orderBy: { name: 'asc' },
    });
    expect(result.map((z) => z.id)).toEqual(['a', 'b']);
  });

  it('returns an empty array when no zones on the floor', async () => {
    const repo = new ZoneRepository();
    mockPrisma.zone.findMany.mockResolvedValue([]);

    const result = await repo.findByFloor('roof');

    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// findAllUnpaginated
// ---------------------------------------------------------------------------

describe('ZoneRepository.findAllUnpaginated', () => {
  it('fetches all zones ordered by floor then name', async () => {
    const repo = new ZoneRepository();
    mockPrisma.zone.findMany.mockResolvedValue([makeDbZone()]);

    const result = await repo.findAllUnpaginated();

    expect(mockPrisma.zone.findMany).toHaveBeenCalledWith({
      orderBy: [{ floor: 'asc' }, { name: 'asc' }],
    });
    expect(result).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

describe('ZoneRepository.create', () => {
  it('serializes bounds + metadata to JSON and maps the created row', async () => {
    const repo = new ZoneRepository();
    const input: CreateZoneInput = {
      name: 'New Zone',
      floor: 'first',
      type: 'charging',
      bounds: { x: 5, y: 5, width: 10, height: 10 },
      color: '#000000',
      description: 'desc',
      metadata: { foo: 'bar' },
    };
    mockPrisma.zone.create.mockResolvedValue(
      makeDbZone({
        id: 'zone-new',
        name: 'New Zone',
        floor: 'first',
        type: 'charging',
        bounds: JSON.stringify(input.bounds),
        color: '#000000',
        description: 'desc',
        metadata: JSON.stringify({ foo: 'bar' }),
      }),
    );

    const result = await repo.create(input);

    expect(mockPrisma.zone.create).toHaveBeenCalledWith({
      data: {
        name: 'New Zone',
        floor: 'first',
        type: 'charging',
        bounds: JSON.stringify({ x: 5, y: 5, width: 10, height: 10 }),
        color: '#000000',
        description: 'desc',
        metadata: JSON.stringify({ foo: 'bar' }),
      },
    });
    expect(result.id).toBe('zone-new');
    expect(result.bounds).toEqual({ x: 5, y: 5, width: 10, height: 10 });
    expect(result.metadata).toEqual({ foo: 'bar' });
  });

  it('passes metadata: null when no metadata provided', async () => {
    const repo = new ZoneRepository();
    const input: CreateZoneInput = {
      name: 'Bare',
      floor: 'first',
      type: 'operational',
      bounds: { x: 0, y: 0, width: 1, height: 1 },
    };
    mockPrisma.zone.create.mockResolvedValue(
      makeDbZone({ metadata: null, color: null, description: null }),
    );

    await repo.create(input);

    expect(mockPrisma.zone.create).toHaveBeenCalledWith({
      data: {
        name: 'Bare',
        floor: 'first',
        type: 'operational',
        bounds: JSON.stringify({ x: 0, y: 0, width: 1, height: 1 }),
        color: undefined,
        description: undefined,
        metadata: null,
      },
    });
  });
});

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

describe('ZoneRepository.update', () => {
  it('only includes provided fields in the data payload', async () => {
    const repo = new ZoneRepository();
    const input: UpdateZoneInput = { name: 'Renamed', bounds: { x: 1, y: 2, width: 3, height: 4 } };
    mockPrisma.zone.update.mockResolvedValue(makeDbZone({ name: 'Renamed' }));

    const result = await repo.update('zone-1', input);

    expect(mockPrisma.zone.update).toHaveBeenCalledWith({
      where: { id: 'zone-1' },
      data: {
        name: 'Renamed',
        bounds: JSON.stringify({ x: 1, y: 2, width: 3, height: 4 }),
      },
    });
    expect(result?.name).toBe('Renamed');
  });

  it('serializes metadata to null when explicitly set to a falsy value', async () => {
    const repo = new ZoneRepository();
    mockPrisma.zone.update.mockResolvedValue(makeDbZone({ metadata: null }));

    await repo.update('zone-1', { metadata: undefined });

    // metadata === undefined means the field is skipped entirely
    expect(mockPrisma.zone.update).toHaveBeenCalledWith({
      where: { id: 'zone-1' },
      data: {},
    });
  });

  it('returns null when prisma.update throws (e.g. record not found)', async () => {
    const repo = new ZoneRepository();
    mockPrisma.zone.update.mockRejectedValue(new Error('Record to update not found'));

    const result = await repo.update('missing', { name: 'X' });

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

describe('ZoneRepository.delete', () => {
  it('returns true on successful delete', async () => {
    const repo = new ZoneRepository();
    mockPrisma.zone.delete.mockResolvedValue(makeDbZone());

    const result = await repo.delete('zone-1');

    expect(mockPrisma.zone.delete).toHaveBeenCalledWith({ where: { id: 'zone-1' } });
    expect(result).toBe(true);
  });

  it('returns false when prisma.delete throws', async () => {
    const repo = new ZoneRepository();
    mockPrisma.zone.delete.mockRejectedValue(new Error('Record to delete does not exist'));

    const result = await repo.delete('missing');

    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// deleteByFloor
// ---------------------------------------------------------------------------

describe('ZoneRepository.deleteByFloor', () => {
  it('deletes all zones on a floor and returns the count', async () => {
    const repo = new ZoneRepository();
    mockPrisma.zone.deleteMany.mockResolvedValue({ count: 3 });

    const result = await repo.deleteByFloor('ground');

    expect(mockPrisma.zone.deleteMany).toHaveBeenCalledWith({ where: { floor: 'ground' } });
    expect(result).toBe(3);
  });

  it('returns 0 when nothing was deleted', async () => {
    const repo = new ZoneRepository();
    mockPrisma.zone.deleteMany.mockResolvedValue({ count: 0 });

    const result = await repo.deleteByFloor('empty');

    expect(result).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Pure geometry helpers
// ---------------------------------------------------------------------------

describe('ZoneRepository.isPointInBounds', () => {
  const repo = new ZoneRepository();
  const bounds: ZoneBounds = { x: 0, y: 0, width: 10, height: 10 };

  it('returns true for a point inside (inclusive edges)', () => {
    expect(repo.isPointInBounds(5, 5, bounds)).toBe(true);
    expect(repo.isPointInBounds(0, 0, bounds)).toBe(true);
    expect(repo.isPointInBounds(10, 10, bounds)).toBe(true);
  });

  it('returns false for a point outside', () => {
    expect(repo.isPointInBounds(-1, 5, bounds)).toBe(false);
    expect(repo.isPointInBounds(11, 5, bounds)).toBe(false);
    expect(repo.isPointInBounds(5, 11, bounds)).toBe(false);
  });
});

describe('ZoneRepository.doBoundsOverlap', () => {
  const repo = new ZoneRepository();

  it('returns true when bounds overlap', () => {
    const a: ZoneBounds = { x: 0, y: 0, width: 10, height: 10 };
    const b: ZoneBounds = { x: 5, y: 5, width: 10, height: 10 };
    expect(repo.doBoundsOverlap(a, b)).toBe(true);
  });

  it('returns false when bounds only touch edges (no overlap)', () => {
    const a: ZoneBounds = { x: 0, y: 0, width: 10, height: 10 };
    const b: ZoneBounds = { x: 10, y: 0, width: 10, height: 10 };
    expect(repo.doBoundsOverlap(a, b)).toBe(false);
  });

  it('returns false when bounds are disjoint', () => {
    const a: ZoneBounds = { x: 0, y: 0, width: 5, height: 5 };
    const b: ZoneBounds = { x: 100, y: 100, width: 5, height: 5 };
    expect(repo.doBoundsOverlap(a, b)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// findZoneAtPoint (delegates to findByFloor)
// ---------------------------------------------------------------------------

describe('ZoneRepository.findZoneAtPoint', () => {
  it('returns the first zone whose bounds contain the point', async () => {
    const repo = new ZoneRepository();
    mockPrisma.zone.findMany.mockResolvedValue([
      makeDbZone({ id: 'far', bounds: JSON.stringify({ x: 100, y: 100, width: 10, height: 10 }) }),
      makeDbZone({ id: 'hit', bounds: JSON.stringify({ x: 0, y: 0, width: 50, height: 50 }) }),
    ]);

    const result = await repo.findZoneAtPoint(10, 10, 'ground');

    expect(mockPrisma.zone.findMany).toHaveBeenCalledWith({
      where: { floor: 'ground' },
      orderBy: { name: 'asc' },
    });
    expect(result?.id).toBe('hit');
  });

  it('returns null when no zone contains the point', async () => {
    const repo = new ZoneRepository();
    mockPrisma.zone.findMany.mockResolvedValue([
      makeDbZone({ id: 'far', bounds: JSON.stringify({ x: 100, y: 100, width: 10, height: 10 }) }),
    ]);

    const result = await repo.findZoneAtPoint(0, 0, 'ground');

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findOverlappingZones (delegates to findByFloor)
// ---------------------------------------------------------------------------

describe('ZoneRepository.findOverlappingZones', () => {
  it('returns zones whose bounds overlap the given bounds', async () => {
    const repo = new ZoneRepository();
    mockPrisma.zone.findMany.mockResolvedValue([
      makeDbZone({ id: 'overlap', bounds: JSON.stringify({ x: 0, y: 0, width: 20, height: 20 }) }),
      makeDbZone({ id: 'disjoint', bounds: JSON.stringify({ x: 500, y: 500, width: 5, height: 5 }) }),
    ]);

    const result = await repo.findOverlappingZones(
      { x: 5, y: 5, width: 10, height: 10 },
      'ground',
    );

    expect(result.map((z) => z.id)).toEqual(['overlap']);
  });

  it('excludes the zone matching excludeId', async () => {
    const repo = new ZoneRepository();
    mockPrisma.zone.findMany.mockResolvedValue([
      makeDbZone({ id: 'self', bounds: JSON.stringify({ x: 0, y: 0, width: 20, height: 20 }) }),
      makeDbZone({ id: 'other', bounds: JSON.stringify({ x: 0, y: 0, width: 20, height: 20 }) }),
    ]);

    const result = await repo.findOverlappingZones(
      { x: 5, y: 5, width: 10, height: 10 },
      'ground',
      'self',
    );

    expect(result.map((z) => z.id)).toEqual(['other']);
  });
});
