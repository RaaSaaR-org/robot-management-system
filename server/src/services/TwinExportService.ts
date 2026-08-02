/**
 * @file TwinExportService.ts
 * @description Export a digital twin + its zones to robot-fleet formats
 *              (TASK-170 Phase 4): a Nav2 keep-out mask PGM + costmap-filter
 *              YAML rasterized from keepout/speed zones over the occupancy grid,
 *              and a VDA5050 roadmap (nodes + edges) derived from free space and
 *              zone centroids. Results are cached to the DIGITAL_TWINS bucket.
 * @feature digitaltwin
 */

import { digitalTwinRepository, twinZoneRepository } from '../repositories/index.js';
import { modelStorage } from '../storage/model-storage.js';
import {
  createGrid,
  fillPolygon,
  encodePgm,
  decodePgm,
  worldToPixel,
  type PgmGrid,
  type GridTransform,
  type PixelXY,
} from '../storage/pgm.js';
import type {
  DigitalTwinRecord,
  TwinZoneRecord,
  TwinZonePoint,
} from '../types/twin.types.js';

// Nav2 costmap-filter mask: 254 = lethal (keep-out), 0 = free. Speed zones are
// also rasterized into the keep-out mask (the contract bundles keepout+speed).
const MASK_LETHAL = 254;

/**
 * The ONLY zone types that become lethal cells in the Nav2 mask.
 *
 * An ALLOW-list, deliberately, and it is the reason this is a named constant
 * rather than an inline `!==` test: `type: 'room'` (TASK-200) is a named region
 * of floor the robot is *supposed* to stand in, and a deny-list would quietly
 * start rasterizing whatever zone type is invented next. Getting this wrong
 * turns every room in the building into an obstacle and the robot simply
 * refuses to plan anywhere — see the regression test.
 */
const KEEPOUT_MASK_ZONE_TYPES: ReadonlySet<string> = new Set(['keepout', 'speed']);

export interface VDA5050Node {
  nodeId: string;
  x: number;
  y: number;
  released: boolean;
  zoneType?: string;
}

export interface VDA5050Edge {
  edgeId: string;
  startNodeId: string;
  endNodeId: string;
  released: boolean;
}

export interface VDA5050Roadmap {
  version: string;
  twinId: string;
  nodes: VDA5050Node[];
  edges: VDA5050Edge[];
}

export interface KeepoutExport {
  pgm: Buffer;
  yaml: string;
  /** The mask grid (for tests / reuse). */
  grid: PgmGrid;
  transform: GridTransform & { originX: number; originY: number };
}

export class TwinExportService {
  private static instance: TwinExportService;

  private constructor() {}

  static getInstance(): TwinExportService {
    if (!TwinExportService.instance) {
      TwinExportService.instance = new TwinExportService();
    }
    return TwinExportService.instance;
  }

  // ==========================================================================
  // GRID GEOMETRY
  // ==========================================================================

  /**
   * Resolve the grid geometry for a twin. Prefers the dimensions of the built
   * occupancy grid (so the mask lines up pixel-perfect); falls back to deriving
   * width/height from the twin bounds + resolution. Origin/resolution always
   * come from the DigitalTwin row (the single source of the world frame).
   */
  private async resolveGrid(twin: DigitalTwinRecord): Promise<{
    width: number;
    height: number;
    transform: GridTransform;
  }> {
    const resolution = twin.resolution > 0 ? twin.resolution : 0.05;
    // The grid (and ROS map origin) is anchored at the cloud's bottom-left
    // corner, NOT the world frame origin — so the keep-out mask lines up with
    // the occupancy grid, which spans bounds.min..bounds.max.
    const originX = twin.minX;
    const originY = twin.minY;

    // Try to match the built occupancy grid's exact dimensions.
    if (twin.occupancyPgmKey) {
      try {
        const stream = await modelStorage.getTwinArtifactStream(twin.occupancyPgmKey);
        const chunks: Buffer[] = [];
        for await (const c of stream) chunks.push(Buffer.from(c));
        const occ = decodePgm(Buffer.concat(chunks));
        return {
          width: occ.width,
          height: occ.height,
          transform: { originX, originY, resolution, height: occ.height },
        };
      } catch {
        // fall through to bounds-derived dimensions
      }
    }

    // Derive from the AABB. At least 1px so empty twins still produce a valid PGM.
    const spanX = Math.max(twin.maxX - twin.minX, resolution);
    const spanY = Math.max(twin.maxY - twin.minY, resolution);
    const width = Math.max(1, Math.ceil(spanX / resolution));
    const height = Math.max(1, Math.ceil(spanY / resolution));
    return { width, height, transform: { originX, originY, resolution, height } };
  }

  // ==========================================================================
  // KEEP-OUT MASK (PGM + YAML)
  // ==========================================================================

  /**
   * Build the Nav2 keep-out mask from a twin's keepout + speed zones. Pure
   * given the twin + zones (no storage I/O beyond optionally reading the
   * occupancy grid for exact dimensions).
   */
  async buildKeepoutMask(
    twin: DigitalTwinRecord,
    zones: TwinZoneRecord[],
  ): Promise<KeepoutExport> {
    const { width, height, transform } = await this.resolveGrid(twin);
    const grid = createGrid(width, height, 0, 255);

    const maskZones = zones.filter((z) => KEEPOUT_MASK_ZONE_TYPES.has(z.type));
    for (const zone of maskZones) {
      const polygonPx: PixelXY[] = zone.points.map((p: TwinZonePoint) =>
        worldToPixel(p.x, p.y, transform),
      );
      fillPolygon(grid, polygonPx, MASK_LETHAL);
    }

    const maskName = `${twin.name.replace(/[^a-z0-9_-]+/gi, '_')}_keepout`;
    const yaml = this.buildCostmapFilterYaml({
      imageName: 'nav2-keepout.pgm',
      resolution: transform.resolution,
      originX: transform.originX,
      originY: transform.originY,
      maskName,
    });

    return {
      pgm: encodePgm(grid),
      yaml,
      grid,
      transform: { ...transform },
    };
  }

  /**
   * Build the costmap-filter YAML referencing the keep-out PGM. Uses the SAME
   * resolution/origin as the occupancy grid so the filter aligns in Nav2.
   */
  private buildCostmapFilterYaml(opts: {
    imageName: string;
    resolution: number;
    originX: number;
    originY: number;
    maskName: string;
  }): string {
    return [
      `image: ${opts.imageName}`,
      `mode: scale`,
      `resolution: ${opts.resolution}`,
      `origin: [${opts.originX}, ${opts.originY}, 0.0]`,
      `negate: 0`,
      `occupied_thresh: 0.65`,
      `free_thresh: 0.196`,
      ``,
    ].join('\n');
  }

  // ==========================================================================
  // VDA5050 ROADMAP
  // ==========================================================================

  /**
   * Derive a VDA5050 roadmap from free-space + zone centroids. Each non-keepout
   * zone (workcell, charging) contributes a released node at its centroid; a
   * twin-center node anchors the graph. Edges connect the center to each zone
   * node (a simple star roadmap). Always yields ≥1 node.
   */
  buildRoadmap(twin: DigitalTwinRecord, zones: TwinZoneRecord[]): VDA5050Roadmap {
    const nodes: VDA5050Node[] = [];
    const edges: VDA5050Edge[] = [];

    // Anchor node: twin AABB center (free-space proxy).
    const centerX = (twin.minX + twin.maxX) / 2;
    const centerY = (twin.minY + twin.maxY) / 2;
    const centerId = `${twin.id}-center`;
    nodes.push({ nodeId: centerId, x: centerX, y: centerY, released: true });

    let i = 0;
    for (const zone of zones) {
      // Keep-out zones are obstacles, not waypoints. Everything else — including
      // a TASK-200 `room` — contributes one: the centroid of a named region of
      // floor is exactly the "go to the staging area" waypoint a roadmap wants.
      if (zone.type === 'keepout') continue;
      const centroid = polygonCentroid(zone.points);
      if (!centroid) continue;
      const nodeId = `${twin.id}-zone-${i}`;
      nodes.push({
        nodeId,
        x: centroid.x,
        y: centroid.y,
        released: true,
        zoneType: zone.type,
      });
      edges.push({
        edgeId: `${twin.id}-edge-${i}`,
        startNodeId: centerId,
        endNodeId: nodeId,
        released: true,
      });
      i++;
    }

    return { version: '2.0.0', twinId: twin.id, nodes, edges };
  }

  // ==========================================================================
  // PUBLIC EXPORT (with caching to DIGITAL_TWINS bucket)
  // ==========================================================================

  /**
   * Build + cache the keep-out mask PGM. Returns the bytes (callers stream
   * them); the cache key is stored only when storage is available.
   */
  async exportKeepoutPgm(twinId: string): Promise<Buffer | null> {
    const twin = await digitalTwinRepository.findById(twinId);
    if (!twin) return null;
    const zones = await twinZoneRepository.listByTwin(twinId);
    const { pgm } = await this.buildKeepoutMask(twin, zones);
    await this.cache(twinId, 'nav2-keepout.pgm', pgm);
    return pgm;
  }

  async exportKeepoutYaml(twinId: string): Promise<string | null> {
    const twin = await digitalTwinRepository.findById(twinId);
    if (!twin) return null;
    const zones = await twinZoneRepository.listByTwin(twinId);
    const { yaml } = await this.buildKeepoutMask(twin, zones);
    await this.cache(twinId, 'nav2-keepout.yaml', Buffer.from(yaml, 'utf-8'));
    return yaml;
  }

  async exportRoadmap(twinId: string): Promise<VDA5050Roadmap | null> {
    const twin = await digitalTwinRepository.findById(twinId);
    if (!twin) return null;
    const zones = await twinZoneRepository.listByTwin(twinId);
    const roadmap = this.buildRoadmap(twin, zones);
    await this.cache(twinId, 'vda5050.json', Buffer.from(JSON.stringify(roadmap, null, 2), 'utf-8'));
    return roadmap;
  }

  /** Best-effort cache to the DIGITAL_TWINS bucket / local dir (export/ prefix). */
  private async cache(twinId: string, name: string, data: Buffer): Promise<void> {
    try {
      await modelStorage.uploadTwinArtifact(twinId, `export/${name}`, data);
    } catch {
      // Caching is best-effort — exports are recomputed cheaply on demand.
    }
  }
}

/**
 * Area-weighted centroid of a simple polygon. Falls back to the vertex average
 * for degenerate (zero-area) polygons. Returns null for < 1 vertex.
 */
export function polygonCentroid(points: TwinZonePoint[]): { x: number; y: number } | null {
  if (points.length === 0) return null;
  if (points.length < 3) {
    const sx = points.reduce((a, p) => a + p.x, 0) / points.length;
    const sy = points.reduce((a, p) => a + p.y, 0) / points.length;
    return { x: sx, y: sy };
  }

  let area = 0;
  let cx = 0;
  let cy = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const cross = a.x * b.y - b.x * a.y;
    area += cross;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  area *= 0.5;
  if (Math.abs(area) < 1e-9) {
    const sx = points.reduce((acc, p) => acc + p.x, 0) / n;
    const sy = points.reduce((acc, p) => acc + p.y, 0) / n;
    return { x: sx, y: sy };
  }
  return { x: cx / (6 * area), y: cy / (6 * area) };
}

export const twinExportService = TwinExportService.getInstance();
