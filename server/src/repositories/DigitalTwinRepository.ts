/**
 * @file DigitalTwinRepository.ts
 * @description Data access layer for DigitalTwin (the system-of-record for one
 *              scanned workzone). JSON-free model; plain scalar columns.
 * @feature digitaltwin
 */

import { prisma } from '../database/index.js';
import type { DigitalTwin as PrismaDigitalTwin } from '@prisma/client';
import type {
  DigitalTwinRecord,
  DigitalTwinStatus,
  TwinStorageBackend,
  CreateDigitalTwinInput,
  UpdateDigitalTwinInput,
} from '../types/twin.types.js';

function dbToDomain(row: PrismaDigitalTwin): DigitalTwinRecord {
  return {
    id: row.id,
    name: row.name,
    robotId: row.robotId,
    floor: row.floor,
    status: row.status as DigitalTwinStatus,
    version: row.version,
    worldOriginX: row.worldOriginX,
    worldOriginY: row.worldOriginY,
    worldOriginZ: row.worldOriginZ,
    resolution: row.resolution,
    minX: row.minX,
    minY: row.minY,
    minZ: row.minZ,
    maxX: row.maxX,
    maxY: row.maxY,
    maxZ: row.maxZ,
    pointCount: row.pointCount,
    storageBackend: row.storageBackend as TwinStorageBackend,
    cloudKey: row.cloudKey,
    meshKey: row.meshKey,
    occupancyPgmKey: row.occupancyPgmKey,
    occupancyYamlKey: row.occupancyYamlKey,
    roadmapKey: row.roadmapKey,
    simSceneKey: row.simSceneKey,
    simSceneBackend: row.simSceneBackend,
    errorMessage: row.errorMessage,
    tenantId: row.tenantId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class DigitalTwinRepository {
  async create(input: CreateDigitalTwinInput): Promise<DigitalTwinRecord> {
    const row = await prisma.digitalTwin.create({
      data: {
        name: input.name,
        robotId: input.robotId ?? null,
        floor: input.floor ?? null,
        status: input.status ?? 'draft',
        ...(input.resolution !== undefined ? { resolution: input.resolution } : {}),
        tenantId: input.tenantId ?? null,
      },
    });
    return dbToDomain(row);
  }

  async findById(id: string): Promise<DigitalTwinRecord | null> {
    const row = await prisma.digitalTwin.findUnique({ where: { id } });
    return row ? dbToDomain(row) : null;
  }

  async list(limit = 200): Promise<DigitalTwinRecord[]> {
    const rows = await prisma.digitalTwin.findMany({
      orderBy: { updatedAt: 'desc' },
      take: limit,
    });
    return rows.map(dbToDomain);
  }

  async update(id: string, input: UpdateDigitalTwinInput): Promise<DigitalTwinRecord | null> {
    try {
      const row = await prisma.digitalTwin.update({
        where: { id },
        data: { ...input },
      });
      return dbToDomain(row);
    } catch {
      return null;
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      await prisma.digitalTwin.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }
}

export const digitalTwinRepository = new DigitalTwinRepository();
