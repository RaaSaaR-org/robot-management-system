/**
 * @file seedStandardRobotTypes.ts
 * @description Seeds the standard robot types a dataset can be checked against
 *              (TASK-363), so a fresh install's robot-type picker has real choices.
 * @feature training
 *
 * Without this a fresh install only knows the types an import auto-created
 * (e.g. `so100_follower`), and defining one is owner-only (TASK-353) — so a
 * member looking at a 43-wide G1 dataset had nothing to switch it to.
 *
 * Create-only, by name: a row that already carries one of these names is never
 * touched, whatever its widths. Robot types are shared configuration every
 * dataset on them is validated against, and TASK-353 made "existing types are
 * never rewritten" a rule; a seed that "corrected" a row would break it.
 *
 * The names are deliberately distinct from the older `Unitree G1 + Dex3` row
 * that scripts and the synthetic generator find-or-create with differing widths:
 * reusing that name would make this seed disagree with them.
 */

import { prisma } from './index.js';
import { logger } from '../utils/logger.js';
import { STANDARD_ROBOT_TYPES, type StandardRobotType } from './standardRobotTypes.js';

export { STANDARD_ROBOT_TYPES, type StandardRobotType } from './standardRobotTypes.js';

/** The subset of the Prisma client the seed touches — injectable for tests. */
export interface StandardRobotTypeSeedDb {
  robotType: {
    findMany(args: { where: { name: { in: string[] } }; select: { name: true } }): Promise<Array<{ name: string }>>;
    create(args: { data: StandardRobotType }): Promise<unknown>;
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 'P2002';
}

/**
 * Create every standard robot type whose name is not taken yet.
 * Returns the names it created; an empty list means nothing was written.
 */
export async function seedStandardRobotTypes(
  db: StandardRobotTypeSeedDb = prisma as unknown as StandardRobotTypeSeedDb,
): Promise<string[]> {
  const existing = await db.robotType.findMany({
    where: { name: { in: STANDARD_ROBOT_TYPES.map((t) => t.name) } },
    select: { name: true },
  });
  const taken = new Set(existing.map((r) => r.name));
  const created: string[] = [];
  for (const type of STANDARD_ROBOT_TYPES) {
    if (taken.has(type.name)) continue;
    try {
      await db.robotType.create({ data: { ...type } });
      created.push(type.name);
    } catch (error) {
      // Another replica booting at the same moment won the race: the row exists, which is the goal.
      if (!isUniqueViolation(error)) throw error;
    }
  }
  if (created.length > 0) logger.info(`[Seed] Created standard robot types: ${created.join(', ')}`);
  return created;
}
