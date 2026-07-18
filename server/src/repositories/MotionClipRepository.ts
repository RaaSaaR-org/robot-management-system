/**
 * @file MotionClipRepository.ts
 * @description Data access layer for MotionClip (retargeted motion from the GVHMR→GMR pipeline)
 * @feature robots
 */

import { prisma } from '../database/index.js';
import { Prisma } from '@prisma/client';
import type { MotionClip as PrismaMotionClip } from '@prisma/client';

// ============================================================================
// TYPES
// ============================================================================

/** One retargeted pose. Field meanings are fixed by the clip's jointNames/rootRotOrder/upAxis. */
export interface MotionFrame {
  rootPos: [number, number, number];
  rootRot: [number, number, number, number];
  dofPos: number[];
}

/** A clip without its frames — what list endpoints return. */
export interface MotionClipSummary {
  id: string;
  name: string;
  source: string;
  robotType: string;
  fps: number;
  frameCount: number;
  durationSec: number;
  jointNames: string[];
  rootRotOrder: 'xyzw' | 'wxyz';
  upAxis: 'y' | 'z';
  warnings: string[];
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface MotionClipRecord extends MotionClipSummary {
  frames: MotionFrame[];
}

export interface CreateMotionClipInput {
  name: string;
  source?: string;
  robotType?: string;
  fps: number;
  frameCount: number;
  durationSec: number;
  jointNames: string[];
  rootRotOrder?: 'xyzw' | 'wxyz';
  upAxis?: 'y' | 'z';
  warnings?: string[];
  metadata?: Record<string, unknown>;
  frames: MotionFrame[];
}

// ============================================================================
// HELPERS
// ============================================================================

function safeParseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/**
 * Every column except `frames`. Passed as an explicit Prisma `select` so the list
 * query cannot drag megabytes of frame arrays out of the DB — see listAll().
 */
const SUMMARY_SELECT = {
  id: true,
  name: true,
  source: true,
  robotType: true,
  fps: true,
  frameCount: true,
  durationSec: true,
  jointNames: true,
  rootRotOrder: true,
  upAxis: true,
  warnings: true,
  metadata: true,
  createdAt: true,
} as const;

function dbToSummary(row: Omit<PrismaMotionClip, 'frames'>): MotionClipSummary {
  return {
    id: row.id,
    name: row.name,
    source: row.source,
    robotType: row.robotType,
    fps: row.fps,
    frameCount: row.frameCount,
    durationSec: row.durationSec,
    jointNames: safeParseJson<string[]>(row.jointNames, []),
    rootRotOrder: row.rootRotOrder as 'xyzw' | 'wxyz',
    upAxis: row.upAxis as 'y' | 'z',
    warnings: safeParseJson<string[]>(row.warnings, []),
    metadata: safeParseJson<Record<string, unknown> | undefined>(row.metadata, undefined),
    createdAt: row.createdAt.toISOString(),
  };
}

function dbToDomain(row: PrismaMotionClip): MotionClipRecord {
  return {
    ...dbToSummary(row),
    frames: safeParseJson<MotionFrame[]>(row.frames, []),
  };
}

// ============================================================================
// REPOSITORY
// ============================================================================

export class MotionClipRepository {
  async create(input: CreateMotionClipInput): Promise<MotionClipSummary> {
    const row = await prisma.motionClip.create({
      data: {
        name: input.name,
        source: input.source ?? 'gmr',
        robotType: input.robotType ?? 'unitree_g1_29dof',
        fps: input.fps,
        frameCount: input.frameCount,
        durationSec: input.durationSec,
        jointNames: JSON.stringify(input.jointNames),
        rootRotOrder: input.rootRotOrder ?? 'xyzw',
        upAxis: input.upAxis ?? 'z',
        warnings: JSON.stringify(input.warnings ?? []),
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
        frames: JSON.stringify(input.frames),
      },
      select: SUMMARY_SELECT,
    });
    return dbToSummary(row);
  }

  /**
   * Newest-first clip list. The `select` is deliberate and load-bearing: `frames`
   * is a JSON TEXT column holding the whole animation, and a default findMany
   * would fetch every one of them to render a library view that shows none.
   */
  async listAll(limit = 100): Promise<MotionClipSummary[]> {
    const rows = await prisma.motionClip.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: SUMMARY_SELECT,
    });
    return rows.map(dbToSummary);
  }

  /** Full clip including frames — only ever for a single, explicitly requested id. */
  async findById(id: string): Promise<MotionClipRecord | null> {
    const row = await prisma.motionClip.findUnique({ where: { id } });
    return row ? dbToDomain(row) : null;
  }

  /**
   * @returns false only when the clip does not exist (Prisma P2025), which the route
   * maps to 404. Every other failure — connection loss, a locked SQLite file — is
   * rethrown: reporting those as "not found" would contradict the row still being
   * there on refresh, and would swallow the error unlogged.
   */
  async delete(id: string): Promise<boolean> {
    try {
      await prisma.motionClip.delete({ where: { id } });
      return true;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        return false;
      }
      throw error;
    }
  }
}

export const motionClipRepository = new MotionClipRepository();
