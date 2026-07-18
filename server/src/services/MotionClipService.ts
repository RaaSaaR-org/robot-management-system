/**
 * @file MotionClipService.ts
 * @description Validates and serves retargeted motion clips produced by the offline
 *              GVHMR→GMR video-to-motion pipeline.
 * @feature robots
 */

import { BadRequestError } from '../utils/errors.js';
import {
  motionClipRepository,
  type MotionClipRecord,
  type MotionClipSummary,
  type MotionFrame,
} from '../repositories/MotionClipRepository.js';

/** Body of POST /api/motion-clips. frameCount/durationSec are derived, not accepted. */
export interface CreateMotionClipRequest {
  name: string;
  source?: string;
  robotType?: string;
  fps: number;
  jointNames: string[];
  rootRotOrder?: 'xyzw' | 'wxyz';
  upAxis?: 'y' | 'z';
  warnings?: string[];
  metadata?: Record<string, unknown>;
  frames: MotionFrame[];
}

// Takes `unknown` deliberately: the request body is typed as MotionFrame[] but that is a
// claim, not a fact, so narrowing on the declared type would defeat the check.
function isFiniteNumberArray(value: unknown, length: number): boolean {
  return (
    Array.isArray(value) &&
    value.length === length &&
    value.every((n) => typeof n === 'number' && Number.isFinite(n))
  );
}

export class MotionClipService {
  private static instance: MotionClipService;

  private constructor() {}

  static getInstance(): MotionClipService {
    if (!MotionClipService.instance) {
      MotionClipService.instance = new MotionClipService();
    }
    return MotionClipService.instance;
  }

  // ==========================================================================
  // QUERY
  // ==========================================================================

  /** Summaries only — the library view never needs frame data. */
  async listClips(limit = 100): Promise<MotionClipSummary[]> {
    return motionClipRepository.listAll(limit);
  }

  async getClip(id: string): Promise<MotionClipRecord | null> {
    return motionClipRepository.findById(id);
  }

  async deleteClip(id: string): Promise<boolean> {
    return motionClipRepository.delete(id);
  }

  // ==========================================================================
  // CREATE
  // ==========================================================================

  /**
   * Persist a clip after validating it. The exporter is trusted but the endpoint
   * is not — the client is a JSON file the user picked, so a malformed clip must
   * fail here with a specific message rather than reach the viewer as NaN poses.
   */
  async createClip(input: CreateMotionClipRequest): Promise<MotionClipSummary> {
    this.validate(input);

    const frameCount = input.frames.length;
    // Rounded to the exporter's own precision so the UI shows 7.3667, not 7.366666666666666.
    const durationSec = Math.round((frameCount / input.fps) * 1e4) / 1e4;

    return motionClipRepository.create({
      name: input.name.trim(),
      source: input.source,
      robotType: input.robotType,
      fps: input.fps,
      frameCount,
      durationSec,
      jointNames: input.jointNames,
      rootRotOrder: input.rootRotOrder,
      upAxis: input.upAxis,
      warnings: input.warnings,
      metadata: input.metadata,
      frames: input.frames,
    });
  }

  /** @throws BadRequestError with a message naming the offending field/frame. */
  private validate(input: CreateMotionClipRequest): void {
    if (typeof input.name !== 'string' || input.name.trim().length === 0) {
      throw new BadRequestError('name is required');
    }
    // Float column: NTSC rates (29.97, 59.94) are legitimate, so only finiteness
    // and sign are constrained — durationSec divides by this, so 0/NaN is fatal.
    if (typeof input.fps !== 'number' || !Number.isFinite(input.fps) || input.fps <= 0) {
      throw new BadRequestError('fps must be a positive finite number');
    }
    if (input.source !== undefined && typeof input.source !== 'string') {
      throw new BadRequestError('source must be a string');
    }
    if (input.robotType !== undefined && typeof input.robotType !== 'string') {
      throw new BadRequestError('robotType must be a string');
    }
    if (
      !Array.isArray(input.jointNames) ||
      input.jointNames.length === 0 ||
      !input.jointNames.every((n) => typeof n === 'string' && n.length > 0)
    ) {
      throw new BadRequestError('jointNames must be a non-empty array of strings');
    }
    if (input.rootRotOrder !== undefined && !['xyzw', 'wxyz'].includes(input.rootRotOrder)) {
      throw new BadRequestError("rootRotOrder must be 'xyzw' or 'wxyz'");
    }
    if (input.upAxis !== undefined && !['y', 'z'].includes(input.upAxis)) {
      throw new BadRequestError("upAxis must be 'y' or 'z'");
    }
    // Elements matter, not just the container: warnings are rendered directly as
    // React children, and a non-string element throws in the viewer — permanently,
    // because by then it is persisted.
    if (
      input.warnings !== undefined &&
      (!Array.isArray(input.warnings) || !input.warnings.every((w) => typeof w === 'string'))
    ) {
      throw new BadRequestError('warnings must be an array of strings');
    }
    if (!Array.isArray(input.frames) || input.frames.length === 0) {
      throw new BadRequestError('frames must be a non-empty array');
    }

    const dof = input.jointNames.length;
    for (let i = 0; i < input.frames.length; i++) {
      const frame = input.frames[i];
      if (!frame || typeof frame !== 'object') {
        throw new BadRequestError(`frames[${i}] is not an object`);
      }
      if (!isFiniteNumberArray(frame.rootPos, 3)) {
        throw new BadRequestError(`frames[${i}].rootPos must be 3 finite numbers`);
      }
      if (!isFiniteNumberArray(frame.rootRot, 4)) {
        throw new BadRequestError(`frames[${i}].rootRot must be 4 finite numbers`);
      }
      // A dofPos/jointNames length mismatch is the retargeting bug that renders as
      // plausible-but-wrong motion, so it is fatal rather than a warning.
      if (!isFiniteNumberArray(frame.dofPos, dof)) {
        throw new BadRequestError(
          `frames[${i}].dofPos must be ${dof} finite numbers (jointNames length), got ` +
            `${Array.isArray(frame.dofPos) ? frame.dofPos.length : typeof frame.dofPos}`,
        );
      }
    }
  }
}

export const motionClipService = MotionClipService.getInstance();
