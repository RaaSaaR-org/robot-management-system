/**
 * @file TwinZoneRepository.ts
 * @description Data access layer for TwinZone (L2 semantic zones — typed
 *              polygons in the twin world frame). `points` and `metadata` are
 *              JSON columns: stringified on write, parsed on read.
 * @feature digitaltwin
 */

import { prisma } from '../database/index.js';
import type { TwinZone as PrismaTwinZone } from '@prisma/client';
import type {
  TwinZoneRecord,
  TwinZoneType,
  TwinZonePoint,
  CreateTwinZoneInput,
  UpdateTwinZoneInput,
} from '../types/twin.types.js';

function safeParseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function dbToDomain(row: PrismaTwinZone): TwinZoneRecord {
  return {
    id: row.id,
    twinId: row.twinId,
    name: row.name,
    type: row.type as TwinZoneType,
    points: safeParseJson<TwinZonePoint[]>(row.points, []),
    minZ: row.minZ,
    maxZ: row.maxZ,
    color: row.color,
    metadata: safeParseJson<Record<string, unknown> | null>(row.metadata, null),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class TwinZoneRepository {
  async create(input: CreateTwinZoneInput): Promise<TwinZoneRecord> {
    const row = await prisma.twinZone.create({
      data: {
        twinId: input.twinId,
        name: input.name,
        type: input.type,
        points: JSON.stringify(input.points ?? []),
        ...(input.minZ !== undefined ? { minZ: input.minZ } : {}),
        ...(input.maxZ !== undefined ? { maxZ: input.maxZ } : {}),
        color: input.color ?? null,
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      },
    });
    return dbToDomain(row);
  }

  async findById(id: string): Promise<TwinZoneRecord | null> {
    const row = await prisma.twinZone.findUnique({ where: { id } });
    return row ? dbToDomain(row) : null;
  }

  async listByTwin(twinId: string): Promise<TwinZoneRecord[]> {
    const rows = await prisma.twinZone.findMany({
      where: { twinId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(dbToDomain);
  }

  async update(id: string, input: UpdateTwinZoneInput): Promise<TwinZoneRecord | null> {
    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.type !== undefined) data.type = input.type;
    if (input.points !== undefined) data.points = JSON.stringify(input.points);
    if (input.minZ !== undefined) data.minZ = input.minZ;
    if (input.maxZ !== undefined) data.maxZ = input.maxZ;
    if (input.color !== undefined) data.color = input.color;
    if (input.metadata !== undefined) {
      data.metadata = input.metadata ? JSON.stringify(input.metadata) : null;
    }
    try {
      const row = await prisma.twinZone.update({ where: { id }, data });
      return dbToDomain(row);
    } catch {
      return null;
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      await prisma.twinZone.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }
}

export const twinZoneRepository = new TwinZoneRepository();
