/**
 * @file seedStandardRobotTypes.test.ts
 * @description The standard robot-type seed (TASK-363): creates what is missing,
 *   never touches a row that already has the name, and survives a racing boot.
 * @feature training
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../index.js', () => ({ prisma: {} }));

import {
  STANDARD_ROBOT_TYPES,
  seedStandardRobotTypes,
  type StandardRobotTypeSeedDb,
} from '../seedStandardRobotTypes.js';

function fakeDb(existingNames: string[], createImpl?: (name: string) => Promise<unknown>) {
  const rows = new Set(existingNames);
  const create = vi.fn(async ({ data }: { data: { name: string } }) => {
    if (createImpl) return createImpl(data.name);
    rows.add(data.name);
    return data;
  });
  const db: StandardRobotTypeSeedDb = {
    robotType: {
      findMany: vi.fn(async ({ where }) => where.name.in.filter((n: string) => rows.has(n)).map((name: string) => ({ name }))),
      create,
    },
  };
  return { db, create, rows };
}

describe('seedStandardRobotTypes', () => {
  it('creates every standard type on a fresh install, including the 43-wide G1 EDU', async () => {
    const { db, create } = fakeDb([]);
    const created = await seedStandardRobotTypes(db);
    expect(created).toEqual(STANDARD_ROBOT_TYPES.map((t) => t.name));
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({
      name: 'Unitree G1 EDU (Dex3-1)', actionDim: 43, proprioceptionDim: 43,
    }) });
  });

  it('writes nothing on a second boot', async () => {
    const { db, create } = fakeDb([]);
    await seedStandardRobotTypes(db);
    create.mockClear();
    expect(await seedStandardRobotTypes(db)).toEqual([]);
    expect(create).not.toHaveBeenCalled();
  });

  it('leaves a row that already carries a standard name alone', async () => {
    // An operator defined this name through the TASK-353 form before the seed existed.
    const { db, create } = fakeDb(['Unitree G1 EDU (Dex3-1)']);
    const created = await seedStandardRobotTypes(db);
    expect(created).not.toContain('Unitree G1 EDU (Dex3-1)');
    expect(create).toHaveBeenCalledTimes(STANDARD_ROBOT_TYPES.length - 1);
    // The seed has no update path at all: shared types are never rewritten.
    expect(Object.keys(db.robotType)).toEqual(['findMany', 'create']);
  });

  it('treats a unique violation from a racing replica as already seeded', async () => {
    const { db } = fakeDb([], async () => { throw Object.assign(new Error('Unique constraint'), { code: 'P2002' }); });
    await expect(seedStandardRobotTypes(db)).resolves.toEqual([]);
  });

  it('rethrows any other database error', async () => {
    const { db } = fakeDb([], async () => { throw new Error('connection lost'); });
    await expect(seedStandardRobotTypes(db)).rejects.toThrow('connection lost');
  });
});
