/**
 * @file block-kind-allowlists.test.ts
 * @description Every allow-list a block kind passes through, asserted BY VALUE.
 *
 * Adding a block kind is a ~31-file change TypeScript catches five of, and two
 * of the unchecked allow-lists FAIL OPEN: `initiative.ts` treats an unlisted
 * kind as self-initiable, and `journal.ts` `blockTrust()` defaults an unlisted
 * kind to `'self'` — the one trust tier that may be promoted into durable
 * memory. This file is the compensating check. Every assertion is on the VALUE
 * ("`vla_skill` is refused"), never on the absence of an entry, because absence
 * is exactly what those two lists read as permission.
 *
 * The sweeps at the bottom are the part that protects the NEXT block kind: they
 * enumerate `PlannerBlockKinds` and fail when a new one has no narrator phrase
 * or no verdict from the initiative gate.
 *
 * @feature agentmode
 * @status test
 */

import { describe, it, expect } from 'vitest';
import { mayInitiate, SELF_FORBIDDEN_KINDS, type InitiativeContext } from '../initiative.js';
import { blockTrust, UNTRUSTED_BLOCK_KINDS } from '../journal.js';
import { filterHeartbeatBlocks, HEARTBEAT_ALLOWED_KINDS } from '../heartbeat.js';
import { describePlanAloud } from '../voice-narrator.js';
import { AgentBlockKinds, PlannerBlockKinds, type AgentBlock, type AgentPlan } from '../types.js';

/** A robot with nothing at all wrong with it — every refusal below is the KIND. */
const HEALTHY: InitiativeContext = {
  estopLatched: false,
  crashAcknowledged: true,
  batteryPercent: 100,
  place: 'AISLE-1',
  placeAgeMs: 1_000,
  damped: false,
};

function block(kind: AgentBlock['kind'], params: Record<string, unknown> = {}): AgentBlock {
  return { id: `${kind}-1`, kind, params, status: 'pending' };
}

function plan(blocks: AgentBlock[]): AgentPlan {
  return {
    id: 'plan-1',
    robotId: 'g1',
    command: 'test',
    blocks,
    cursor: -1,
    status: 'running',
    createdAt: '2026-08-29T00:00:00.000Z',
    updatedAt: '2026-08-29T00:00:00.000Z',
  };
}

describe('`vla_skill` is planner-emittable', () => {
  it('is in the vocabulary and is NOT runner-owned', () => {
    expect(AgentBlockKinds).toContain('vla_skill');
    // The whole defect TASK-226 fixes: `demo` is the only block that reaches a
    // policy and it is host-only, so the planner had no way to manipulate
    // anything at all.
    expect(PlannerBlockKinds).toContain('vla_skill');
  });
});

describe('`vla_skill` fails closed in every allow-list it touches', () => {
  it('is NOT self-initiable — asserted on the verdict, not on a missing entry', () => {
    expect(SELF_FORBIDDEN_KINDS.has('vla_skill')).toBe(true);
    const verdict = mayInitiate('vla_skill', 'self', HEALTHY);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain('vla_skill');
  });

  it('is refused to a SCHEDULED origin too', () => {
    // `scheduled` (the patrol cron) is judged exactly like `self` from the
    // origin check onwards — nobody is standing in front of the robot.
    expect(mayInitiate('vla_skill', 'scheduled', HEALTHY).ok).toBe(false);
  });

  it('IS allowed to an operator, who is the acknowledgement', () => {
    expect(mayInitiate('vla_skill', 'operator', HEALTHY).ok).toBe(true);
  });

  it('is NOT `self`-trusted in the journal', () => {
    // `blockTrust` defaults an unlisted kind to `'self'`, the only tier that
    // may be promoted into durable memory. A rollout that ran its whole step
    // budget while grasping nothing must not be able to file "I moved the apple
    // to the plate" as a fact about the world.
    expect(blockTrust('vla_skill')).toBe('untrusted');
    expect(UNTRUSTED_BLOCK_KINDS.has('vla_skill')).toBe(true);
    // The pre-existing entries are unchanged.
    expect(blockTrust('look')).toBe('untrusted');
    expect(blockTrust('walk')).toBe('self');
  });

  it('is refused by the heartbeat, and is actually dropped from a heartbeat plan', () => {
    expect(HEARTBEAT_ALLOWED_KINDS.has('vla_skill')).toBe(false);
    const filtered = filterHeartbeatBlocks([
      { kind: 'speak', params: { text: 'hello' } },
      { kind: 'vla_skill', params: { skill: 'g1_apple_pnp' } },
    ]);
    expect(filtered.kept.map((b) => b.kind)).toEqual(['speak']);
    expect(filtered.dropped).toEqual(['vla_skill']);
  });
});

describe('`vla_skill` is narrated', () => {
  it('names the skill, not the policy’s trained prompt', () => {
    const spoken = describePlanAloud(
      plan([block('vla_skill', { skill: 'g1_apple_pnp', label: 'apple pick and place' })]),
      'en',
    );
    expect(spoken).toContain('apple pick and place');
    // The instruction is a dataset annotation; reading it to the room would be
    // the robot narrating its own training data.
    expect(spoken).not.toContain('move the apple to the plate');
  });

  it('falls back to the phrasebook when the block carries no label', () => {
    expect(describePlanAloud(plan([block('vla_skill')]), 'en')).toContain('learned skill');
    expect(describePlanAloud(plan([block('vla_skill')]), 'de')).toContain('Fertigkeit');
  });
});

describe('sweeps — so the NEXT block kind cannot skip these quietly', () => {
  it('every planner-emittable kind has a spoken clause, bar the documented three', () => {
    // `speak` and `greet` are announced by saying their own words — prefixing
    // them with "I will say something" turns one utterance into two.
    //
    // `remember` is a PRE-EXISTING gap, not one this task introduced: it has no
    // phrasebook entry, so a plan whose only block is a `remember` is
    // acknowledged with silence. Pinned here rather than fixed, because
    // changing what the robot says out loud is not TASK-226's to change — but
    // pinned by NAME, so the day somebody gives it a phrase this assertion
    // fails and points at itself.
    const SILENT_BY_DESIGN = new Set(['speak', 'greet']);
    const SILENT_KNOWN_GAP = new Set(['remember']);
    const silent = PlannerBlockKinds.filter(
      (kind) =>
        !SILENT_BY_DESIGN.has(kind) &&
        (describePlanAloud(plan([block(kind, { text: 'x' })]), 'en') ?? '').trim() === '',
    );
    expect(new Set(silent)).toEqual(SILENT_KNOWN_GAP);
  });

  it('the initiative gate answers for every kind, with a reason', () => {
    for (const kind of AgentBlockKinds) {
      const verdict = mayInitiate(kind, 'self', HEALTHY);
      expect(typeof verdict.ok, kind).toBe('boolean');
      expect(verdict.reason, kind).toBeTruthy();
    }
  });

  it('blockTrust answers for every kind', () => {
    for (const kind of AgentBlockKinds) {
      expect(['self', 'operator', 'untrusted'], kind).toContain(blockTrust(kind));
    }
  });
});
