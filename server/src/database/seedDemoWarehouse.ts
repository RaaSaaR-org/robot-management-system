/**
 * @file seedDemoWarehouse.ts
 * @description Seeds the "Demo Warehouse" digital twin — the site the sim's
 *              warehouse scene is laid out on (TASK-327, epic TASK-274).
 * @feature digitaltwin
 *
 * One draft `DigitalTwin` (no scan, world origin at 0,0) whose `TwinZone` rows
 * reproduce `robot-agent/hardware/sim_evaluator/places/places.warehouse.json`
 * 1:1: zone name = place id, polygon = place polygon, type `keepout` for the
 * keepouts, `charging` for CHARGING-A and `room` for every other place, and
 * `metadata.placeType` / `metadata.floor` from the file.
 *
 * The places are inlined rather than read off disk because the server image
 * does not ship `robot-agent/`; `seedDemoWarehouse.test.ts` asserts the two
 * still agree, so an edit to the JSON without one here fails CI.
 *
 * Idempotent: a twin named "Demo Warehouse" already present (in any tenant)
 * means nothing is written — a second boot adds nothing, and an operator's
 * edits to the seeded twin survive restarts.
 *
 * No robot is bound here. Robots register at runtime, and the binding is the
 * operator's call: pick "Demo Warehouse" in the robot's Info tab ("Site").
 */

import { prisma } from './index.js';
import { MULTI_TENANCY_ENABLED, DEFAULT_TENANT_ID } from '../config/features.js';
import { twinZoneNameKey } from '../repositories/TwinZoneRepository.js';
import { logger } from '../utils/logger.js';

export const DEMO_WAREHOUSE_NAME = 'Demo Warehouse';

/** One place of the sim warehouse, as `places.warehouse.json` lists it. */
export interface DemoWarehousePlace {
  id: string;
  placeType: string;
  floor: number;
  polygon: Array<[number, number]>;
  keepout: boolean;
}

/** Mirror of `places.warehouse.json` → `places` (id, type, floor, polygon, keepout). */
export const DEMO_WAREHOUSE_PLACES: DemoWarehousePlace[] = [
  {
    id: 'STAGING',
    placeType: 'staging',
    floor: 0,
    polygon: [[-2.0, -2.0], [2.0, -2.0], [2.0, 2.0], [-2.0, 2.0]],
    keepout: false,
  },
  {
    id: 'CHARGING-A',
    placeType: 'charging',
    floor: 0,
    polygon: [[-1.5, -5.5], [1.5, -5.5], [1.5, -2.0], [-1.5, -2.0]],
    keepout: false,
  },
  {
    id: 'CROSS-AISLE',
    placeType: 'corridor',
    floor: 0,
    polygon: [[-5.5, -3.0], [-2.0, -3.0], [-2.0, 2.0], [10.0, 2.0], [10.0, 5.5], [-5.5, 5.5]],
    keepout: false,
  },
  {
    id: 'AISLE-1',
    placeType: 'aisle',
    floor: 0,
    polygon: [[2.0, -4.0], [4.0, -4.0], [4.0, 2.0], [2.0, 2.0]],
    keepout: false,
  },
  {
    id: 'AISLE-2',
    placeType: 'aisle',
    floor: 0,
    polygon: [[5.0, -4.0], [7.0, -4.0], [7.0, 2.0], [5.0, 2.0]],
    keepout: false,
  },
  {
    id: 'AISLE-3',
    placeType: 'aisle',
    floor: 0,
    polygon: [[8.0, -4.0], [10.0, -4.0], [10.0, 2.0], [8.0, 2.0]],
    keepout: false,
  },
  {
    id: 'DOCK-1',
    placeType: 'dock',
    floor: 0,
    polygon: [[-9.0, -3.0], [-5.5, -3.0], [-5.5, 3.0], [-9.0, 3.0]],
    keepout: false,
  },
  {
    id: 'RACK-A',
    placeType: 'rack_face',
    floor: 0,
    polygon: [[4.0, -4.0], [5.0, -4.0], [5.0, 2.0], [4.0, 2.0]],
    keepout: true,
  },
  {
    id: 'RACK-B',
    placeType: 'rack_face',
    floor: 0,
    polygon: [[7.0, -4.0], [8.0, -4.0], [8.0, 2.0], [7.0, 2.0]],
    keepout: true,
  },
  {
    id: 'DOCK-1-EDGE',
    placeType: 'dock',
    floor: 0,
    polygon: [[-9.95, -3.0], [-9.0, -3.0], [-9.0, 3.0], [-9.95, 3.0]],
    keepout: true,
  },
];

/** The `TwinZone.type` a place becomes: keepouts fence, CHARGING-A charges, the rest are rooms. */
export function demoWarehouseZoneType(place: DemoWarehousePlace): 'keepout' | 'charging' | 'room' {
  if (place.keepout) return 'keepout';
  if (place.id === 'CHARGING-A') return 'charging';
  return 'room';
}

/** The subset of the Prisma client the seed touches — injectable for tests. */
export interface DemoWarehouseSeedDb {
  digitalTwin: {
    findFirst(args: { where: { name: string }; select: { id: true } }): Promise<{ id: string } | null>;
  };
  $transaction<T>(fn: (tx: DemoWarehouseSeedTx) => Promise<T>): Promise<T>;
}

/** The writes the seed makes inside its transaction. */
export interface DemoWarehouseSeedTx {
  digitalTwin: {
    create(args: { data: Record<string, unknown>; select: { id: true } }): Promise<{ id: string }>;
  };
  twinZone: {
    createMany(args: { data: Array<Record<string, unknown>> }): Promise<{ count: number }>;
  };
}

/**
 * Create the "Demo Warehouse" twin and its zones unless it exists already.
 * Returns the new twin's id, or `null` when nothing was written.
 */
export async function seedDemoWarehouse(
  db: DemoWarehouseSeedDb = prisma as unknown as DemoWarehouseSeedDb
): Promise<string | null> {
  const existing = await db.digitalTwin.findFirst({
    where: { name: DEMO_WAREHOUSE_NAME },
    select: { id: true },
  });
  if (existing) return null;

  const tenantId = MULTI_TENANCY_ENABLED ? DEFAULT_TENANT_ID : null;
  const twinId = await db.$transaction(async (tx) => {
    const twin = await tx.digitalTwin.create({
      data: {
        name: DEMO_WAREHOUSE_NAME,
        status: 'draft',
        worldOriginX: 0,
        worldOriginY: 0,
        worldOriginZ: 0,
        tenantId,
      },
      select: { id: true },
    });
    await tx.twinZone.createMany({
      data: DEMO_WAREHOUSE_PLACES.map((place) => ({
        twinId: twin.id,
        name: place.id,
        nameKey: twinZoneNameKey(place.id),
        type: demoWarehouseZoneType(place),
        points: JSON.stringify(place.polygon.map(([x, y]) => ({ x, y }))),
        metadata: JSON.stringify({ placeType: place.placeType, floor: place.floor }),
      })),
    });
    return twin.id;
  });

  logger.info(
    `[Seed] Created "${DEMO_WAREHOUSE_NAME}" twin with ${DEMO_WAREHOUSE_PLACES.length} zones`
  );
  return twinId;
}
