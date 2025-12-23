/**
 * @file ZoneRepository.ts
 * @description Data access layer for Zone entities
 */

import { prisma } from '../database/index.js';
import type { Zone as PrismaZone } from '@prisma/client';

// ============================================================================
// TYPES
// ============================================================================

export type ZoneType = 'operational' | 'restricted' | 'charging' | 'maintenance';

export interface ZoneBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Zone {
  id: string;
  name: string;
  floor: string;
  type: ZoneType;
  bounds: ZoneBounds;
  color?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateZoneInput {
  name: string;
  floor: string;
  type: ZoneType;
  bounds: ZoneBounds;
  color?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateZoneInput {
  name?: string;
  floor?: string;
  type?: ZoneType;
  bounds?: ZoneBounds;
  color?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface ZoneFilters {
  floor?: string;
  type?: ZoneType | ZoneType[];
}

export interface PaginationParams {
  page?: number;
  pageSize?: number;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function dbZoneToDomain(dbZone: PrismaZone): Zone {
  return {
    id: dbZone.id,
    name: dbZone.name,
    floor: dbZone.floor,
    type: dbZone.type as ZoneType,
    bounds: JSON.parse(dbZone.bounds) as ZoneBounds,
    color: dbZone.color ?? undefined,
    description: dbZone.description ?? undefined,
    metadata: dbZone.metadata ? JSON.parse(dbZone.metadata) : undefined,
    createdAt: dbZone.createdAt.toISOString(),
    updatedAt: dbZone.updatedAt.toISOString(),
  };
}

// ============================================================================
// REPOSITORY
// ============================================================================

export class ZoneRepository {
  /**
   * Find a zone by ID
   */
  async findById(id: string): Promise<Zone | null> {
    const zone = await prisma.zone.findUnique({
      where: { id },
    });
    return zone ? dbZoneToDomain(zone) : null;
  }

  /**
   * Find a zone by name and floor (unique constraint)
   */
  async findByNameAndFloor(name: string, floor: string): Promise<Zone | null> {
    const zone = await prisma.zone.findUnique({
      where: { name_floor: { name, floor } },
    });
    return zone ? dbZoneToDomain(zone) : null;
  }

  /**
   * Find all zones with optional filters and pagination
   */
  async findAll(
    filters?: ZoneFilters,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<Zone>> {
    const page = pagination?.page ?? 1;
    const pageSize = pagination?.pageSize ?? 100;
    const skip = (page - 1) * pageSize;

    const where = this.buildWhereClause(filters);

    const [zones, total] = await Promise.all([
      prisma.zone.findMany({
        where,
        orderBy: [{ floor: 'asc' }, { name: 'asc' }],
        skip,
        take: pageSize,
      }),
      prisma.zone.count({ where }),
    ]);

    return {
      data: zones.map(dbZoneToDomain),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  /**
   * Find all zones on a specific floor
   */
  async findByFloor(floor: string): Promise<Zone[]> {
    const zones = await prisma.zone.findMany({
      where: { floor },
      orderBy: { name: 'asc' },
    });
    return zones.map(dbZoneToDomain);
  }

  /**
   * Find all zones (no pagination, for caching)
   */
  async findAllUnpaginated(): Promise<Zone[]> {
    const zones = await prisma.zone.findMany({
      orderBy: [{ floor: 'asc' }, { name: 'asc' }],
    });
    return zones.map(dbZoneToDomain);
  }

  /**
   * Create a new zone
   */
  async create(input: CreateZoneInput): Promise<Zone> {
    const zone = await prisma.zone.create({
      data: {
        name: input.name,
        floor: input.floor,
        type: input.type,
        bounds: JSON.stringify(input.bounds),
        color: input.color,
        description: input.description,
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      },
    });

    return dbZoneToDomain(zone);
  }

  /**
   * Update a zone
   */
  async update(id: string, input: UpdateZoneInput): Promise<Zone | null> {
    try {
      const data: Record<string, unknown> = {};

      if (input.name !== undefined) data.name = input.name;
      if (input.floor !== undefined) data.floor = input.floor;
      if (input.type !== undefined) data.type = input.type;
      if (input.bounds !== undefined) data.bounds = JSON.stringify(input.bounds);
      if (input.color !== undefined) data.color = input.color;
      if (input.description !== undefined) data.description = input.description;
      if (input.metadata !== undefined)
        data.metadata = input.metadata ? JSON.stringify(input.metadata) : null;

      const zone = await prisma.zone.update({
        where: { id },
        data,
      });
      return dbZoneToDomain(zone);
    } catch {
      return null;
    }
  }

  /**
   * Delete a zone
   */
  async delete(id: string): Promise<boolean> {
    try {
      await prisma.zone.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Delete all zones on a floor
   */
  async deleteByFloor(floor: string): Promise<number> {
    const result = await prisma.zone.deleteMany({
      where: { floor },
    });
    return result.count;
  }

  /**
   * Check if a point is inside a zone's bounds
   */
  isPointInBounds(x: number, y: number, bounds: ZoneBounds): boolean {
    return (
      x >= bounds.x &&
      x <= bounds.x + bounds.width &&
      y >= bounds.y &&
      y <= bounds.y + bounds.height
    );
  }

  /**
   * Find the zone containing a specific point
   */
  async findZoneAtPoint(x: number, y: number, floor: string): Promise<Zone | null> {
    const zones = await this.findByFloor(floor);

    for (const zone of zones) {
      if (this.isPointInBounds(x, y, zone.bounds)) {
        return zone;
      }
    }

    return null;
  }

  /**
   * Check if two zones overlap
   */
  doBoundsOverlap(a: ZoneBounds, b: ZoneBounds): boolean {
    return !(
      a.x + a.width <= b.x ||
      b.x + b.width <= a.x ||
      a.y + a.height <= b.y ||
      b.y + b.height <= a.y
    );
  }

  /**
   * Find zones that overlap with given bounds on a floor
   */
  async findOverlappingZones(
    bounds: ZoneBounds,
    floor: string,
    excludeId?: string
  ): Promise<Zone[]> {
    const zones = await this.findByFloor(floor);

    return zones.filter((zone) => {
      if (excludeId && zone.id === excludeId) return false;
      return this.doBoundsOverlap(zone.bounds, bounds);
    });
  }

  /**
   * Build Prisma where clause from filters
   */
  private buildWhereClause(filters?: ZoneFilters): Record<string, unknown> {
    if (!filters) return {};

    const where: Record<string, unknown> = {};

    if (filters.floor) {
      where.floor = filters.floor;
    }

    if (filters.type) {
      where.type = Array.isArray(filters.type) ? { in: filters.type } : filters.type;
    }

    return where;
  }
}

export const zoneRepository = new ZoneRepository();
