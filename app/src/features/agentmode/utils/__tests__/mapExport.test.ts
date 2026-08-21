/**
 * @file mapExport.test.ts
 * @description The map export: PGM is north-up with map_server greys, the YAML
 *              names the image and the bottom-left origin, PGM export saves
 *              both files, and a corrupt grid exports nothing.
 * @feature agentmode
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { RobotMapGrid } from '../../types/agentmode.types';
import { gridToPgm, gridToPgmBody, gridToPng, gridToMapServerYaml, exportMap, PGM_OCCUPIED, PGM_FREE, PGM_UNKNOWN, decodeCloudPositions, cloudToPcd, cloudToPly, exportCloud } from '../mapExport';

// 3 wide × 2 high. Cell (0,0) = bottom-left. Row y=0: occupied, free, unknown; row y=1: unknown ×3.
const cells = new Int8Array([127, -127, 0, 0, 0, 0]);
const grid: RobotMapGrid = {
  version: 1, frame: 'odom', frameId: 'boot', resolution: 0.1, originX: -1, originY: -2,
  width: 3, height: 2, encoding: 'int8-logodds-b64',
  cells: btoa(String.fromCharCode(...new Uint8Array(cells.buffer))),
  occupiedAbove: 1.2, freeBelow: -1.2, poseCount: 7, lastIntegratedAt: '2026-08-16T00:20:52.118Z',
  knownCells: 2, occupiedCells: 1,
};

afterEach(() => vi.restoreAllMocks());

describe('gridToPgmBody', () => {
  it('flips rows so the top row of the image is the largest y, with map_server greys', () => {
    const body = gridToPgmBody(grid)!;
    expect(Array.from(body.slice(0, 3))).toEqual([PGM_UNKNOWN, PGM_UNKNOWN, PGM_UNKNOWN]); // y=1 on top
    expect(Array.from(body.slice(3, 6))).toEqual([PGM_OCCUPIED, PGM_FREE, PGM_UNKNOWN]); // y=0 at the bottom
  });

  it('returns null when the cell count does not match the dimensions', () => {
    expect(gridToPgmBody({ ...grid, cells: btoa('ab') })).toBeNull();
    expect(gridToPgmBody({ ...grid, cells: '%%%' })).toBeNull();
  });
});

describe('gridToPgm / gridToMapServerYaml', () => {
  it('writes a P5 header with the dimensions and the body after it', async () => {
    const buf = new Uint8Array(await gridToPgm(grid)!.arrayBuffer());
    const text = new TextDecoder().decode(buf);
    expect(text.startsWith('P5\n#')).toBe(true);
    expect(text).toContain('\n3 2\n255\n');
    expect(Array.from(buf.slice(buf.length - 6))).toEqual([PGM_UNKNOWN, PGM_UNKNOWN, PGM_UNKNOWN, PGM_OCCUPIED, PGM_FREE, PGM_UNKNOWN]);
  });

  it('names the image, resolution and bottom-left origin the way map_server reads them', () => {
    const yaml = gridToMapServerYaml(grid, 'm.pgm');
    expect(yaml).toContain('image: m.pgm\n');
    expect(yaml).toContain('resolution: 0.1\n');
    expect(yaml).toContain('origin: [-1, -2, 0.0]\n');
    expect(yaml).toContain('occupied_thresh: 0.65');
  });
});

describe('exportMap', () => {
  it('saves the PGM and its YAML together under one stem, and JSON alone', async () => {
    const saved: string[] = [];
    vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:x', revokeObjectURL: () => {} });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      saved.push(this.download);
    });
    expect(await exportMap('g1', grid, 'pgm')).toBe(true);
    expect(saved).toEqual(['map-g1-2026-08-16T00-20-52.pgm', 'map-g1-2026-08-16T00-20-52.yaml']);
    expect(await exportMap('g1', grid, 'json')).toBe(true);
    expect(saved[2]).toBe('map-g1-2026-08-16T00-20-52.json');
    click.mockRestore();
    vi.unstubAllGlobals();
  });

  it('exports nothing from a grid it cannot decode', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    expect(await exportMap('g1', { ...grid, cells: 'AAA=' }, 'pgm')).toBe(false);
    expect(click).not.toHaveBeenCalled();
  });
});

/**
 * A robot that has integrated nothing reports a 0×0 grid — its own
 * `GET /map?format=pgm` answers 404 for exactly that case. The browser export
 * used to write a PGM whose header said `0 0` with no raster after it, a file
 * RViz, Nav2 and GIMP all refuse, and told the operator it had saved a map.
 */
describe('a grid with nothing integrated yet', () => {
  const empty: RobotMapGrid = { ...grid, width: 0, height: 0, cells: '', poseCount: 0, knownCells: 0, occupiedCells: 0, lastIntegratedAt: null };

  it('has no PGM body and no PGM file', () => {
    expect(gridToPgmBody(empty)).toBeNull();
    expect(gridToPgm(empty)).toBeNull();
  });

  it('saves nothing for PGM or PNG and says so, while the raw JSON still saves', async () => {
    const saved: string[] = [];
    vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:x', revokeObjectURL: () => {} });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      saved.push(this.download);
    });
    expect(await exportMap('g1', empty, 'pgm')).toBe(false);
    expect(await exportMap('g1', empty, 'png')).toBe(false);
    expect(saved).toEqual([]);
    expect(await exportMap('g1', empty, 'json')).toBe(true);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatch(/^map-g1-.*\.json$/);
    vi.unstubAllGlobals();
  });
});

describe('gridToPng', () => {
  it('resolves null instead of rejecting when the canvas refuses the raster', async () => {
    // Real browsers throw IndexSizeError out of createImageData; jsdom has no
    // canvas backend at all, so stand in one that fails the way a browser does.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      createImageData: () => {
        throw new DOMException('The source width is zero or not a number.', 'IndexSizeError');
      },
    } as unknown as CanvasRenderingContext2D);
    await expect(gridToPng(grid)).resolves.toBeNull();
  });
});

describe('world cloud export (TASK-211)', () => {
  const pts = new Float32Array([1, 2, 0.5, -1, 0, 1.25]);
  const b64 = btoa(String.fromCharCode(...new Uint8Array(pts.buffer)));
  const cloud = {
    ok: true as const, frame: 'odom' as const, frameId: 'boot', voxelM: 0.05, pointCount: 2, returned: 2,
    encoding: 'f32-xyz-b64' as const, positions: b64, frames: 3, lastIntegratedAt: '2026-08-16T00:20:52.118Z', pose: null,
  };

  it('decodes the positions and writes PCD/PLY headers with the count, floats after', async () => {
    const dec = decodeCloudPositions(cloud)!;
    expect(Array.from(dec)).toEqual([1, 2, 0.5, -1, 0, 1.25]);
    const pcd = new Uint8Array(await cloudToPcd(dec, 'c').arrayBuffer());
    const text = new TextDecoder().decode(pcd);
    expect(text).toContain('POINTS 2\nDATA binary\n');
    const off = text.indexOf('DATA binary\n') + 'DATA binary\n'.length;
    expect(new DataView(pcd.buffer).getFloat32(off, true)).toBe(1);
    expect(pcd.length).toBe(off + 24);
    const ply = new TextDecoder().decode(await cloudToPly(dec, 'c').arrayBuffer());
    expect(ply).toContain('element vertex 2\n');
    expect(decodeCloudPositions({ ...cloud, positions: 'AAAA' })).toBeNull();
  });

  it('exportCloud saves one file named after the robot and refuses a broken payload', () => {
    const saved: string[] = [];
    vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:x', revokeObjectURL: () => {} });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      saved.push(this.download);
    });
    expect(exportCloud('g1', cloud, 'pcd')).toBe(true);
    expect(exportCloud('g1', cloud, 'ply')).toBe(true);
    expect(saved).toEqual(['cloud-g1-2026-08-16T00-20-52.pcd', 'cloud-g1-2026-08-16T00-20-52.ply']);
    expect(exportCloud('g1', { ...cloud, positions: 'AAAA' }, 'pcd')).toBe(false);
    click.mockRestore();
    vi.unstubAllGlobals();
  });
});
