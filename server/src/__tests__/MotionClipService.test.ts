/**
 * @file MotionClipService.test.ts
 * @description Unit tests for MotionClipService validation and derived fields
 * @feature robots
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestError } from '../utils/errors.js';

// ============================================================================
// MOCKS
// ============================================================================

const { mockMotionClipRepository } = vi.hoisted(() => ({
  mockMotionClipRepository: {
    create: vi.fn(),
    listAll: vi.fn(),
    findById: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../repositories/MotionClipRepository.js', () => ({
  motionClipRepository: mockMotionClipRepository,
}));

import { motionClipService, MAX_CLIP_FRAMES } from '../services/MotionClipService.js';
import type { CreateMotionClipRequest } from '../services/MotionClipService.js';
import type { MotionFrame } from '../repositories/MotionClipRepository.js';

// ============================================================================
// TEST HELPERS
// ============================================================================

const JOINT_NAMES = ['left_hip_pitch_joint', 'right_hip_pitch_joint'];

function makeFrame(): MotionFrame {
  return { rootPos: [0, 0, 0.79], rootRot: [0, 0, 0, 1], dofPos: [0.1, -0.1] };
}

function makeClip(overrides: Partial<CreateMotionClipRequest> = {}): CreateMotionClipRequest {
  return {
    name: 'wave',
    fps: 30,
    jointNames: [...JOINT_NAMES],
    frames: [makeFrame(), makeFrame()],
    ...overrides,
  };
}

/** Asserts createClip rejects with a BadRequestError naming the field, and persists nothing. */
async function rejectsWith(
  input: CreateMotionClipRequest,
  message: string | RegExp,
): Promise<void> {
  const err = await motionClipService.createClip(input).then(
    () => {
      throw new Error('expected createClip to reject');
    },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(BadRequestError);
  expect((err as Error).message).toMatch(message);
  expect(mockMotionClipRepository.create).not.toHaveBeenCalled();
}

// ============================================================================
// TESTS
// ============================================================================

describe('MotionClipService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMotionClipRepository.create.mockImplementation(async (input) => ({
      id: 'clip-001',
      ...input,
    }));
  });

  // ─── createClip: happy path & derived fields ────────────────────────

  describe('createClip', () => {
    it('accepts a minimal valid clip and passes the full input (frames included) to the repository', async () => {
      const clip = makeClip();
      const result = await motionClipService.createClip(clip);

      expect(mockMotionClipRepository.create).toHaveBeenCalledTimes(1);
      expect(mockMotionClipRepository.create).toHaveBeenCalledWith({
        name: 'wave',
        source: undefined,
        robotType: undefined,
        fps: 30,
        frameCount: 2,
        durationSec: 0.0667,
        jointNames: JOINT_NAMES,
        rootRotOrder: undefined,
        upAxis: undefined,
        warnings: undefined,
        metadata: undefined,
        frames: clip.frames,
      });
      expect(result.id).toBe('clip-001');
    });

    it('derives durationSec rounded to 4 decimals (NTSC fps)', async () => {
      const frame = makeFrame();
      const clip = makeClip({
        fps: 29.97,
        frames: Array.from({ length: 221 }, () => frame),
      });

      await motionClipService.createClip(clip);

      // 221 / 29.97 = 7.37404070... → rounds to 7.374
      expect(Math.round((221 / 29.97) * 1e4) / 1e4).toBe(7.374);
      expect(mockMotionClipRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ frameCount: 221, durationSec: 7.374 }),
      );
    });

    it('trims the clip name before persisting', async () => {
      await motionClipService.createClip(makeClip({ name: '  wave  ' }));
      expect(mockMotionClipRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'wave' }),
      );
    });

    it('accepts a clip at exactly MAX_CLIP_FRAMES frames', async () => {
      const frame = makeFrame();
      const clip = makeClip({
        frames: Array.from({ length: MAX_CLIP_FRAMES }, () => frame),
      });

      await motionClipService.createClip(clip);

      expect(mockMotionClipRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ frameCount: MAX_CLIP_FRAMES, durationSec: 1000 }),
      );
    });
  });

  // ─── createClip: validation rejections ──────────────────────────────

  describe('createClip validation', () => {
    it('rejects a missing name', async () => {
      await rejectsWith(makeClip({ name: undefined as unknown as string }), 'name is required');
    });

    it('rejects a whitespace-only name', async () => {
      await rejectsWith(makeClip({ name: '   ' }), 'name is required');
    });

    it.each([
      ['zero', 0],
      ['negative', -30],
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
      ['non-number', '30' as unknown as number],
    ])('rejects fps %s', async (_label, fps) => {
      await rejectsWith(makeClip({ fps }), 'fps must be a positive finite number');
    });

    it('rejects a non-string source', async () => {
      await rejectsWith(makeClip({ source: 42 as unknown as string }), 'source must be a string');
    });

    it('rejects a non-string robotType', async () => {
      await rejectsWith(
        makeClip({ robotType: 42 as unknown as string }),
        'robotType must be a string',
      );
    });

    it('rejects empty jointNames', async () => {
      await rejectsWith(
        makeClip({ jointNames: [] }),
        'jointNames must be a non-empty array of strings',
      );
    });

    it('rejects jointNames with non-string elements', async () => {
      await rejectsWith(
        makeClip({ jointNames: ['a', 42 as unknown as string] }),
        'jointNames must be a non-empty array of strings',
      );
    });

    it("rejects rootRotOrder 'WXYZ' (case-sensitive enum)", async () => {
      await rejectsWith(
        makeClip({ rootRotOrder: 'WXYZ' as 'wxyz' }),
        "rootRotOrder must be 'xyzw' or 'wxyz'",
      );
    });

    it("rejects upAxis 'Y' (case-sensitive enum)", async () => {
      await rejectsWith(makeClip({ upAxis: 'Y' as 'y' }), "upAxis must be 'y' or 'z'");
    });

    it('rejects warnings with a non-string element', async () => {
      await rejectsWith(
        makeClip({ warnings: ['ok', 123 as unknown as string] }),
        'warnings must be an array of strings',
      );
    });

    it('rejects non-array warnings', async () => {
      await rejectsWith(
        makeClip({ warnings: 'oops' as unknown as string[] }),
        'warnings must be an array of strings',
      );
    });

    it('rejects empty frames', async () => {
      await rejectsWith(makeClip({ frames: [] }), 'frames must be a non-empty array');
    });

    it('rejects clips over MAX_CLIP_FRAMES with an actionable message', async () => {
      const frame = makeFrame();
      const clip = makeClip({
        frames: Array.from({ length: MAX_CLIP_FRAMES + 1 }, () => frame),
      });
      await rejectsWith(clip, `clip has ${MAX_CLIP_FRAMES + 1} frames, more than the ${MAX_CLIP_FRAMES} maximum`);
      await expect(motionClipService.createClip(clip)).rejects.toThrow(
        /trim or split the clip before importing/,
      );
    });

    it('rejects a non-object frame with its index', async () => {
      await rejectsWith(
        makeClip({ frames: [makeFrame(), null as unknown as MotionFrame] }),
        'frames[1] is not an object',
      );
    });

    it('rejects a frame missing rootPos', async () => {
      const bad = makeFrame();
      delete (bad as Partial<MotionFrame>).rootPos;
      await rejectsWith(makeClip({ frames: [bad] }), 'frames[0].rootPos must be 3 finite numbers');
    });

    it('rejects a frame missing rootRot', async () => {
      const bad = makeFrame();
      delete (bad as Partial<MotionFrame>).rootRot;
      await rejectsWith(makeClip({ frames: [bad] }), 'frames[0].rootRot must be 4 finite numbers');
    });

    it('rejects a frame missing dofPos, reporting its type', async () => {
      const bad = makeFrame();
      delete (bad as Partial<MotionFrame>).dofPos;
      await rejectsWith(
        makeClip({ frames: [bad] }),
        'frames[0].dofPos must be 2 finite numbers (jointNames length), got undefined',
      );
    });

    it('rejects a dofPos length mismatch vs jointNames, reporting the actual length', async () => {
      const bad = makeFrame();
      bad.dofPos = [0.1];
      await rejectsWith(
        makeClip({ frames: [makeFrame(), bad] }),
        'frames[1].dofPos must be 2 finite numbers (jointNames length), got 1',
      );
    });

    it('rejects non-finite rootPos values', async () => {
      const bad = makeFrame();
      bad.rootPos = [0, 0, Number.POSITIVE_INFINITY];
      await rejectsWith(makeClip({ frames: [bad] }), 'frames[0].rootPos must be 3 finite numbers');
    });

    it('rejects NaN dofPos values', async () => {
      const bad = makeFrame();
      bad.dofPos = [0.1, Number.NaN];
      await rejectsWith(makeClip({ frames: [bad] }), 'frames[0].dofPos must be 2 finite numbers');
    });
  });

  // ─── query delegation ───────────────────────────────────────────────

  describe('listClips', () => {
    it('defaults the limit to 500', async () => {
      mockMotionClipRepository.listAll.mockResolvedValue([]);
      await motionClipService.listClips();
      expect(mockMotionClipRepository.listAll).toHaveBeenCalledWith(500);
    });

    it('passes an explicit limit through', async () => {
      mockMotionClipRepository.listAll.mockResolvedValue([]);
      await motionClipService.listClips(25);
      expect(mockMotionClipRepository.listAll).toHaveBeenCalledWith(25);
    });
  });

  describe('getClip / deleteClip', () => {
    it('delegates getClip to the repository', async () => {
      mockMotionClipRepository.findById.mockResolvedValue(null);
      const result = await motionClipService.getClip('clip-404');
      expect(result).toBeNull();
      expect(mockMotionClipRepository.findById).toHaveBeenCalledWith('clip-404');
    });

    it('delegates deleteClip to the repository', async () => {
      mockMotionClipRepository.delete.mockResolvedValue(false);
      const result = await motionClipService.deleteClip('clip-404');
      expect(result).toBe(false);
      expect(mockMotionClipRepository.delete).toHaveBeenCalledWith('clip-404');
    });
  });
});
