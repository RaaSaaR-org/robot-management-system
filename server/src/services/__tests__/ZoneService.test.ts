/**
 * @file ZoneService.test.ts
 * @description Unit tests for ZoneService — zone CRUD, validation, point/zone queries,
 *              named-location derivation, and event broadcasting. All repository access
 *              is mocked; no real DB, network, or filesystem is touched.
 * @feature fleet
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Zone, CreateZoneInput, UpdateZoneInput } from '../../repositories/index.js';

// ---------------------------------------------------------------------------
// Mock the repository boundary. ZoneService imports `zoneRepository` from
// '../repositories/index.js', so we mock that module entirely.
// ---------------------------------------------------------------------------

vi.mock('../../repositories/index.js', () => ({
  zoneRepository: {
    findById: vi.fn(),
    findAll: vi.fn(),
    findByFloor: vi.fn(),
    findAllUnpaginated: vi.fn(),
    findZoneAtPoint: vi.fn(),
    isPointInBounds: vi.fn(),
    findByNameAndFloor: vi.fn(),
    findOverlappingZones: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    deleteByFloor: vi.fn(),
  },
}));

import { ZoneService, ZoneValidationError, zoneService } from '../ZoneService.js';
import { zoneRepository } from '../../repositories/index.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeZone(overrides: Partial<Zone> = {}): Zone {
  return {
    id: 'z1',
    name: 'Zone A',
    floor: '1',
    type: 'operational',
    bounds: { x: 0, y: 0, width: 100, height: 100 },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeCreateInput(overrides: Partial<CreateZoneInput> = {}): CreateZoneInput {
  return {
    name: 'Zone A',
    floor: '1',
    type: 'operational',
    bounds: { x: 0, y: 0, width: 100, height: 100 },
    ...overrides,
  };
}

// A fresh service per test isolates the in-memory event subscriber set.
let service: ZoneService;

beforeEach(() => {
  vi.clearAllMocks();
  service = new ZoneService();
  // Sensible default: no duplicates, no overlaps.
  vi.mocked(zoneRepository.findByNameAndFloor).mockResolvedValue(null);
  vi.mocked(zoneRepository.findOverlappingZones).mockResolvedValue([]);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

// ===========================================================================
// Query operations
// ===========================================================================

describe('getZone', () => {
  it('returns the zone from the repository', async () => {
    const zone = makeZone();
    vi.mocked(zoneRepository.findById).mockResolvedValue(zone);
    await expect(service.getZone('z1')).resolves.toBe(zone);
    expect(zoneRepository.findById).toHaveBeenCalledWith('z1');
  });

  it('returns null when the zone does not exist', async () => {
    vi.mocked(zoneRepository.findById).mockResolvedValue(null);
    await expect(service.getZone('missing')).resolves.toBeNull();
  });
});

describe('getZones', () => {
  it('delegates filters and pagination to the repository', async () => {
    const result = { data: [makeZone()], pagination: { page: 1, pageSize: 20, total: 1 } };
    vi.mocked(zoneRepository.findAll).mockResolvedValue(result as never);
    const filters = { floor: '1' };
    const pagination = { page: 1, pageSize: 20 };
    await expect(service.getZones(filters, pagination)).resolves.toBe(result);
    expect(zoneRepository.findAll).toHaveBeenCalledWith(filters, pagination);
  });
});

describe('getZonesByFloor', () => {
  it('returns zones for the given floor', async () => {
    const zones = [makeZone()];
    vi.mocked(zoneRepository.findByFloor).mockResolvedValue(zones);
    await expect(service.getZonesByFloor('2')).resolves.toBe(zones);
    expect(zoneRepository.findByFloor).toHaveBeenCalledWith('2');
  });
});

describe('getAllZones', () => {
  it('returns the unpaginated list', async () => {
    const zones = [makeZone(), makeZone({ id: 'z2' })];
    vi.mocked(zoneRepository.findAllUnpaginated).mockResolvedValue(zones);
    await expect(service.getAllZones()).resolves.toBe(zones);
  });
});

describe('getZoneAtPoint', () => {
  it('delegates to the repository', async () => {
    const zone = makeZone();
    vi.mocked(zoneRepository.findZoneAtPoint).mockResolvedValue(zone);
    await expect(service.getZoneAtPoint(5, 5, '1')).resolves.toBe(zone);
    expect(zoneRepository.findZoneAtPoint).toHaveBeenCalledWith(5, 5, '1');
  });

  it('returns null when no zone contains the point', async () => {
    vi.mocked(zoneRepository.findZoneAtPoint).mockResolvedValue(null);
    await expect(service.getZoneAtPoint(999, 999, '1')).resolves.toBeNull();
  });
});

describe('isPointInZone', () => {
  it('delegates to the repository bounds check with the zone bounds', () => {
    const zone = makeZone();
    vi.mocked(zoneRepository.isPointInBounds).mockReturnValue(true);
    expect(service.isPointInZone(10, 20, zone)).toBe(true);
    expect(zoneRepository.isPointInBounds).toHaveBeenCalledWith(10, 20, zone.bounds);
  });

  it('returns false when the point is outside bounds', () => {
    vi.mocked(zoneRepository.isPointInBounds).mockReturnValue(false);
    expect(service.isPointInZone(10, 20, makeZone())).toBe(false);
  });
});

describe('isPointInRestrictedZone', () => {
  it('returns true when the zone at the point is restricted', async () => {
    vi.mocked(zoneRepository.findZoneAtPoint).mockResolvedValue(
      makeZone({ type: 'restricted' })
    );
    await expect(service.isPointInRestrictedZone(1, 1, '1')).resolves.toBe(true);
  });

  it('returns false when the zone is a non-restricted type', async () => {
    vi.mocked(zoneRepository.findZoneAtPoint).mockResolvedValue(
      makeZone({ type: 'operational' })
    );
    await expect(service.isPointInRestrictedZone(1, 1, '1')).resolves.toBe(false);
  });

  it('returns false when there is no zone at the point', async () => {
    vi.mocked(zoneRepository.findZoneAtPoint).mockResolvedValue(null);
    await expect(service.isPointInRestrictedZone(1, 1, '1')).resolves.toBe(false);
  });
});

// ===========================================================================
// getNamedLocations
// ===========================================================================

describe('getNamedLocations', () => {
  it('derives normalized keys and rounded center coordinates', async () => {
    vi.mocked(zoneRepository.findAllUnpaginated).mockResolvedValue([
      makeZone({
        id: 'a',
        name: 'Warehouse A',
        floor: '2',
        type: 'operational',
        bounds: { x: 10, y: 20, width: 31, height: 51 },
      }),
    ]);

    const locations = await service.getNamedLocations();

    // 'Warehouse A' -> 'warehouse_a'; center = round(10+31/2)=26, round(20+51/2)=46 (rounds .5 up)
    expect(locations['warehouse_a']).toEqual({
      x: 26,
      y: 46,
      floor: '2',
      zone: 'Warehouse A',
    });
  });

  it('adds charging aliases for charging zones', async () => {
    vi.mocked(zoneRepository.findAllUnpaginated).mockResolvedValue([
      makeZone({ id: 'c', name: 'Dock 1', type: 'charging' }),
    ]);

    const locations = await service.getNamedLocations();
    expect(locations['charging_station']).toEqual(locations['dock_1']);
    expect(locations['charge']).toEqual(locations['dock_1']);
  });

  it('adds a maintenance alias for maintenance zones', async () => {
    vi.mocked(zoneRepository.findAllUnpaginated).mockResolvedValue([
      makeZone({ id: 'm', name: 'Repair Bay', type: 'maintenance' }),
    ]);

    const locations = await service.getNamedLocations();
    expect(locations['maintenance']).toEqual(locations['repair_bay']);
  });

  it('always includes a default home location when none is defined', async () => {
    vi.mocked(zoneRepository.findAllUnpaginated).mockResolvedValue([]);
    const locations = await service.getNamedLocations();
    expect(locations['home']).toEqual({ x: 0, y: 0, floor: '1', zone: 'Home Base' });
  });
});

// ===========================================================================
// createZone
// ===========================================================================

describe('createZone', () => {
  it('creates a zone and emits a zone_created event on valid input', async () => {
    const input = makeCreateInput();
    const created = makeZone();
    vi.mocked(zoneRepository.create).mockResolvedValue(created);
    const cb = vi.fn();
    service.onZoneEvent(cb);

    const result = await service.createZone(input);

    expect(result).toBe(created);
    expect(zoneRepository.create).toHaveBeenCalledWith(input);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0]).toMatchObject({ type: 'zone_created', zone: created });
    expect(typeof cb.mock.calls[0][0].timestamp).toBe('string');
  });

  it('throws ZoneValidationError and skips create when required fields missing', async () => {
    const input = makeCreateInput({ name: '   ', floor: '', type: undefined as never });

    await expect(service.createZone(input)).rejects.toBeInstanceOf(ZoneValidationError);
    expect(zoneRepository.create).not.toHaveBeenCalled();

    const err = (await service.createZone(input).catch((e) => e)) as ZoneValidationError;
    const fields = err.errors.map((e) => e.field);
    expect(fields).toContain('name');
    expect(fields).toContain('floor');
    expect(fields).toContain('type');
  });

  it('rejects an invalid zone type', async () => {
    const input = makeCreateInput({ type: 'bogus' as never });
    const err = (await service.createZone(input).catch((e) => e)) as ZoneValidationError;
    expect(err).toBeInstanceOf(ZoneValidationError);
    expect(err.errors.some((e) => e.field === 'type')).toBe(true);
  });

  it('rejects non-positive width/height bounds', async () => {
    const input = makeCreateInput({ bounds: { x: 0, y: 0, width: 0, height: -5 } });
    const err = (await service.createZone(input).catch((e) => e)) as ZoneValidationError;
    const fields = err.errors.map((e) => e.field);
    expect(fields).toContain('bounds.width');
    expect(fields).toContain('bounds.height');
  });

  it('rejects a duplicate name on the same floor', async () => {
    vi.mocked(zoneRepository.findByNameAndFloor).mockResolvedValue(makeZone());
    const err = (await service
      .createZone(makeCreateInput())
      .catch((e) => e)) as ZoneValidationError;
    expect(err.errors.some((e) => e.field === 'name')).toBe(true);
    expect(zoneRepository.create).not.toHaveBeenCalled();
  });

  it('rejects a restricted zone that overlaps another restricted zone', async () => {
    vi.mocked(zoneRepository.findOverlappingZones).mockResolvedValue([
      makeZone({ id: 'other', name: 'Existing Restricted', type: 'restricted' }),
    ]);
    const input = makeCreateInput({ type: 'restricted' });

    const err = (await service.createZone(input).catch((e) => e)) as ZoneValidationError;
    expect(err.errors.some((e) => e.field === 'bounds')).toBe(true);
    expect(zoneRepository.create).not.toHaveBeenCalled();
  });

  it('allows a restricted zone overlapping only non-restricted zones', async () => {
    vi.mocked(zoneRepository.findOverlappingZones).mockResolvedValue([
      makeZone({ id: 'op', type: 'operational' }),
    ]);
    const created = makeZone({ type: 'restricted' });
    vi.mocked(zoneRepository.create).mockResolvedValue(created);

    await expect(service.createZone(makeCreateInput({ type: 'restricted' }))).resolves.toBe(
      created
    );
  });
});

// ===========================================================================
// updateZone
// ===========================================================================

describe('updateZone', () => {
  it('updates a zone and emits a zone_updated event', async () => {
    vi.mocked(zoneRepository.findById).mockResolvedValue(makeZone());
    const updated = makeZone({ name: 'Renamed' });
    vi.mocked(zoneRepository.update).mockResolvedValue(updated);
    const cb = vi.fn();
    service.onZoneEvent(cb);

    const input: UpdateZoneInput = { name: 'Renamed' };
    const result = await service.updateZone('z1', input);

    expect(result).toBe(updated);
    expect(zoneRepository.update).toHaveBeenCalledWith('z1', input);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0]).toMatchObject({ type: 'zone_updated', zone: updated });
  });

  it('throws ZoneValidationError when the zone does not exist', async () => {
    vi.mocked(zoneRepository.findById).mockResolvedValue(null);
    const err = (await service
      .updateZone('nope', { name: 'X' })
      .catch((e) => e)) as ZoneValidationError;
    expect(err).toBeInstanceOf(ZoneValidationError);
    expect(err.errors[0].field).toBe('id');
    expect(zoneRepository.update).not.toHaveBeenCalled();
  });

  it('rejects an invalid type on update', async () => {
    vi.mocked(zoneRepository.findById).mockResolvedValue(makeZone());
    const err = (await service
      .updateZone('z1', { type: 'bad' as never })
      .catch((e) => e)) as ZoneValidationError;
    expect(err.errors.some((e) => e.field === 'type')).toBe(true);
  });

  it('rejects a rename that collides with another zone on the same floor', async () => {
    vi.mocked(zoneRepository.findById).mockResolvedValue(makeZone({ id: 'z1' }));
    vi.mocked(zoneRepository.findByNameAndFloor).mockResolvedValue(
      makeZone({ id: 'other', name: 'Taken' })
    );
    const err = (await service
      .updateZone('z1', { name: 'Taken' })
      .catch((e) => e)) as ZoneValidationError;
    expect(err.errors.some((e) => e.field === 'name')).toBe(true);
  });

  it('allows a "rename" to the same zone (self) without collision error', async () => {
    const self = makeZone({ id: 'z1', name: 'Same' });
    vi.mocked(zoneRepository.findById).mockResolvedValue(self);
    vi.mocked(zoneRepository.findByNameAndFloor).mockResolvedValue(self);
    vi.mocked(zoneRepository.update).mockResolvedValue(self);

    await expect(service.updateZone('z1', { name: 'Same' })).resolves.toBe(self);
  });

  it('returns null and emits no event when the repository update returns null', async () => {
    vi.mocked(zoneRepository.findById).mockResolvedValue(makeZone());
    vi.mocked(zoneRepository.update).mockResolvedValue(null);
    const cb = vi.fn();
    service.onZoneEvent(cb);

    await expect(service.updateZone('z1', { color: 'red' })).resolves.toBeNull();
    expect(cb).not.toHaveBeenCalled();
  });

  it('rejects an update making a zone a restricted overlap', async () => {
    vi.mocked(zoneRepository.findById).mockResolvedValue(makeZone({ type: 'operational' }));
    vi.mocked(zoneRepository.findOverlappingZones).mockResolvedValue([
      makeZone({ id: 'other', type: 'restricted' }),
    ]);
    const err = (await service
      .updateZone('z1', { type: 'restricted' })
      .catch((e) => e)) as ZoneValidationError;
    expect(err.errors.some((e) => e.field === 'bounds')).toBe(true);
    // overlap check should exclude self by id
    expect(zoneRepository.findOverlappingZones).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      'z1'
    );
  });
});

// ===========================================================================
// deleteZone
// ===========================================================================

describe('deleteZone', () => {
  it('returns false and skips delete when the zone is missing', async () => {
    vi.mocked(zoneRepository.findById).mockResolvedValue(null);
    await expect(service.deleteZone('nope')).resolves.toBe(false);
    expect(zoneRepository.delete).not.toHaveBeenCalled();
  });

  it('deletes the zone and emits a zone_deleted event', async () => {
    const zone = makeZone();
    vi.mocked(zoneRepository.findById).mockResolvedValue(zone);
    vi.mocked(zoneRepository.delete).mockResolvedValue(true);
    const cb = vi.fn();
    service.onZoneEvent(cb);

    await expect(service.deleteZone('z1')).resolves.toBe(true);
    expect(zoneRepository.delete).toHaveBeenCalledWith('z1');
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0]).toMatchObject({ type: 'zone_deleted', zone });
  });

  it('does not emit an event when the repository reports no deletion', async () => {
    vi.mocked(zoneRepository.findById).mockResolvedValue(makeZone());
    vi.mocked(zoneRepository.delete).mockResolvedValue(false);
    const cb = vi.fn();
    service.onZoneEvent(cb);

    await expect(service.deleteZone('z1')).resolves.toBe(false);
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('deleteZonesByFloor', () => {
  it('returns the count of deleted zones', async () => {
    vi.mocked(zoneRepository.deleteByFloor).mockResolvedValue(3);
    await expect(service.deleteZonesByFloor('2')).resolves.toBe(3);
    expect(zoneRepository.deleteByFloor).toHaveBeenCalledWith('2');
  });
});

// ===========================================================================
// Events
// ===========================================================================

describe('onZoneEvent', () => {
  it('unsubscribes via the returned function', async () => {
    const created = makeZone();
    vi.mocked(zoneRepository.create).mockResolvedValue(created);
    const cb = vi.fn();
    const unsubscribe = service.onZoneEvent(cb);

    await service.createZone(makeCreateInput());
    expect(cb).toHaveBeenCalledTimes(1);

    unsubscribe();
    await service.createZone(makeCreateInput({ name: 'Zone B' }));
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('isolates a throwing subscriber from others', async () => {
    const created = makeZone();
    vi.mocked(zoneRepository.create).mockResolvedValue(created);
    const bad = vi.fn(() => {
      throw new Error('callback boom');
    });
    const good = vi.fn();
    service.onZoneEvent(bad);
    service.onZoneEvent(good);

    await expect(service.createZone(makeCreateInput())).resolves.toBe(created);
    expect(good).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// Singleton export
// ===========================================================================

describe('zoneService singleton', () => {
  it('is an instance of ZoneService', () => {
    expect(zoneService).toBeInstanceOf(ZoneService);
  });
});
