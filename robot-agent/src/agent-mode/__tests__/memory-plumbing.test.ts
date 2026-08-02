/**
 * @file memory-plumbing.test.ts
 * @description The seam between durable memory and the rest of Agent Mode
 *              (TASK-197): the `remember` block, the planner's validation of
 *              it, the place-keyed injection into the planner prompt, and the
 *              journal tee inside `ServerMirror.logBlock`.
 * @feature agentmode
 * @status test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AgentModeController } from '../agent-mode-controller.js';
import { BlockExecutor, type BlockExecutorDeps } from '../block-executor.js';
import { ControlOwnerLock } from '../control-owner.js';
import { Journal, setJournalBootId } from '../journal.js';
import { coerceParams } from '../planner.js';
import { buildPlannerPrompt } from '../prompts.js';
import { RangeSensor } from '../range.js';
import { SceneMemoryStore } from '../scene-memory.js';
import { ServerMirror } from '../server-mirror.js';
import { Workspace, type JournalRecord, type TrustLevel } from '../workspace.js';
import type { Planner, PlannedBlockRaw } from '../planner.js';
import type { AgentBlock, ScenePlace } from '../types.js';
import type { VisionClient } from '../vision.js';
import type { PlaceBelief, RobotStateManager } from '../../robot/state.js';

const AISLE_3: ScenePlace = {
  id: 'AISLE-3',
  name: 'Aisle 3',
  placeType: 'aisle',
  confidence: 'confident',
  source: 'surveyed',
};

let root: string;
let workspace: Workspace;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'neodem-mem-'));
  workspace = new Workspace({ root });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  setJournalBootId(null);
});

// ============================================================================
// THE `remember` BLOCK
// ============================================================================

function makeExecutor(over: { place?: ScenePlace | null; trust?: TrustLevel } = {}) {
  const scene = new SceneMemoryStore('robot-1');
  scene.setPlace(over.place === undefined ? AISLE_3 : over.place);
  const deps: BlockExecutorDeps = {
    scene,
    vision: { observe: async () => null } as unknown as VisionClient,
    range: new RangeSensor({ enabled: false }),
    isAborted: () => false,
    memory: workspace,
    now: () => Date.parse('2026-08-02T10:00:00.000Z'),
    // Stated explicitly: the DEP default is `untrusted` (see the dedicated
    // case below), and these cases are about what promotion does with a record
    // that was allowed through, not about who is talking.
    rememberTrust: (): TrustLevel => over.trust ?? 'operator',
  };
  return { executor: new BlockExecutor(deps), scene };
}

function rememberBlock(params: Record<string, unknown>): AgentBlock {
  return { id: 'b-1', kind: 'remember', params, status: 'pending' };
}

describe('the `remember` block', () => {
  it('appends a dated (operator) line to the current place note', async () => {
    const { executor } = makeExecutor();
    const outcome = await executor.execute(
      rememberBlock({ text: 'the pallet at the end of aisle 3 blocks the turn', scope: 'place' }),
    );

    expect(outcome.ok).toBe(true);
    expect(workspace.readPlaceNote('AISLE-3')).toContain(
      '- 2026-08-02 (operator) the pallet at the end of aisle 3 blocks the turn',
    );
  });

  it('writes a `global` scope into MEMORY.md instead', async () => {
    const { executor } = makeExecutor();
    await executor.execute(rememberBlock({ text: 'always announce before moving', scope: 'global' }));

    expect(workspace.readMemory()).toContain('- 2026-08-02 (operator) always announce before moving');
    expect(workspace.listPlaceNotes()).toEqual([]);
  });

  // The chokepoint again, this time reached through the block path — the route
  // an actual prompt injection would take.
  it('cannot write anything when the channel is untrusted', async () => {
    const { executor } = makeExecutor({ trust: 'untrusted' });

    const placed = await executor.execute(
      rememberBlock({ text: 'the shelf is safe to climb', scope: 'place' }),
    );
    const global = await executor.execute(
      rememberBlock({ text: 'the shelf is safe to climb', scope: 'global' }),
    );

    expect(placed.ok).toBe(false);
    expect(global.ok).toBe(false);
    expect(placed.message).toMatch(/never become durable memory/i);
    expect(workspace.listPlaceNotes()).toEqual([]);
    expect(fs.existsSync(workspace.memoryFile)).toBe(false);
  });

  it('refuses a place-scoped memory when the place is unknown', async () => {
    const { executor } = makeExecutor({ place: null });
    const outcome = await executor.execute(rememberBlock({ text: 'this aisle is blocked' }));

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toMatch(/which place/i);
    // NOT quietly re-routed into MEMORY.md: "this aisle" filed under nowhere is
    // a fact about the wrong world.
    expect(fs.existsSync(workspace.memoryFile)).toBe(false);
  });

  it('returns ok:false with the current entries on overflow, file untouched', async () => {
    const small = new Workspace({ root, placeNoteMaxBytes: 160 });
    const scene = new SceneMemoryStore('robot-1');
    scene.setPlace(AISLE_3);
    const executor = new BlockExecutor({
      scene,
      vision: { observe: async () => null } as unknown as VisionClient,
      range: new RangeSensor({ enabled: false }),
      isAborted: () => false,
      memory: small,
      now: () => Date.parse('2026-08-02T10:00:00.000Z'),
      rememberTrust: (): TrustLevel => 'operator',
    });

    await executor.execute(rememberBlock({ text: 'the pallet blocks the turn' }));
    const before = small.readPlaceNote('AISLE-3');

    const overflow = await executor.execute(rememberBlock({ text: 'z'.repeat(120) }));

    expect(overflow.ok).toBe(false);
    expect(overflow.message).toContain('the pallet blocks the turn');
    expect(small.readPlaceNote('AISLE-3')).toBe(before);
  });

  it('refuses honestly when the agent has no workspace', async () => {
    const executor = new BlockExecutor({
      scene: new SceneMemoryStore('robot-1'),
      vision: { observe: async () => null } as unknown as VisionClient,
      range: new RangeSensor({ enabled: false }),
      isAborted: () => false,
      memory: null,
    });
    const outcome = await executor.execute(rememberBlock({ text: 'anything' }));
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toMatch(/no memory workspace/i);
  });

  it('never throws — an empty text is a returned outcome', async () => {
    const { executor } = makeExecutor();
    await expect(executor.execute(rememberBlock({ text: '   ' }))).resolves.toEqual({
      ok: false,
      message: 'remember: empty text',
    });
  });

  /**
   * The dep is optional, and what it defaults to is a security decision: the
   * whole trust tier exists so unvouched-for content cannot reach durable
   * memory, and a default of `operator` handed the MOST privileged tier to any
   * construction that simply forgot to pass it.
   */
  it('defaults to the untrusted tier when nobody says who is talking', async () => {
    const scene = new SceneMemoryStore('robot-1');
    scene.setPlace(AISLE_3);
    const executor = new BlockExecutor({
      scene,
      vision: { observe: async () => null } as unknown as VisionClient,
      range: new RangeSensor({ enabled: false }),
      isAborted: () => false,
      memory: workspace,
      // rememberTrust deliberately absent — this is the forgetful construction.
    });

    const outcome = await executor.execute(rememberBlock({ text: 'the shelf is safe to climb' }));

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toMatch(/never become durable memory/i);
    expect(workspace.listPlaceNotes()).toEqual([]);
  });
});

// ============================================================================
// A DURABLE WRITE THAT FAILED HAS TO BE VISIBLE
// ============================================================================

/**
 * `atomicWrite` THROWS when the rename cannot land (a virus scanner, a second
 * process, a full disk — this box has produced orphaned `*.tmp-*` files for
 * real). That used to surface as one failed block and nothing else: the
 * heartbeat's `workspace_write_failed` predicate is fed by `noteWorkspaceWrite`,
 * which only the journal path called, so memory could stop recording for good
 * while the robot reported a healthy workspace.
 */
describe('the `remember` block reports the health of the disk', () => {
  function trackingExecutor(memory: Workspace) {
    const writes: { ok: boolean; error: string | null }[] = [];
    const scene = new SceneMemoryStore('robot-1');
    scene.setPlace(AISLE_3);
    const executor = new BlockExecutor({
      scene,
      vision: { observe: async () => null } as unknown as VisionClient,
      range: new RangeSensor({ enabled: false }),
      isAborted: () => false,
      memory,
      now: () => Date.parse('2026-08-02T10:00:00.000Z'),
      rememberTrust: (): TrustLevel => 'operator',
      onDurableWrite: (ok, error) => writes.push({ ok, error }),
    });
    return { executor, writes };
  }

  it('raises a workspace-write failure when the write throws', async () => {
    const failing = new Workspace({ root });
    vi.spyOn(failing, 'atomicWrite').mockImplementation(() => {
      throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
    });
    const { executor, writes } = trackingExecutor(failing);

    const outcome = await executor.execute(rememberBlock({ text: 'the pallet blocks the turn' }));

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toMatch(/EPERM/);
    expect(writes).toEqual([{ ok: false, error: expect.stringContaining('EPERM') }]);
  });

  it('reports a write that landed, so a disk that came back clears the flag', async () => {
    const { executor, writes } = trackingExecutor(workspace);

    await executor.execute(rememberBlock({ text: 'the pallet blocks the turn' }));

    expect(writes).toEqual([{ ok: true, error: null }]);
  });

  it('says nothing about the disk when the record was merely REFUSED', async () => {
    const { executor, writes } = trackingExecutor(workspace);

    // Untrusted content and an overfull file are decisions, not I/O failures:
    // reporting them would make the robot announce a broken memory it does not
    // have, and clearing on them would hide a real one.
    const refused = await executor.execute(rememberBlock({ text: '' }));

    expect(refused.ok).toBe(false);
    expect(writes).toEqual([]);
  });
});

// ============================================================================
// PLANNER VALIDATION
// ============================================================================

describe('coerceParams — remember', () => {
  const raw = (over: Partial<PlannedBlockRaw> = {}): PlannedBlockRaw =>
    ({ kind: 'remember', text: 'the pallet blocks the turn', ...over }) as PlannedBlockRaw;

  it('defaults the scope to `place`', () => {
    expect(coerceParams(raw())).toEqual({
      text: 'the pallet blocks the turn',
      scope: 'place',
    });
  });

  it('accepts an explicit global scope', () => {
    expect(coerceParams(raw({ scope: 'global' }))).toMatchObject({ scope: 'global' });
  });

  it('rejects text longer than 240 characters', () => {
    // Not clamped the way a distance is: half a remembered sentence is a
    // sentence that changed meaning.
    expect(() => coerceParams(raw({ text: 'x'.repeat(241) }))).toThrow(/240-character limit/);
    expect(() => coerceParams(raw({ text: 'x'.repeat(240) }))).not.toThrow();
  });

  it('rejects a missing text', () => {
    expect(() => coerceParams(raw({ text: '   ' }))).toThrow(/missing "text"/);
  });

  it('rejects an unknown scope rather than defaulting to the wider one', () => {
    const bad = { kind: 'remember', text: 'x', scope: 'everywhere' } as unknown as PlannedBlockRaw;
    expect(() => coerceParams(bad)).toThrow(/unknown scope/);
  });
});

describe('the planner prompt', () => {
  it('carries exactly one remember rule and the block reference line', () => {
    const prompt = buildPlannerPrompt({ command: 'merk dir das', sceneSummary: 'empty' });

    expect(prompt).toContain('- remember   {"text"');
    expect(prompt).toMatch(/"remember X" \/ "merk dir X" \/ "memorize X" -> emit ONE `remember` block/);
    // Budgeted: gemma3:4b prompt length is a measured regression risk here, and
    // there is deliberately no `recall` rule to match it.
    expect(prompt).not.toMatch(/recall/i);
  });
});

// ============================================================================
// RETRIEVAL — INJECTED, NEVER PLANNED
// ============================================================================

function makeController(
  belief: () => PlaceBelief | null,
  over: { memory?: Workspace | null } = {},
) {
  const scene = new SceneMemoryStore('robot-1');
  const prompts: string[] = [];
  const controller = new AgentModeController({
    robotId: 'robot-1',
    enabled: true,
    scene,
    // `null` is a controller with NO workspace, which is not the same as an
    // empty one — every memory surface then says so.
    memory: over.memory === undefined ? workspace : over.memory,
    journal: new Journal({ workspace }),
    lock: new ControlOwnerLock(),
    planner: {
      plan: async (input: { sceneSummary: string }) => {
        prompts.push(input.sceneSummary);
        return { blocks: [], fallback: false, attempts: 1 };
      },
    } as unknown as Planner,
    vision: { observe: async () => null } as unknown as VisionClient,
    mirror: { emit: () => {}, push: async () => {}, logBlock: async () => {} } as unknown as ServerMirror,
  });
  controller.attach({ getPlaceBelief: () => belief() } as unknown as RobotStateManager);
  return { controller, scene, prompts };
}

const AT_AISLE_3: PlaceBelief = {
  place: AISLE_3,
  poseM: { x: 9, y: 0 },
  poseSource: 'odometry',
  driftSinceAnchorM: 1.2,
  ageMs: 40,
  insideKeepout: false,
};

describe('place-keyed retrieval into the planner prompt', () => {
  function note(place: string, msg: string): void {
    const record: JournalRecord = {
      t: '2026-08-02T10:00:00.000Z',
      bootId: null,
      kind: 'note',
      place,
      trust: 'operator',
      msg,
    };
    expect(workspace.promote(record, 'place').ok).toBe(true);
  }

  it('injects what the robot knows about the place it is standing in', async () => {
    note('AISLE-3', 'the pallet at the end blocks the turn');
    const { controller, prompts } = makeController(() => AT_AISLE_3);

    await controller.submitCommand({ text: 'walk to the end of the aisle' });
    await controller.whenIdle();

    expect(prompts[0]).toContain('What you know about this place (AISLE-3):');
    expect(prompts[0]).toContain('the pallet at the end blocks the turn');
    // The provenance marker survives: "someone told me" and "I measured it" are
    // different grounds for acting.
    expect(prompts[0]).toContain('(operator)');
  });

  it('never injects another place\'s notes', async () => {
    note('DOCK-1', 'the ramp is wet');
    const { controller, prompts } = makeController(() => AT_AISLE_3);

    await controller.submitCommand({ text: 'walk forward' });
    await controller.whenIdle();

    expect(prompts[0]).not.toContain('ramp');
    expect(prompts[0]).not.toContain('What you know about this place');
  });

  it('omits the section entirely when the place is unknown', async () => {
    note('AISLE-3', 'the pallet at the end blocks the turn');
    const { controller, prompts } = makeController(() => ({
      place: null,
      poseM: null,
      poseSource: null,
      driftSinceAnchorM: null,
      ageMs: null,
      insideKeepout: null,
    }));

    await controller.submitCommand({ text: 'walk forward' });
    await controller.whenIdle();

    // An empty "What you know" heading reads as "nothing is true here", which
    // is a different claim from "I do not know where I am".
    expect(prompts[0]).not.toContain('What you know about this place');
  });

  it('sees a note written moments ago — retrieval is read at plan start', async () => {
    const { controller, prompts } = makeController(() => AT_AISLE_3);

    await controller.submitCommand({ text: 'walk forward' });
    await controller.whenIdle();
    expect(prompts[0]).not.toContain('What you know about this place');

    note('AISLE-3', 'the pallet at the end blocks the turn');

    await controller.submitCommand({ text: 'walk forward again' });
    await controller.whenIdle();
    expect(prompts[1]).toContain('the pallet at the end blocks the turn');
  });
});

// ============================================================================
// THE JOURNAL TEE
// ============================================================================

describe('ServerMirror — the journal tee', () => {
  const finished = (over: Partial<AgentBlock> = {}): AgentBlock => ({
    id: 'b-1',
    kind: 'walk',
    params: { distanceM: 1 },
    status: 'done',
    startedAt: '2026-08-02T09:59:58.000Z',
    finishedAt: '2026-08-02T10:00:00.000Z',
    result: 'Walked 0.98 m forward.',
    measured: { distanceM: 0.98 },
    ...over,
  });

  it('writes the local line before the network call, tagged `self`', async () => {
    setJournalBootId('b-7f3a');
    const journal = new Journal({ workspace });
    let complianceCalled = false;
    const mirror = new ServerMirror({
      journal,
      logCommandExecution: async () => {
        // The journal line must already be on disk by the time the network
        // phase runs — it is the copy that survives the process dying.
        expect(journal.readDay('2026-08-02')).toHaveLength(1);
        complianceCalled = true;
      },
    });

    await mirror.logBlock('walk to the shelf', finished(), {
      planId: 'plan-1',
      place: 'AISLE-3',
      pose: { x: -4.2, y: 3.1, yawDeg: 91, source: 'odometry' },
    });

    expect(complianceCalled).toBe(true);
    expect(journal.readDay('2026-08-02')[0]).toMatchObject({
      bootId: 'b-7f3a',
      kind: 'block',
      planId: 'plan-1',
      block: 'walk',
      ok: true,
      place: 'AISLE-3',
      trust: 'self',
      msg: 'Walked 0.98 m forward.',
    });
  });

  it('records a failed block as ok:false with its error', async () => {
    const journal = new Journal({ workspace });
    const mirror = new ServerMirror({ journal, logCommandExecution: async () => {} });

    await mirror.logBlock('walk', finished({ status: 'failed', result: undefined, error: 'walk: the robot did not move' }));

    expect(journal.readDay('2026-08-02')[0]).toMatchObject({
      ok: false,
      place: null,
      msg: 'walk: the robot did not move',
    });
  });

  it('runs unchanged with no journal at all', async () => {
    const mirror = new ServerMirror({ journal: null, logCommandExecution: async () => {} });
    await expect(mirror.logBlock('walk', finished())).resolves.toBeUndefined();
  });
});

// ============================================================================
// THE DIGEST HAS TO REACH THE SERVER
// ============================================================================

/**
 * `agent:memory:updated` carries nothing but the digest, so the mirror is the
 * whole transport: whatever it drops here never reaches the app's MemoryPanel.
 */
describe('ServerMirror — the memory digest on the wire', () => {
  it('pushes the digest verbatim to the server ingest route', async () => {
    const calls: { url: string; body: unknown }[] = [];
    const mirror = new ServerMirror({
      serverUrl: 'http://server:3001',
      robotId: 'robot-1',
      journal: null,
      fetchImpl: (async (url: string, init: RequestInit) => {
        calls.push({ url, body: JSON.parse(String(init.body)) });
        return new Response('{}', { status: 200 });
      }) as unknown as typeof fetch,
    });

    await mirror.push({
      type: 'agent:memory:updated',
      robotId: 'robot-1',
      memory: {
        robotId: 'robot-1',
        place: 'AISLE-3',
        memoryBytes: 120,
        memoryMaxBytes: 8192,
        memoryEntries: 2,
        places: [{ id: 'AISLE-3', entries: 1, bytes: 60 }],
        journalDays: ['2026-08-02'],
        retention: null,
        updatedAt: '2026-08-02T10:00:00.000Z',
      },
      timestamp: '2026-08-02T10:00:00.000Z',
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://server:3001/api/robots/robot-1/agent-mode/events');
    expect(calls[0].body).toMatchObject({
      type: 'agent:memory:updated',
      memory: { memoryEntries: 2, place: 'AISLE-3' },
    });
  });
});

// ============================================================================
// THE MEMORY DIGEST + ERASURE
// ============================================================================

describe('controller memory surfaces', () => {
  it('reports counts, not content, and erases on request', async () => {
    const { controller } = makeController(() => AT_AISLE_3);
    workspace.promote(
      { t: '2026-08-02T10:00:00.000Z', bootId: null, kind: 'note', place: 'AISLE-3', trust: 'operator', msg: 'pallet blocks the turn' },
      'place',
    );
    workspace.promote(
      { t: '2026-08-02T10:00:00.000Z', bootId: null, kind: 'note', place: null, trust: 'self', msg: 'a global fact' },
      'memory',
    );

    const digest = controller.memoryDigest();
    expect(digest).toMatchObject({
      robotId: 'robot-1',
      place: 'AISLE-3',
      memoryEntries: 1,
      places: [{ id: 'AISLE-3', entries: 1 }],
      // UNKNOWN until the platform has been asked — never "nothing is retained".
      retention: null,
    });
    // Counts, not content: the digest is fanned out to every WebSocket client.
    expect(JSON.stringify(digest)).not.toContain('pallet blocks the turn');

    expect(controller.memoryMarkdown()).toContain('a global fact');

    const erased = controller.eraseMemory();
    expect(erased.ok).toBe(true);
    expect(erased.removed).toBeGreaterThan(0);
    expect(controller.memoryDigest()).toMatchObject({ memoryEntries: 0, places: [] });
    // …and the robot no longer has anything to volunteer about the place.
    expect(workspace.placeExcerpt('AISLE-3')).toBe('');
  });

  it('reports the IDENTITY.md redaction, not just the deletions', () => {
    const { controller } = makeController(() => AT_AISLE_3);
    workspace.ensure();
    // The one workspace where the ONLY personal data is a redaction rather than
    // a deletion. `Workspace.erase()` has always returned `redacted`, but the
    // controller destructured `{removed, errors}` and dropped it, so the route
    // answered `removed: 0, ok: true` — which reads as "there was nothing
    // there" while a named human and a named site were in fact cleared, and
    // `RobotMemoryErasureService` had nothing to record against the request.
    fs.writeFileSync(
      workspace.identityFile,
      ['# Identity', '', '- **Name**: Nova', '- **Operator**: Sam Weber', '- **Site**: Halle 3', ''].join(
        '\n',
      ),
      'utf-8',
    );

    const erased = controller.eraseMemory();

    expect(erased).toMatchObject({ ok: true, removed: 0, redacted: 1, errors: [] });
    expect(fs.readFileSync(workspace.identityFile, 'utf-8')).not.toContain('Sam Weber');
  });

  it('answers with a zero redaction count when there is no workspace at all', () => {
    const { controller } = makeController(() => AT_AISLE_3, { memory: null });
    expect(controller.eraseMemory()).toEqual({
      ok: false,
      removed: 0,
      redacted: 0,
      errors: ['no memory workspace configured'],
    });
  });

  it('prunes the journal to the retention the platform reported', () => {
    const { controller } = makeController(() => AT_AISLE_3);
    const journal = new Journal({ workspace });
    journal.append({
      t: '2026-01-01T10:00:00.000Z',
      bootId: null,
      kind: 'block',
      place: null,
      trust: 'self',
      msg: 'ancient',
    });

    controller.applyJournalRetention({
      retentionDays: 30,
      source: 'policy',
      legalHold: false,
      legalHoldKnown: true,
      error: null,
    });

    expect(journal.listDays()).not.toContain('2026-01-01');
    expect(controller.memoryDigest()?.retention).toEqual({
      retentionDays: 30,
      source: 'policy',
      legalHold: false,
      legalHoldKnown: true,
      error: null,
    });
  });
});
