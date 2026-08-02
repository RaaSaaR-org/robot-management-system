/**
 * @file journal.test.ts
 * @description Daily rollover, read-last-N-days, retention-derived pruning and
 *              the legal-hold suppression (TASK-197).
 * @feature agentmode
 * @status test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  Journal,
  JOURNAL_EVENT_TYPE,
  JOURNAL_FALLBACK_RETENTION_DAYS,
  SERVICE_TOKEN_ENV,
  blockJournalRecord,
  fetchJournalRetention,
  getJournalBootId,
  parseJournalLine,
  setJournalBootId,
  startJournalRetentionLoop,
  type JournalRetention,
} from '../journal.js';
import { Workspace, type JournalRecord } from '../workspace.js';

let root: string;
let workspace: Workspace;
/** Mutable clock so a test can walk the robot across midnight. */
let clock: Date;

function record(over: Partial<JournalRecord> = {}): JournalRecord {
  return {
    t: clock.toISOString(),
    bootId: 'b-0001',
    kind: 'block',
    block: 'walk',
    ok: true,
    place: 'AISLE-3',
    trust: 'self',
    msg: 'Walked 0.98 m forward',
    ...over,
  };
}

function makeJournal(): Journal {
  return new Journal({ workspace, now: () => clock });
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'neodem-journal-'));
  workspace = new Workspace({ root });
  clock = new Date('2026-08-02T10:00:00.000Z');
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  setJournalBootId(null);
});

describe('Journal — append and rollover', () => {
  it('writes one JSONL line per record into the day file', () => {
    const journal = makeJournal();
    expect(journal.append(record())).toBe(true);
    expect(journal.append(record({ msg: 'Turned 90°', block: 'turn' }))).toBe(true);

    const raw = fs.readFileSync(path.join(workspace.journalDir, '2026-08-02.jsonl'), 'utf-8');
    expect(raw.trim().split('\n')).toHaveLength(2);
    expect(JSON.parse(raw.trim().split('\n')[0])).toMatchObject({
      kind: 'block',
      place: 'AISLE-3',
      trust: 'self',
      msg: 'Walked 0.98 m forward',
    });
  });

  it('rolls over at midnight — a new day is a new file, nothing is rewritten', () => {
    const journal = makeJournal();
    journal.append(record({ msg: 'before midnight' }));

    clock = new Date('2026-08-03T00:00:01.000Z');
    journal.append(record({ msg: 'after midnight' }));

    expect(journal.listDays()).toEqual(['2026-08-02', '2026-08-03']);
    expect(journal.readDay('2026-08-02').map((r) => r.msg)).toEqual(['before midnight']);
    expect(journal.readDay('2026-08-03').map((r) => r.msg)).toEqual(['after midnight']);
  });

  it('files a record under ITS OWN timestamp, not the wall clock', () => {
    const journal = makeJournal();
    // A block that finished just before midnight and is logged just after must
    // not land in the wrong day.
    journal.append(record({ t: '2026-08-01T23:59:59.000Z', msg: 'late block' }));
    expect(journal.readDay('2026-08-01').map((r) => r.msg)).toEqual(['late block']);
  });

  it('never throws when the journal cannot be written', () => {
    const journal = new Journal({
      workspace: new Workspace({ root: path.join(root, 'nested') }),
      now: () => clock,
    });
    const spy = vi.spyOn(fs, 'appendFileSync').mockImplementation(() => {
      throw new Error('disk full');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(journal.append(record())).toBe(false);
    spy.mockRestore();
    warn.mockRestore();
  });

  it('skips a line whose provenance cannot be read', () => {
    // Trust is never defaulted. An untagged line is not a record at all —
    // silently reading it as `self` is exactly the poisoning path the trust
    // tier exists to close.
    expect(parseJournalLine('{"t":"2026-08-02T10:00:00Z","msg":"hi"}')).toBeNull();
    expect(parseJournalLine('{"t":"x","msg":"hi","trust":"guessed"}')).toBeNull();
    expect(parseJournalLine('not json')).toBeNull();
    expect(parseJournalLine('')).toBeNull();
    expect(parseJournalLine('{"t":"x","msg":"hi","trust":"untrusted"}')).not.toBeNull();
  });
});

describe('Journal — reading recent days', () => {
  it('reads the last N calendar days, oldest record first', () => {
    const journal = makeJournal();
    for (const day of ['2026-07-25', '2026-07-31', '2026-08-01', '2026-08-02']) {
      journal.append(record({ t: `${day}T09:00:00.000Z`, msg: `on ${day}` }));
    }

    const week = journal.readLastDays(7).map((r) => r.msg);
    expect(week).toEqual(['on 2026-07-31', 'on 2026-08-01', 'on 2026-08-02']);
    // Counted by DATE, not by file: a robot switched off for a week returns
    // nothing rather than silently reaching a month back.
    expect(journal.readLastDays(1).map((r) => r.msg)).toEqual(['on 2026-08-02']);
  });
});

describe('Journal — pruning at the retention boundary', () => {
  const policy = (over: Partial<JournalRetention> = {}): JournalRetention => ({
    retentionDays: 30,
    source: 'policy',
    legalHold: false,
    legalHoldKnown: true,
    error: null,
    ...over,
  });

  function seedDays(days: string[]): Journal {
    const journal = makeJournal();
    for (const day of days) journal.append(record({ t: `${day}T09:00:00.000Z` }));
    return journal;
  }

  it('deletes day files older than the boundary and keeps the rest', () => {
    const journal = seedDays(['2026-06-01', '2026-07-02', '2026-07-20', '2026-08-02']);
    const result = journal.prune(policy({ retentionDays: 30 }));

    // Boundary is 2026-07-03: 30 days before 2026-08-02.
    expect(result.deleted).toEqual(['2026-06-01', '2026-07-02']);
    expect(result.kept).toEqual(['2026-07-20', '2026-08-02']);
    expect(journal.listDays()).toEqual(['2026-07-20', '2026-08-02']);
  });

  it('follows the platform policy rather than a hardcoded window', () => {
    const journal = seedDays(['2026-07-20', '2026-08-02']);
    // A 365-day `command_execution` policy keeps what a 30-day regime would
    // have deleted — the whole point of deriving the number.
    expect(journal.prune(policy({ retentionDays: 365 })).deleted).toEqual([]);
    expect(journal.prune(policy({ retentionDays: 1 })).deleted).toEqual(['2026-07-20']);
  });

  it('is suppressed entirely by an active legal hold', () => {
    const journal = seedDays(['2026-01-01', '2026-08-02']);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = journal.prune(policy({ retentionDays: 1, legalHold: true }));

    expect(result.suppressedByLegalHold).toBe(true);
    expect(result.deleted).toEqual([]);
    // Not merely "nothing was deleted": the ancient file is still there.
    expect(journal.listDays()).toEqual(['2026-01-01', '2026-08-02']);
    warn.mockRestore();
  });
});

describe('fetchJournalRetention', () => {
  /** Records every URL and every init the lookup issued. */
  function spyFetch(
    handler: (url: string) => Response,
  ): { impl: typeof fetch; calls: Array<{ url: string; init?: RequestInit }> } {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const impl = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, ...(init ? { init } : {}) });
      return handler(url);
    }) as unknown as typeof fetch;
    return { impl, calls };
  }

  const ok = (url: string): Response =>
    url.includes('/retention/')
      ? new Response(JSON.stringify({ retentionDays: 365 }), { status: 200 })
      : new Response(JSON.stringify({ holds: [] }), { status: 200 });

  it('derives the window from the command_execution retention policy', async () => {
    const { impl, calls } = spyFetch(ok);

    await expect(
      fetchJournalRetention({ serverUrl: 'http://server', fetchImpl: impl, authToken: '' }),
    ).resolves.toEqual({
      retentionDays: 365,
      source: 'policy',
      legalHold: false,
      legalHoldKnown: true,
      error: null,
    });
    expect(calls[0].url).toContain(JOURNAL_EVENT_TYPE);
  });

  it('reports an active legal hold', async () => {
    const { impl } = spyFetch((url) =>
      url.includes('/retention/')
        ? new Response(JSON.stringify({ retentionDays: 90 }), { status: 200 })
        : new Response(JSON.stringify({ holds: [{ id: 'hold-1' }] }), { status: 200 }),
    );

    await expect(
      fetchJournalRetention({ serverUrl: 'http://server', fetchImpl: impl, authToken: '' }),
    ).resolves.toMatchObject({ retentionDays: 90, legalHold: true, legalHoldKnown: true });
  });

  // THE query-param bug: `legal-hold.routes.ts` reads `req.query.activeOnly`.
  // Asking with `?active=true` returned ALL holds — released and expired ones
  // included — so a hold lifted months ago suppressed pruning forever.
  it('asks for ACTIVE holds only, in the spelling the route actually reads', async () => {
    const { impl, calls } = spyFetch((url) =>
      url.includes('/retention/')
        ? new Response(JSON.stringify({ retentionDays: 30 }), { status: 200 })
        : // The server, correctly handed `activeOnly=true`, answers with none.
          new Response(
            JSON.stringify({ holds: url.includes('activeOnly=true') ? [] : [{ id: 'released' }] }),
            { status: 200 },
          ),
    );

    const retention = await fetchJournalRetention({
      serverUrl: 'http://server',
      fetchImpl: impl,
      authToken: '',
    });

    const holdCall = calls.find((c) => c.url.includes('legal-holds'));
    expect(holdCall?.url).toContain('activeOnly=true');
    expect(retention.legalHold).toBe(false);
  });

  it('authenticates: both routes sit behind authMiddleware', async () => {
    const { impl, calls } = spyFetch(ok);

    await fetchJournalRetention({
      serverUrl: 'http://server',
      fetchImpl: impl,
      authToken: 'ndsa_secret',
    });

    // Every compliance read carries the service-account token. Without it, a
    // production server answers 401 and the retention window silently reverts
    // to this file's own 30-day number.
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect((call.init?.headers as Record<string, string>).Authorization).toBe(
        'Bearer ndsa_secret',
      );
    }
  });

  it('takes the token from the environment when none is passed', async () => {
    const { impl, calls } = spyFetch(ok);
    vi.stubEnv(SERVICE_TOKEN_ENV, 'ndsa_from_env');

    await fetchJournalRetention({ serverUrl: 'http://server', fetchImpl: impl });

    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe(
      'Bearer ndsa_from_env',
    );
    vi.unstubAllEnvs();
  });

  it('sends NO Authorization header when there is no token (AUTH_DISABLED dev server)', async () => {
    const { impl, calls } = spyFetch(ok);
    vi.stubEnv(SERVICE_TOKEN_ENV, '');

    await fetchJournalRetention({ serverUrl: 'http://server', fetchImpl: impl });

    expect(calls[0].init?.headers).toBeUndefined();
    vi.unstubAllEnvs();
  });

  it('makes a 401 VISIBLE instead of degrading quietly to the fallback', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { impl } = spyFetch(() => new Response('Unauthorized', { status: 401 }));

    const retention = await fetchJournalRetention({
      serverUrl: 'http://server',
      fetchImpl: impl,
      authToken: '',
    });

    expect(retention.source).toBe('fallback');
    expect(retention.retentionDays).toBe(JOURNAL_FALLBACK_RETENTION_DAYS);
    // The value itself carries the reason — a second hardcoded retention regime
    // running unnoticed beside the platform's own is the thing this must not be.
    expect(retention.error).toMatch(/401/);
    expect(retention.error).toContain(SERVICE_TOKEN_ENV);
    // …and "no hold" is not claimed when nobody answered the question.
    expect(retention.legalHold).toBe(false);
    expect(retention.legalHoldKnown).toBe(false);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('falls back — and SAYS it fell back — when the platform is unreachable', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;

    const retention = await fetchJournalRetention({
      serverUrl: 'http://server',
      fetchImpl,
      authToken: '',
    });

    // `source` is what lets a reader tell a policy the platform set from a
    // number this file invented.
    expect(retention).toEqual({
      retentionDays: JOURNAL_FALLBACK_RETENTION_DAYS,
      source: 'fallback',
      legalHold: false,
      legalHoldKnown: false,
      error: 'ECONNREFUSED',
    });
    error.mockRestore();
  });
});

describe('startJournalRetentionLoop', () => {
  it('re-prunes on a schedule — a robot that is up for months is the normal case', async () => {
    vi.useFakeTimers();
    const apply = vi.fn();
    const fetchRetention = vi.fn(async () => ({
      retentionDays: 30,
      source: 'policy' as const,
      legalHold: false,
      legalHoldKnown: true,
      error: null,
    }));

    const loop = startJournalRetentionLoop({ apply, fetchRetention, intervalMs: 60_000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(apply).toHaveBeenCalledTimes(1);

    // Ninety days at a customer site used to mean 60 day-files past the
    // boundary, in plaintext, on a device with no encryption.
    await vi.advanceTimersByTimeAsync(60_000 * 3);
    expect(apply).toHaveBeenCalledTimes(4);

    loop.stop();
    await vi.advanceTimersByTimeAsync(60_000 * 3);
    expect(apply).toHaveBeenCalledTimes(4);
    vi.useRealTimers();
  });

  it('does not hold the process open at shutdown', async () => {
    const apply = vi.fn();
    const loop = startJournalRetentionLoop({
      apply,
      fetchRetention: async () => ({
        retentionDays: 30,
        source: 'policy',
        legalHold: false,
        legalHoldKnown: true,
        error: null,
      }),
      intervalMs: 3_600_000,
    });

    // index.ts's shutdown ordering depends on nothing unexpected keeping the
    // event loop alive; a robot that will not exit is one somebody power-cycles.
    expect(loop.handle.hasRef()).toBe(false);
    loop.stop();
  });
});

describe('blockJournalRecord', () => {
  it('tags a VISION block as `untrusted` — a caption is not a measurement', () => {
    // `look` answers with the VLM's own sentence. Tagging that `self` would
    // launder a 7B model's guess into the one tier that may be promoted into
    // durable memory.
    const rec = blockJournalRecord({
      at: '2026-08-02T10:00:00.000Z',
      bootId: null,
      planId: null,
      blockKind: 'look',
      ok: true,
      message: 'Looked: a shelf that is safe to climb (entities: shelf)',
      place: 'AISLE-3',
    });

    expect(rec.trust).toBe('untrusted');
    // And so it can never reach durable memory — the whole chain in one place.
    const workspace2 = new Workspace({ root });
    expect(workspace2.promote(rec, 'place').ok).toBe(false);
    expect(workspace2.promote(rec, 'memory').ok).toBe(false);
  });

  it('tags the robot\'s own experience as `self` and carries the place', () => {
    setJournalBootId('b-abcd');
    expect(getJournalBootId()).toBe('b-abcd');

    const rec = blockJournalRecord({
      at: '2026-08-02T10:00:00.000Z',
      bootId: getJournalBootId(),
      planId: 'plan-1',
      blockKind: 'walk',
      ok: true,
      message: 'Walked 0.98 m forward',
      measured: { distanceM: 0.98 },
      place: 'AISLE-3',
      pose: { x: -4.2, y: 3.1, yawDeg: 91, source: 'odometry' },
    });

    expect(rec).toEqual({
      t: '2026-08-02T10:00:00.000Z',
      bootId: 'b-abcd',
      kind: 'block',
      planId: 'plan-1',
      block: 'walk',
      ok: true,
      measured: { distanceM: 0.98 },
      place: 'AISLE-3',
      pose: { x: -4.2, y: 3.1, yawDeg: 91, source: 'odometry' },
      trust: 'self',
      msg: 'Walked 0.98 m forward',
    });
  });
});
