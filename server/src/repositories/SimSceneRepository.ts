/**
 * @file SimSceneRepository.ts
 * @description Data access layer for the SimScene registry (TASK-171) — physics
 *              simulation environments, either built-in or twin-derived. Replaces
 *              the 4 hardcoded environment strings in SimulationService.
 * @feature simulation
 */

import { prisma } from '../database/index.js';

export type SimSceneSource = 'builtin' | 'twin';
export type SimSceneBackend = 'mujoco' | 'isaac';

export interface SimSceneBounds {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export interface SimSceneRecord {
  id: string;
  name: string;
  description: string | null;
  source: SimSceneSource;
  builtinEnvId: string | null;
  twinId: string | null;
  embodimentTag: string;
  backend: SimSceneBackend;
  mjcfKey: string | null;
  usdKey: string | null;
  status: string;
  bounds: SimSceneBounds;
  tenantId: string | null;
  createdAt: string;
  updatedAt: string;
}

type DbScene = {
  id: string;
  name: string;
  description: string | null;
  source: string;
  builtinEnvId: string | null;
  twinId: string | null;
  embodimentTag: string;
  backend: string;
  mjcfKey: string | null;
  usdKey: string | null;
  status: string;
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  tenantId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function dbToDomain(row: DbScene): SimSceneRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    source: row.source as SimSceneSource,
    builtinEnvId: row.builtinEnvId,
    twinId: row.twinId,
    embodimentTag: row.embodimentTag,
    backend: row.backend as SimSceneBackend,
    mjcfKey: row.mjcfKey,
    usdKey: row.usdKey,
    status: row.status,
    bounds: {
      minX: row.minX,
      minY: row.minY,
      minZ: row.minZ,
      maxX: row.maxX,
      maxY: row.maxY,
      maxZ: row.maxZ,
    },
    tenantId: row.tenantId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface UpsertBuiltinSceneInput {
  builtinEnvId: string;
  name: string;
  description?: string | null;
  embodimentTag: string;
  backend: SimSceneBackend;
}

export interface UpsertTwinSceneInput {
  twinId: string;
  name: string;
  description?: string | null;
  embodimentTag: string;
  backend: SimSceneBackend;
  mjcfKey: string | null;
  usdKey?: string | null;
  status?: string;
  bounds: SimSceneBounds;
}

export class SimSceneRepository {
  async listAll(): Promise<SimSceneRecord[]> {
    const rows = await prisma.simScene.findMany({
      orderBy: [{ source: 'asc' }, { name: 'asc' }],
    });
    return rows.map((r) => dbToDomain(r as DbScene));
  }

  async findById(id: string): Promise<SimSceneRecord | null> {
    const row = await prisma.simScene.findUnique({ where: { id } });
    return row ? dbToDomain(row as DbScene) : null;
  }

  async findByTwinId(twinId: string): Promise<SimSceneRecord | null> {
    const row = await prisma.simScene.findUnique({ where: { twinId } });
    return row ? dbToDomain(row as DbScene) : null;
  }

  async findByBuiltinEnvId(builtinEnvId: string): Promise<SimSceneRecord | null> {
    const row = await prisma.simScene.findUnique({ where: { builtinEnvId } });
    return row ? dbToDomain(row as DbScene) : null;
  }

  /** Idempotent seed/refresh of a built-in scene keyed by its stable env id. */
  async upsertBuiltin(input: UpsertBuiltinSceneInput): Promise<SimSceneRecord> {
    const row = await prisma.simScene.upsert({
      where: { builtinEnvId: input.builtinEnvId },
      update: {
        name: input.name,
        description: input.description ?? null,
        embodimentTag: input.embodimentTag,
        backend: input.backend,
        source: 'builtin',
        status: 'ready',
      },
      create: {
        name: input.name,
        description: input.description ?? null,
        source: 'builtin',
        builtinEnvId: input.builtinEnvId,
        embodimentTag: input.embodimentTag,
        backend: input.backend,
        status: 'ready',
      },
    });
    return dbToDomain(row as DbScene);
  }

  /** Upsert a twin-derived scene keyed by its source twin id. */
  async upsertForTwin(input: UpsertTwinSceneInput): Promise<SimSceneRecord> {
    const data = {
      name: input.name,
      description: input.description ?? null,
      embodimentTag: input.embodimentTag,
      backend: input.backend,
      mjcfKey: input.mjcfKey,
      usdKey: input.usdKey ?? null,
      status: input.status ?? 'ready',
      minX: input.bounds.minX,
      minY: input.bounds.minY,
      minZ: input.bounds.minZ,
      maxX: input.bounds.maxX,
      maxY: input.bounds.maxY,
      maxZ: input.bounds.maxZ,
    };
    const row = await prisma.simScene.upsert({
      where: { twinId: input.twinId },
      update: data,
      create: { ...data, source: 'twin', twinId: input.twinId },
    });
    return dbToDomain(row as DbScene);
  }

  async deleteByTwinId(twinId: string): Promise<void> {
    await prisma.simScene.deleteMany({ where: { twinId } });
  }
}

export const simSceneRepository = new SimSceneRepository();
