/**
 * @file state-persistence-migration.test.ts
 * @description The v1 → v2 persisted-state migration (TASK-196). Written BEFORE
 *              the production change, because getting this wrong is not a bug
 *              that shows up as a failure: a build that writes v1 and rejects it
 *              on the next load loses every robot's battery, location and task
 *              queue silently, on every single boot.
 * @feature robot
 * @status test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  StatePersistence,
  migratePersistedState,
  defaultPersistedAgentState,
  PERSISTED_STATE_VERSION,
  type PersistedState,
} from '../StatePersistence.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Exactly the shape v1 wrote — no `agentState`, no anything else. */
function makeV1(savedAt = new Date().toISOString()): Record<string, unknown> {
  return {
    version: 1,
    savedAt,
    robotState: {
      status: 'online',
      batteryLevel: 42.5,
      location: { x: 3, y: 4, z: 0, zone: 'AISLE-3', heading: 90, floor: '1' },
      heldObject: 'crate-7',
      speed: 0,
      errors: ['some error'],
      warnings: ['Emergency stop activated: operator pressed the button'],
    },
    taskQueue: [
      {
        id: 'task-1',
        actionType: 'navigate',
        actionConfig: { zone: 'AISLE-3' },
        instruction: 'go to aisle 3',
        priority: 'high',
        source: 'server',
      },
      {
        id: 'task-2',
        actionType: 'pickup',
        actionConfig: { objectId: 'crate-7' },
        instruction: 'pick up crate 7',
        priority: 'medium',
        source: 'server',
      },
    ],
  };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neodem-state-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeFixture(name: string, data: unknown): string {
  const file = path.join(tmpDir, name);
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
  return file;
}

// ---------------------------------------------------------------------------
// migrate()
// ---------------------------------------------------------------------------

describe('migratePersistedState — v1 → v2', () => {
  it('keeps every v1 field: battery, location, held object, errors, warnings, task queue', () => {
    const v1 = makeV1();
    const migrated = migratePersistedState(v1);

    expect(migrated).not.toBeNull();
    expect(migrated!.version).toBe(2);
    expect(migrated!.savedAt).toBe(v1.savedAt);

    const rs = migrated!.robotState;
    expect(rs.batteryLevel).toBe(42.5);
    expect(rs.location).toEqual({ x: 3, y: 4, z: 0, zone: 'AISLE-3', heading: 90, floor: '1' });
    expect(rs.heldObject).toBe('crate-7');
    expect(rs.status).toBe('online');
    expect(rs.errors).toEqual(['some error']);
    expect(rs.warnings).toEqual(['Emergency stop activated: operator pressed the button']);

    expect(migrated!.taskQueue).toHaveLength(2);
    expect(migrated!.taskQueue.map((t) => t.id)).toEqual(['task-1', 'task-2']);
  });

  it('defaults the new agentState block to the SAFE values, not to a guess', () => {
    const migrated = migratePersistedState(makeV1());

    // A v1 robot has no record either way. "Not latched" is the honest answer;
    // the E-Stop *warning* it carries is reconciled at restore time, not here.
    expect(migrated!.agentState).toEqual({
      estopLatched: false,
      estopReason: null,
      estopAt: null,
      damped: false,
      lastFsmId: null,
      place: null,
      bootId: '',
    });
  });

  it('leaves a v2 blob untouched', () => {
    const v2: PersistedState = {
      ...(migratePersistedState(makeV1()) as PersistedState),
      agentState: {
        estopLatched: true,
        estopReason: 'Agent Mode E-Stop: stop word',
        estopAt: '2026-08-02T10:00:00.000Z',
        damped: true,
        lastFsmId: 1,
        place: 'AISLE-3',
        bootId: 'b-7f3a',
      },
    };

    expect(migratePersistedState(v2)).toEqual(v2);
  });

  it('repairs a v2 blob whose agentState is missing or malformed', () => {
    const broken = { ...(makeV1() as object), version: 2, agentState: 'nope' };
    const migrated = migratePersistedState(broken);

    expect(migrated!.agentState).toEqual(defaultPersistedAgentState());
  });

  it('refuses a version it does not know how to read', () => {
    expect(migratePersistedState({ ...makeV1(), version: 3 })).toBeNull();
    expect(migratePersistedState({ ...makeV1(), version: 0 })).toBeNull();
    expect(migratePersistedState(null)).toBeNull();
    expect(migratePersistedState({ version: 1 })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// load()
// ---------------------------------------------------------------------------

describe('StatePersistence.load — version handling', () => {
  it('reads a v1 file on disk and hands back a migrated v2', () => {
    const file = writeFixture('v1.json', makeV1());
    const loaded = new StatePersistence(file).load();

    expect(loaded).not.toBeNull();
    expect(loaded!.version).toBe(2);
    expect(loaded!.robotState.batteryLevel).toBe(42.5);
    expect(loaded!.taskQueue).toHaveLength(2);
    expect(loaded!.agentState.estopLatched).toBe(false);
  });

  it('reads a v2 file back unchanged', () => {
    const v2 = migratePersistedState(makeV1()) as PersistedState;
    v2.agentState.estopLatched = true;
    v2.agentState.estopReason = 'Agent Mode E-Stop: operator';
    const file = writeFixture('v2.json', v2);

    const loaded = new StatePersistence(file).load();
    expect(loaded!.agentState.estopLatched).toBe(true);
    expect(loaded!.agentState.estopReason).toBe('Agent Mode E-Stop: operator');
  });

  it('rejects a FUTURE version instead of silently accepting it', () => {
    const file = writeFixture('v3.json', { ...makeV1(), version: 3 });
    expect(new StatePersistence(file).load()).toBeNull();
  });

  it('rejects a corrupt file', () => {
    const file = path.join(tmpDir, 'corrupt.json');
    fs.writeFileSync(file, '{ not json', 'utf-8');
    expect(new StatePersistence(file).load()).toBeNull();
  });

  it('round-trips what it writes — the hardcoded-version regression guard', () => {
    const file = path.join(tmpDir, 'roundtrip.json');
    const persistence = new StatePersistence(file);
    const state = migratePersistedState(makeV1()) as PersistedState;
    state.version = PERSISTED_STATE_VERSION;

    persistence.saveSync(state);
    const loaded = persistence.load();

    expect(loaded).not.toBeNull();
    expect(loaded!.version).toBe(PERSISTED_STATE_VERSION);
  });
});

// ---------------------------------------------------------------------------
// The write itself (the crash this file exists to survive)
// ---------------------------------------------------------------------------

/**
 * `fs.writeFileSync` onto the live path opens it `O_TRUNC`. A process that dies
 * between the truncate and the write leaves an EMPTY or half-written file, and
 * `load()` answers `null` for that — so the robot boots with no E-Stop latch, no
 * damped flag and no agent state, having erased the evidence of the very crash
 * this durable snapshot exists to survive. Both write paths go through a temp
 * file and a rename instead.
 */
describe('StatePersistence — the durable write is atomic', () => {
  function spyWrites(): string[] {
    const targets: string[] = [];
    const real = fs.writeFileSync;
    vi.spyOn(fs, 'writeFileSync').mockImplementation(((
      p: fs.PathOrFileDescriptor,
      data: string,
      opts: unknown,
    ) => {
      targets.push(String(p));
      return (real as (...args: unknown[]) => void)(p, data, opts);
    }) as typeof fs.writeFileSync);
    return targets;
  }

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('never opens the live state file for writing — saveSync', () => {
    const file = path.join(tmpDir, 'state-sync.json');
    const persistence = new StatePersistence(file);
    const state = migratePersistedState(makeV1()) as PersistedState;
    const targets = spyWrites();

    persistence.saveSync(state);

    expect(targets).toHaveLength(1);
    expect(targets[0]).not.toBe(file);
    expect(targets[0]).toMatch(/\.tmp-\d+-\d+$/);
    vi.restoreAllMocks();
    expect(new StatePersistence(file).load()!.version).toBe(PERSISTED_STATE_VERSION);
    // No full copy of the state left lying beside it.
    expect(fs.readdirSync(tmpDir)).toEqual(['state-sync.json']);
  });

  it('never opens the live state file for writing — the debounced flush', () => {
    vi.useFakeTimers();
    const file = path.join(tmpDir, 'state-debounced.json');
    const persistence = new StatePersistence(file);
    const state = migratePersistedState(makeV1()) as PersistedState;
    const targets = spyWrites();

    persistence.save(state);
    vi.advanceTimersByTime(1000);

    expect(targets).toHaveLength(1);
    expect(targets[0]).not.toBe(file);
    expect(targets[0]).toMatch(/\.tmp-\d+-\d+$/);
    vi.restoreAllMocks();
    vi.useRealTimers();
    expect(new StatePersistence(file).load()!.agentState).toEqual(defaultPersistedAgentState());
  });
});
