/**
 * @file datasetCompatibility.test.ts
 * @description The rules that decide whether two datasets can be trained
 *              together — including the two that are easy to get backwards:
 *              differing action width is a multi-embodiment run, differing fps
 *              usually is not a run at all.
 * @feature training
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../database/index.js', () => ({
  prisma: {
    dataset: { findMany: vi.fn() },
  },
}));

import {
  analyzeCompatibility,
  analyzeDatasetIds,
  UnknownDatasetError,
  type CompatibilityDatasetInput,
} from '../datasetCompatibility.js';
import { prisma as _prisma } from '../../../database/index.js';

const prisma = vi.mocked(_prisma, true) as unknown as {
  dataset: { findMany: ReturnType<typeof vi.fn> };
};

// ---------------------------------------------------------------------------
// Fixtures — the two Hub datasets the feature exists to reconcile.
// ---------------------------------------------------------------------------

function info(opts: {
  robotType: string;
  width: number;
  cameras: string[];
}): string {
  const features: Record<string, unknown> = {
    'observation.state': { dtype: 'float32', shape: [opts.width] },
    action: { dtype: 'float32', shape: [opts.width] },
  };
  for (const cam of opts.cameras) features[cam] = { dtype: 'video', shape: [3, 480, 640] };
  return JSON.stringify({ robot_type: opts.robotType, features });
}

/** nvidia/GR00T-N1.7-AppleToPlate: v2.1, unitree_g1, 43-wide, 30 fps, 1 camera. */
function groot(overrides: Partial<CompatibilityDatasetInput> = {}): CompatibilityDatasetInput {
  return {
    id: 'ds-groot',
    name: 'GR00T-N1.7-AppleToPlate',
    status: 'ready',
    fps: 30,
    lerobotVersion: 'v2.1',
    robotTypeId: 'rt-g1',
    infoJson: info({
      robotType: 'unitree_g1',
      width: 43,
      cameras: ['observation.images.ego_view'],
    }),
    validationJson: null,
    ...overrides,
  };
}

/** unitreerobotics/G1_Dex3_ObjectPlacement: v3.0, Unitree_G1, 28-wide, 4 cameras. */
function dex3(overrides: Partial<CompatibilityDatasetInput> = {}): CompatibilityDatasetInput {
  return {
    id: 'ds-dex3',
    name: 'G1_Dex3_ObjectPlacement_Dataset',
    status: 'ready',
    fps: 30,
    lerobotVersion: 'v3.0',
    robotTypeId: 'rt-g1',
    infoJson: info({
      robotType: 'Unitree_G1',
      width: 28,
      cameras: [
        'observation.images.cam_left_high',
        'observation.images.cam_right_high',
        'observation.images.cam_left_wrist',
        'observation.images.cam_right_wrist',
      ],
    }),
    validationJson: null,
    ...overrides,
  };
}

/** A `validationJson` in the shape `DatasetService` actually writes. */
function validated(state: number, action: number, imageKeys: string[] = []): string {
  return JSON.stringify({
    validatedAt: '2026-08-23T00:00:00.000Z',
    breakdown: { total: 24 },
    report: {
      valid: true,
      observedStateWidth: state,
      observedActionWidth: action,
      imageKeys,
    },
  });
}

function axisOf(
  report: ReturnType<typeof analyzeCompatibility>,
  axis: string,
): NonNullable<ReturnType<typeof analyzeCompatibility>['axes'][number]> {
  const found = report.axes.find((a) => a.axis === axis);
  if (!found) throw new Error(`no ${axis} axis in report`);
  return found;
}

// ===========================================================================
// The scenario the feature exists for
// ===========================================================================

describe('the GR00T + Dex3 mixture', () => {
  it('is multi_embodiment, not incompatible — different action spaces train with projectors', () => {
    const report = analyzeCompatibility([groot(), dex3()]);

    expect(report.verdict).toBe('multi_embodiment');
    expect(axisOf(report, 'actionWidth').verdict).toBe('differs');
    expect(axisOf(report, 'stateWidth').verdict).toBe('differs');
    // The rate is the same, so nothing about the mixture is blocking.
    expect(axisOf(report, 'fps').verdict).toBe('match');
    expect(report.axes.some((a) => a.verdict === 'blocking')).toBe(false);
  });

  it('says out loud that the two cannot be concatenated', () => {
    const report = analyzeCompatibility([groot(), dex3()]);
    expect(report.headline.toLowerCase()).toContain('concatenated');
    expect(axisOf(report, 'actionWidth').note).toContain('43');
    expect(axisOf(report, 'actionWidth').note).toContain('28');
  });

  it('reports every axis for every member, with the ids the caller passed', () => {
    const report = analyzeCompatibility([groot(), dex3()]);
    expect(report.datasetIds).toEqual(['ds-groot', 'ds-dex3']);
    for (const axis of report.axes) {
      expect(axis.values.map((v) => v.datasetId)).toEqual(['ds-groot', 'ds-dex3']);
      expect(axis.note.length).toBeGreaterThan(20);
    }
  });

  it('flags the disjoint camera sets without blocking on them', () => {
    const cameras = axisOf(analyzeCompatibility([groot(), dex3()]), 'cameraKeys');
    expect(cameras.verdict).toBe('differs');
    expect(cameras.note).toMatch(/vision/i);
  });

  it('notes that the mixture spans two LeRobot versions', () => {
    const versions = axisOf(analyzeCompatibility([groot(), dex3()]), 'lerobotVersion');
    expect(versions.verdict).toBe('differs');
    expect(versions.values.map((v) => v.value)).toEqual(['v2.1', 'v3.0']);
  });
});

// ===========================================================================
// fps
// ===========================================================================

describe('frame rate', () => {
  it('blocks rates that do not divide', () => {
    const report = analyzeCompatibility([
      groot({ fps: 25 }),
      dex3({ fps: 30, infoJson: info({ robotType: 'unitree_g1', width: 43, cameras: [] }) }),
    ]);
    expect(axisOf(report, 'fps').verdict).toBe('blocking');
    expect(report.verdict).toBe('incompatible');
    expect(report.headline).toMatch(/cannot be trained together/i);
  });

  it('allows an exact integer multiple but demands resampling', () => {
    const report = analyzeCompatibility([
      groot({ fps: 30 }),
      dex3({ fps: 10, infoJson: info({ robotType: 'unitree_g1', width: 43, cameras: [] }) }),
    ]);
    const fps = axisOf(report, 'fps');
    expect(fps.verdict).toBe('differs');
    expect(fps.note).toMatch(/3×/);
    // Only the rate differs, and a rate the trainer can subsample does not make
    // this a multi-embodiment run.
    expect(report.verdict).toBe('compatible');
  });

  it('does not treat 29.97 and 30 as a multiple', () => {
    const report = analyzeCompatibility([groot({ fps: 29.97 }), groot({ id: 'b', fps: 30 })]);
    expect(axisOf(report, 'fps').verdict).toBe('blocking');
  });

  it('blocks when a member has no recorded rate at all', () => {
    const report = analyzeCompatibility([groot(), dex3({ fps: 0 })]);
    expect(axisOf(report, 'fps').verdict).toBe('blocking');
    expect(axisOf(report, 'fps').values[1].value).toBe('unknown');
  });
});

// ===========================================================================
// status
// ===========================================================================

describe('member status', () => {
  it('blocks the whole report on a member that is not ready', () => {
    const report = analyzeCompatibility([groot(), dex3({ status: 'failed' })]);
    expect(axisOf(report, 'status').verdict).toBe('blocking');
    expect(report.verdict).toBe('incompatible');
    expect(axisOf(report, 'status').note).toContain('G1_Dex3_ObjectPlacement_Dataset is failed');
  });

  it('blocks a still-importing member too', () => {
    const report = analyzeCompatibility([groot({ status: 'importing' })]);
    expect(report.verdict).toBe('incompatible');
  });
});

// ===========================================================================
// widths, and where they come from
// ===========================================================================

describe('vector widths', () => {
  it('prefers the MEASURED width over the manifest and labels the difference', () => {
    // info.json declares 43; the parquet actually holds 28. The measurement wins.
    const report = analyzeCompatibility([
      groot({ validationJson: validated(28, 28) }),
      dex3({ validationJson: validated(28, 28) }),
    ]);
    expect(axisOf(report, 'actionWidth').values.map((v) => v.value)).toEqual(['28', '28']);
    expect(report.verdict).not.toBe('multi_embodiment');
  });

  it('marks a width taken from info.json as declared rather than measured', () => {
    const report = analyzeCompatibility([groot(), dex3()]);
    expect(axisOf(report, 'actionWidth').values[0].value).toBe('43 (declared)');
  });

  it('treats an unrecorded width as a difference, never as a match', () => {
    const bare: CompatibilityDatasetInput = {
      id: 'ds-bare',
      name: 'never validated, no features',
      status: 'ready',
      fps: 30,
      lerobotVersion: 'v2.1',
      robotTypeId: 'rt-g1',
      infoJson: '{}',
      validationJson: null,
    };
    const report = analyzeCompatibility([groot({ validationJson: validated(43, 43) }), bare]);
    const action = axisOf(report, 'actionWidth');
    expect(action.verdict).toBe('differs');
    expect(action.values[1].value).toBe('unknown');
    expect(report.verdict).toBe('multi_embodiment');
    // …and it says the width is unrecorded rather than claiming they differ.
    expect(report.headline).toMatch(/unrecorded/i);
  });
});

// ===========================================================================
// degenerate and identical inputs
// ===========================================================================

describe('trivial inputs', () => {
  it('calls a single ready dataset identical and still returns every axis', () => {
    const report = analyzeCompatibility([groot()]);
    expect(report.verdict).toBe('identical');
    expect(report.axes.map((a) => a.axis).sort()).toEqual([
      'actionWidth', 'cameraKeys', 'fps', 'lerobotVersion', 'robotType', 'stateWidth', 'status',
    ]);
  });

  it('calls two copies of one dataset identical', () => {
    const report = analyzeCompatibility([groot(), groot({ id: 'ds-copy' })]);
    expect(report.verdict).toBe('identical');
    expect(report.axes.every((a) => a.verdict === 'match')).toBe(true);
  });

  it('refuses an empty list rather than inventing a verdict', () => {
    expect(() => analyzeCompatibility([])).toThrow(/at least one dataset/);
  });
});

// ===========================================================================
// analyzeDatasetIds — the DB-backed entry point
// ===========================================================================

describe('analyzeDatasetIds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const row = (over: Record<string, unknown>) => ({
    id: 'a',
    name: 'A',
    status: 'ready',
    fps: 30,
    lerobotVersion: 'v2.1',
    robotTypeId: 'rt-g1',
    robotType: { name: 'Unitree G1' },
    infoJson: '{}',
    validationJson: null,
    ...over,
  });

  it('keeps the order the caller asked for, not the order the DB returned', async () => {
    prisma.dataset.findMany.mockResolvedValue([row({ id: 'b', name: 'B' }), row({ id: 'a' })]);
    const report = await analyzeDatasetIds(['a', 'b']);
    expect(report.datasetIds).toEqual(['a', 'b']);
  });

  it('names the ids that do not exist', async () => {
    prisma.dataset.findMany.mockResolvedValue([row({ id: 'a' })]);
    await expect(analyzeDatasetIds(['a', 'ghost'])).rejects.toBeInstanceOf(UnknownDatasetError);
  });

  it('refuses a repeated dataset instead of letting the unique constraint do it', async () => {
    await expect(analyzeDatasetIds(['a', 'a'])).rejects.toThrow(/only once/);
    expect(prisma.dataset.findMany).not.toHaveBeenCalled();
  });

  it('refuses more members than a mixture may hold', async () => {
    const ids = Array.from({ length: 9 }, (_, i) => `ds-${i}`);
    await expect(analyzeDatasetIds(ids)).rejects.toThrow(/at most 8/);
  });

  it('falls back to the robot type row name when info.json names no robot', async () => {
    prisma.dataset.findMany.mockResolvedValue([row({ id: 'a' })]);
    const report = await analyzeDatasetIds(['a']);
    expect(axisOf(report, 'robotType').values[0].value).toBe('Unitree G1');
  });
});
