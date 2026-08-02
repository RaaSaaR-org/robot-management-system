/**
 * @file intents.test.ts
 * @description Standing intents (TASK-199 §3): the cooldown, the fire budget
 *              and the expiry are what stop "tell me when you're next in the
 *              workshop" from firing 400 times — and the whole matching path
 *              costs no model call and no network call.
 * @feature agentmode
 * @status test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  INTENT_DEFAULT_COOLDOWN_MS,
  INTENT_DEFAULT_FIRES,
  INTENT_MAX,
  IntentStore,
  intentTriggerMatches,
  parseIntentLine,
} from '../intents.js';
import { Workspace } from '../workspace.js';

const NOW = Date.parse('2026-08-02T10:00:00.000Z');
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

let root: string;
let workspace: Workspace;
let clock = NOW;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'neodem-intents-'));
  workspace = new Workspace({ root });
  clock = NOW;
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function makeStore(): IntentStore {
  return new IntentStore({ workspace, now: () => new Date(clock) });
}

const WORKSHOP = { place: 'WORKSHOP' };
const LADDER = 'is the ladder still blocking the door?';

function armed(store: IntentStore, over: Parameters<IntentStore['arm']>[0] = { trigger: WORKSHOP, text: LADDER }) {
  const result = store.arm(over, 'operator');
  expect(result.ok).toBe(true);
  return result.intent!;
}

function situation(over: { place?: string | null; view?: string; nowMs?: number } = {}) {
  return {
    place: over.place === undefined ? 'WORKSHOP' : over.place,
    view: over.view ?? 'a workbench and a ladder',
    nowMs: over.nowMs ?? clock,
  };
}

// ============================================================================
// MATCHING — pure, deterministic, no model
// ============================================================================

describe('intentTriggerMatches', () => {
  it('matches a place case-insensitively', () => {
    expect(intentTriggerMatches({ place: 'workshop' }, { place: 'WORKSHOP', view: '' })).toBe(true);
    expect(intentTriggerMatches({ place: 'WORKSHOP' }, { place: 'AISLE-3', view: '' })).toBe(false);
  });

  it('never matches a place trigger while the place is UNKNOWN', () => {
    // "I might be there" is not "I am there".
    expect(intentTriggerMatches({ place: 'WORKSHOP' }, { place: null, view: '' })).toBe(false);
  });

  it('requires every keyword to appear', () => {
    const trigger = { keywords: ['ladder', 'door'] };
    expect(intentTriggerMatches(trigger, { place: null, view: 'a ladder by the door' })).toBe(true);
    expect(intentTriggerMatches(trigger, { place: null, view: 'a ladder' })).toBe(false);
  });

  it('ANDs a place with its keywords', () => {
    const trigger = { place: 'WORKSHOP', keywords: ['ladder'] };
    expect(intentTriggerMatches(trigger, { place: 'WORKSHOP', view: 'a ladder' })).toBe(true);
    expect(intentTriggerMatches(trigger, { place: 'WORKSHOP', view: 'a workbench' })).toBe(false);
    expect(intentTriggerMatches(trigger, { place: 'AISLE-3', view: 'a ladder' })).toBe(false);
  });

  it('never matches an empty trigger', () => {
    expect(intentTriggerMatches({}, { place: 'WORKSHOP', view: 'anything' })).toBe(false);
  });
});

// ============================================================================
// THE STORE
// ============================================================================

describe('IntentStore.arm', () => {
  it('refuses an intent the robot tried to leave itself', () => {
    // No recursion: an agent that can schedule its own future wake-ups has an
    // unbounded runaway path, and this refusal is in code rather than a prompt.
    const result = makeStore().arm({ trigger: WORKSHOP, text: LADDER }, 'self');
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/only an operator/i);
    expect(fs.existsSync(makeStore().file)).toBe(false);
  });

  it('refuses an intent with nothing to fire on', () => {
    const result = makeStore().arm({ trigger: {}, text: LADDER }, 'operator');
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/place or a keyword/i);
  });

  it('refuses an empty text', () => {
    expect(makeStore().arm({ trigger: WORKSHOP, text: '  ' }, 'operator').ok).toBe(false);
  });

  it('applies the documented defaults', () => {
    const intent = armed(makeStore());
    expect(intent.cooldownMs).toBe(INTENT_DEFAULT_COOLDOWN_MS);
    expect(intent.firesLeft).toBe(INTENT_DEFAULT_FIRES);
    expect(intent.state).toBe('armed');
    expect(intent.scope).toBe('place');
    expect(Date.parse(intent.expiresAt) - NOW).toBe(30 * DAY);
  });

  it('caps how many intents one robot may hold', () => {
    const store = makeStore();
    for (let i = 0; i < INTENT_MAX; i++) {
      expect(store.arm({ trigger: { place: `P-${i}` }, text: 'x' }, 'operator').ok).toBe(true);
    }
    const overflow = store.arm({ trigger: { place: 'P-last' }, text: 'x' }, 'operator');
    expect(overflow.ok).toBe(false);
    expect(overflow.message).toMatch(/limit is 50/);
  });

  it('survives a restart', () => {
    armed(makeStore());
    const reopened = makeStore();
    expect(reopened.list()).toHaveLength(1);
    expect(reopened.list()[0].text).toBe(LADDER);
  });
});

describe('IntentStore.fireMatching', () => {
  it('fires once on arrival and then respects the cooldown', () => {
    const store = makeStore();
    armed(store);

    expect(store.fireMatching(situation())).toHaveLength(1);

    // Every tick for the next 24 h: still there, still nothing said.
    for (let i = 1; i <= 20; i++) {
      expect(store.fireMatching(situation({ nowMs: NOW + i * HOUR }))).toEqual([]);
    }

    expect(store.fireMatching(situation({ nowMs: NOW + 25 * HOUR }))).toHaveLength(1);
  });

  it('spends its fire budget and then stays quiet forever', () => {
    const store = makeStore();
    armed(store);

    for (let day = 0; day < INTENT_DEFAULT_FIRES; day++) {
      expect(store.fireMatching(situation({ nowMs: NOW + day * 2 * DAY }))).toHaveLength(1);
    }
    expect(store.fireMatching(situation({ nowMs: NOW + 99 * DAY }))).toEqual([]);
    expect(store.list()[0].state).toBe('spent');
  });

  it('expires rather than firing after its TTL', () => {
    const store = makeStore();
    armed(store);
    expect(store.fireMatching(situation({ nowMs: NOW + 31 * DAY }))).toEqual([]);
    expect(store.list()[0].state).toBe('expired');
    expect(store.list()[0].firesLeft).toBe(INTENT_DEFAULT_FIRES);
  });

  it('does not fire in the wrong place', () => {
    const store = makeStore();
    armed(store);
    expect(store.fireMatching(situation({ place: 'AISLE-3' }))).toEqual([]);
    expect(store.fireMatching(situation({ place: null }))).toEqual([]);
  });

  it('carries the operator text at operator trust', () => {
    const store = makeStore();
    armed(store);
    const [finding] = store.fireMatching(situation());
    expect(finding.id).toBe('intent_matched');
    expect(finding.trust).toBe('operator');
    expect(finding.message).toContain(LADDER);
  });

  it('a disarmed intent never fires again', () => {
    const store = makeStore();
    const intent = armed(store);
    expect(store.disarm(intent.id)).toBe(true);
    expect(store.fireMatching(situation())).toEqual([]);
    expect(store.disarm(intent.id)).toBe(false);
  });

  it('issues NO network call in the matching path', () => {
    // The matcher runs on every 3 s idle tick. A model (or any server round
    // trip) in here would be a per-tick cost, and would make "did this trigger
    // fire?" a question nobody could answer twice the same way.
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const store = makeStore();
    armed(store);
    for (let i = 0; i < 100; i++) store.fireMatching(situation({ nowMs: NOW + i * 3000 }));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fails closed on an unreadable intents file: nothing fires', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = makeStore();
    armed(store);
    fs.writeFileSync(store.file, '{ this is not json', 'utf-8');
    store.reload();

    expect(store.fireMatching(situation())).toEqual([]);
    warn.mockRestore();
  });
});

describe('parseIntentLine', () => {
  it('rejects a line missing anything it needs', () => {
    expect(parseIntentLine('')).toBeNull();
    expect(parseIntentLine('not json')).toBeNull();
    expect(parseIntentLine(JSON.stringify({ id: 'x', text: 'y' }))).toBeNull();
    // An unknown action is refused rather than coerced to `speak`.
    expect(
      parseIntentLine(
        JSON.stringify({
          id: 'x',
          text: 'y',
          action: 'walk',
          createdAt: 'a',
          expiresAt: 'b',
          firesLeft: 1,
          cooldownMs: 1,
          state: 'armed',
          trigger: {},
        }),
      ),
    ).toBeNull();
  });
});
