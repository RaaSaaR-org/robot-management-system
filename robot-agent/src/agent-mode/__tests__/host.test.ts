/**
 * @file host.test.ts
 * @description Host mode (TASK-213): the stop plan a tour route becomes, the
 *              talk-track chunking that stands in for barge-in, the keyword
 *              matcher that answers "ja" without a model call, the fail-closed
 *              preconditions with their machine reasons, stop semantics under a
 *              scripted executor (a stop that cannot be reached is skipped and
 *              the tour goes on; an abort still says goodbye), the offer that
 *              lapses, a `demo` that only narrates, the grounded answerer's
 *              `declined` outcome, a tour left `running` by a restart, and the
 *              transcript retention sweep.
 * @feature agentmode
 * @status test
 */

import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  TourRouteSource,
  TourRunStore,
  TourRunner,
  buildTourBlocks,
  checkTourPreconditions,
  chunkTalkTrack,
  disclosureLine,
  estimateSpeechSeconds,
  estimateTourSeconds,
  matchVisitorReply,
  parseTourRoute,
  tourPhrase,
  type TourExecution,
  type TourPreconditionInput,
} from '../host.js';
import { BlockExecutor, type BlockExecutorDeps } from '../block-executor.js';
import { RangeSensor } from '../range.js';
import { SceneMemoryStore } from '../scene-memory.js';
import { Workspace } from '../workspace.js';
import { config } from '../../config/config.js';
import type { VisionClient } from '../vision.js';
import type { AgentBlock, BlockOutcome, TourRoute, TourRun } from '../types.js';

// ── fixtures ────────────────────────────────────────────────────────────────

const ROUTE: TourRoute = {
  id: 'zema-visit',
  name: 'ZeMA visitor tour',
  robotId: 'robot-1',
  twinId: null,
  language: 'de',
  greetingPlaceId: 'STAGING',
  greeting: 'Herzlich willkommen am ZeMA!',
  offer: 'Soll ich Ihnen alles zeigen? Das dauert etwa sechs Minuten.',
  farewell: 'Danke für Ihren Besuch!',
  siteCard: ['Das ZeMA ist ein Forschungsinstitut in Saarbrücken.'],
  stops: [
    {
      id: 'stop-1',
      placeId: 'AISLE-1',
      headline: 'Meine Arbeitsstation',
      talkTrack: 'Hier ist meine Arbeitsstation. Ich hebe einen Apfel auf einen Teller. Das Modell haben wir selbst trainiert.',
      facts: ['Das Modell ist ein VLA-Modell.', 'Ich bin ein Unitree G1.'],
      demo: { skillId: 'skill-apple', skillName: 'Apfel auf den Teller', modelVersionId: 'mv-1', expectSeconds: 30 },
      dwellS: 12,
      askToContinue: true,
    },
    {
      id: 'stop-2',
      placeId: 'DOCK-1',
      headline: 'Die Laderampe',
      talkTrack: 'Hier kommen die Teile an.',
      facts: [],
      demo: null,
      dwellS: 0,
      askToContinue: false,
    },
  ],
  enabled: true,
  autoGreet: true,
  createdAt: '2026-08-17T00:00:00.000Z',
  updatedAt: '2026-08-17T00:00:00.000Z',
};

function label(b: AgentBlock): string {
  if (b.kind === 'goto') return `goto:${String(b.params.place)}`;
  if (b.kind === 'present') return `present:${String(b.params.chunk)}/${String(b.params.of)}`;
  if (b.kind === 'demo') return `demo:${String(b.params.mode)}`;
  return b.kind;
}

/** A scripted executor: `outcome` decides each block. Records order and skips. */
function scriptedExec(
  outcome: (block: AgentBlock) => BlockOutcome | Promise<BlockOutcome>,
  aborted: () => boolean = () => false,
) {
  const ran: string[] = [];
  const skipped: string[] = [];
  const exec: TourExecution = {
    begin: () => {},
    execute: async (b) => {
      ran.push(label(b));
      return outcome(b);
    },
    finish: () => {},
    skip: (b, reason) => skipped.push(`${label(b)}: ${reason}`),
    isAborted: aborted,
    abortReason: () => (aborted() ? 'E-Stop' : null),
  };
  return { exec, ran, skipped };
}

/**
 * `sleep` is a no-op so the 30 s reply window costs no wall time, and `hooks`
 * is how a test speaks BACK during it: the reply loop's only yield point is
 * that sleep, so pushing a reply from inside it is the deterministic stand-in
 * for a visitor answering while the robot waits. A `setTimeout` cannot do the
 * job — the loop never returns to the macrotask queue.
 */
function rig(opts: Partial<ConstructorParameters<typeof TourRunner>[0]> = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'neodem-tour-'));
  const ws = new Workspace({ root, robotId: 'robot-1' });
  ws.ensure();
  const events: Array<{ type: string; run: TourRun }> = [];
  const said: string[] = [];
  const hooks: { onSleep: (() => void) | null } = { onSleep: null };
  const runner = new TourRunner({
    robotId: 'robot-1',
    workspace: ws,
    emit: (type, run) => events.push({ type, run }),
    say: async (t) => {
      said.push(t);
      return true;
    },
    sleep: async () => {
      hooks.onSleep?.();
    },
    log: () => {},
    ...opts,
  });
  return { root, ws, runner, events, said, hooks };
}

// ── the stop plan ───────────────────────────────────────────────────────────

describe('buildTourBlocks', () => {
  it('turns a route into tour → per stop goto/present×n/demo/wait → goto home + farewell', () => {
    const blocks = buildTourBlocks(ROUTE, { demoMode: 'narrate', disclosureSpoken: true });
    expect(blocks.map((b) => `${b.legIndex}:${label(b.block)}`)).toEqual([
      '-1:tour',
      '0:goto:AISLE-1',
      '0:present:1/2',
      '0:present:2/2',
      '0:demo:narrate',
      '0:wait',
      '1:goto:DOCK-1',
      '1:present:1/1',
      '-1:goto:STAGING',
      '-1:speak',
    ]);
    expect(blocks.at(-1)!.home).toBe(true);
    expect(blocks.at(-1)!.block.params.text).toBe('Danke für Ihren Besuch!');
  });

  it('names the stop on every block of it, not only its id', () => {
    // The Agent Mode rail watches the running BLOCK and holds no route, no run
    // and no place graph — so "which stop is the robot at?" is answerable only
    // if the block says so in words. Same reason patrol puts `checkpointName`
    // on `capture`. The walk home is the one goto that carries no stop, and
    // that is what tells the rail the visit is over.
    const blocks = buildTourBlocks(ROUTE, { demoMode: 'narrate', disclosureSpoken: true });
    const first = ROUTE.stops[0]!;
    for (const kind of ['goto', 'present', 'demo', 'wait']) {
      const block = blocks.find((b) => b.legIndex === 0 && b.block.kind === kind)!.block;
      expect(block.params).toMatchObject({ stopId: first.id, stopIndex: 1, stopName: first.headline });
    }
    expect(blocks.filter((b) => b.home && b.block.kind === 'goto')[0]!.block.params.stopName).toBeUndefined();
  });

  it('speaks the AI disclosure first when the greeting did not — whoever started the tour', () => {
    // An operator pressing "Start tour" has greeted nobody, and the visitor in
    // front of the robot is owed the sentence just the same (Art. 50).
    const blocks = buildTourBlocks(ROUTE, { disclosureSpoken: false });
    const first = blocks[1]!.block;
    expect(first.kind).toBe('speak');
    expect(String(first.params.text)).toContain('künstlicher Intelligenz');
    expect(first.params.disclosure).toBe(true);
    // ...and not twice, when the greeting already said it.
    const greeted = buildTourBlocks(ROUTE, { disclosureSpoken: true });
    expect(greeted.filter((b) => b.block.params.disclosure === true)).toHaveLength(0);
  });

  it('never plans a demo the operator did not author, and honours TOUR_DEMO_MODE=execute', () => {
    const blocks = buildTourBlocks(ROUTE, { demoMode: 'execute' });
    expect(blocks.filter((b) => b.block.kind === 'demo')).toHaveLength(1);
    expect(blocks.find((b) => b.block.kind === 'demo')!.block.params).toMatchObject({
      mode: 'execute',
      skillId: 'skill-apple',
      modelVersionId: 'mv-1',
    });
  });
});

// ── chunking: the closest thing this stack has to barge-in ──────────────────

describe('chunkTalkTrack', () => {
  it('chunks into at most two sentences and never splits one', () => {
    const chunks = chunkTalkTrack('Eins. Zwei! Drei? Vier.');
    expect(chunks).toEqual(['Eins. Zwei!', 'Drei? Vier.']);
  });

  it('drops the tail beyond the per-stop speech cap, and always keeps the first chunk', () => {
    const long = Array.from({ length: 20 }, (_, i) => `Das ist Satz Nummer ${i} und er ist absichtlich lang.`).join(' ');
    const chunks = chunkTalkTrack(long);
    const seconds = chunks.reduce((s, c) => s + estimateSpeechSeconds(c), 0);
    expect(seconds).toBeLessThanOrEqual(40 + estimateSpeechSeconds(chunks.at(-1) ?? ''));
    expect(chunks.length).toBeGreaterThan(0);
    // One sentence that is on its own longer than the whole cap still gets said.
    const huge = `${'x'.repeat(2000)}.`;
    expect(chunkTalkTrack(huge)).toHaveLength(1);
  });

  it('a 600-character talk track (the authored maximum) fits in a bounded number of chunks', () => {
    const track = Array.from({ length: 12 }, () => 'Dies ist ein Satz mit fünfzig Zeichen für den Test.').join(' ').slice(0, 600);
    const chunks = chunkTalkTrack(track);
    expect(chunks.length).toBeLessThanOrEqual(6);
    expect(chunks.join(' ').length).toBeLessThanOrEqual(track.length);
  });

  it('estimates a route duration from speech, dwell, demos and walking', () => {
    expect(estimateTourSeconds(ROUTE)).toBeGreaterThan(60);
  });
});

// ── yes / no / goodbye ──────────────────────────────────────────────────────

describe('matchVisitorReply', () => {
  it('matches both languages, whatever the case and punctuation', () => {
    for (const yes of ['Ja!', 'ja, gerne', 'YES', 'Yes please.', 'klar', 'ok']) {
      expect(matchVisitorReply(yes)).toBe('yes');
    }
    for (const no of ['Nein.', 'nein danke', 'No thanks', 'später']) {
      expect(matchVisitorReply(no)).toBe('no');
    }
    for (const bye of ['Tschüss!', 'danke tschüss', 'goodbye', 'Auf Wiedersehen']) {
      expect(matchVisitorReply(bye)).toBe('bye');
    }
  });

  it('goodbye wins over yes, so "ja, danke, tschüss" ends the tour', () => {
    expect(matchVisitorReply('ja danke tschüss')).toBe('bye');
  });

  it('is not a substring match: a sentence that merely starts with "no" is a question', () => {
    expect(matchVisitorReply('nein, was ich eigentlich fragen wollte ist wie schwer der Roboter ist')).toBeNull();
    expect(matchVisitorReply('No, what I actually wanted to ask is whether the arm is dangerous')).toBeNull();
    expect(matchVisitorReply('')).toBeNull();
    expect(matchVisitorReply('was kannst du?')).toBeNull();
  });
});

// ── the disclosure ──────────────────────────────────────────────────────────

describe('disclosureLine', () => {
  it('always states the AI, and the site can only add to it', () => {
    expect(disclosureLine('de')).toContain('künstlicher Intelligenz');
    expect(disclosureLine('en')).toContain('artificial intelligence');
    // No recording is part of the claim, in both languages.
    expect(disclosureLine('de')).toMatch(/weder Bild noch Ton/);
    expect(disclosureLine('en')).toMatch(/no video and no audio/);
    const extended = disclosureLine('en', 'Operated by ZeMA gGmbH.');
    expect(extended.startsWith(disclosureLine('en', ''))).toBe(true);
    expect(extended).toContain('ZeMA gGmbH');
  });
});

// ── preconditions ───────────────────────────────────────────────────────────

function preconditions(over: Partial<TourPreconditionInput> = {}): TourPreconditionInput {
  return {
    hostEnabled: true,
    agentModeEnabled: true,
    estopLatched: false,
    tourActive: false,
    planRunning: false,
    controlOwner: 'idle',
    teleopOrVlaActive: false,
    initiative: { estopLatched: false, crashAcknowledged: true, batteryPercent: 80, place: 'STAGING', placeAgeMs: 1000, damped: false },
    origin: 'visitor',
    route: ROUTE,
    knownPlaceIds: ['STAGING', 'AISLE-1', 'DOCK-1'],
    rangeAheadM: 3,
    personVisible: true,
    now: new Date('2026-08-17T10:00:00'),
    ...over,
  };
}

describe('checkTourPreconditions', () => {
  it('passes when everything is in order', () => {
    expect(checkTourPreconditions(preconditions())).toEqual({ ok: true });
  });

  it('refuses with its own reason for each thing that is wrong', () => {
    const cases: Array<[Partial<TourPreconditionInput>, string]> = [
      [{ hostEnabled: false }, 'disabled'],
      [{ agentModeEnabled: false }, 'disabled'],
      [{ tourActive: true }, 'running'],
      [{ estopLatched: true }, 'estop'],
      [{ planRunning: true }, 'busy'],
      [{ controlOwner: 'teleop' }, 'busy'],
      [{ teleopOrVlaActive: true }, 'busy'],
      [{ route: { ...ROUTE, stops: [] } }, 'no_stops'],
      [{ knownPlaceIds: [] }, 'no_places'],
      [{ knownPlaceIds: ['STAGING'] }, 'route_unknown'],
      [{ rangeAheadM: 0.6 }, 'person_too_close'],
      [{ initiative: { ...preconditions().initiative, batteryPercent: 8 } }, 'battery'],
      [{ initiative: { ...preconditions().initiative, damped: true } }, 'damped'],
      [{ initiative: { ...preconditions().initiative, crashAcknowledged: false } }, 'crash_unacknowledged'],
      [{ initiative: { ...preconditions().initiative, place: null, placeAgeMs: null } }, 'place_unknown'],
    ];
    for (const [over, reason] of cases) {
      const verdict = checkTourPreconditions(preconditions(over));
      expect(verdict.ok, `${reason} should refuse`).toBe(false);
      if (!verdict.ok) expect(verdict.reason).toBe(reason);
    }
  });

  it('does not mind somebody standing close when nobody is actually visible', () => {
    expect(checkTourPreconditions(preconditions({ rangeAheadM: 0.5, personVisible: false })).ok).toBe(true);
  });

  it('an operator start is not held to the initiative gate, but is still refused on a damped base', () => {
    const damped = { ...preconditions().initiative, damped: true, batteryPercent: 5 };
    const verdict = checkTourPreconditions(preconditions({ origin: 'operator', initiative: damped }));
    expect(verdict).toMatchObject({ ok: false, reason: 'damped' });
  });
});

// ── the route on the wire ───────────────────────────────────────────────────

describe('parseTourRoute', () => {
  it('caps every authored field and defaults the rest', () => {
    const route = parseTourRoute({
      id: ' r1 ',
      name: 'R',
      language: 'xx',
      stops: [{ placeId: ' HALL ', talkTrack: 'x'.repeat(900), facts: Array.from({ length: 30 }, (_, i) => `f${i}`), headline: 'h'.repeat(120) }],
    });
    expect(route.id).toBe('r1');
    expect(route.language).toBe('en');
    expect(route.stops[0]!.placeId).toBe('HALL');
    expect(route.stops[0]!.id).toBe('stop-1');
    expect(route.stops[0]!.headline).toHaveLength(60);
    expect(route.stops[0]!.talkTrack).toHaveLength(600);
    expect(route.stops[0]!.facts).toHaveLength(8);
    expect(route.stops[0]!.demo).toBeNull();
  });

  it('rejects what it cannot use', () => {
    expect(() => parseTourRoute(null)).toThrow(/not an object/);
    expect(() => parseTourRoute({ id: 'a' })).toThrow(/missing name/);
    expect(() => parseTourRoute({ id: 'a', name: 'b' })).toThrow(/stops must be an array/);
    expect(() => parseTourRoute({ id: 'a', name: 'b', stops: [{}] })).toThrow(/stop 0 has no placeId/);
  });
});

describe('TourRouteSource', () => {
  it('serves the cache when the server is unreachable, and nothing when there is no cache', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neodem-tourcache-'));
    const cachePath = path.join(dir, 'cache.json');
    const ok = new TourRouteSource({
      serverUrl: 'http://server',
      cachePath,
      fetchImpl: (async () => new Response(JSON.stringify(ROUTE), { status: 200 })) as unknown as typeof fetch,
    });
    expect((await ok.fetch('zema-visit')).origin).toBe('server');

    const down = new TourRouteSource({
      serverUrl: 'http://server',
      cachePath,
      fetchImpl: (async () => {
        throw new Error('ECONNREFUSED');
      }) as unknown as typeof fetch,
    });
    const cached = await down.fetch('zema-visit');
    expect(cached.origin).toBe('cache');
    expect(cached.route?.name).toBe('ZeMA visitor tour');
    expect((await down.fetch('nothing-here')).origin).toBe('none');
  });

  it('authenticates with the service token, and says so when it is missing', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neodem-tourauth-'));
    const seen: Array<Record<string, string> | undefined> = [];
    const src = new TourRouteSource({
      serverUrl: 'http://server',
      cachePath: path.join(dir, 'cache.json'),
      authToken: 'svc-token',
      fetchImpl: (async (_url: string, init: { headers?: Record<string, string> }) => {
        seen.push(init?.headers);
        return new Response(JSON.stringify(ROUTE), { status: 200 });
      }) as unknown as typeof fetch,
    });
    expect((await src.fetch('zema-visit')).origin).toBe('server');
    expect(seen[0]?.Authorization).toBe('Bearer svc-token');

    // Auto-greet is the one path where the robot fetches for itself, and a 401
    // there falls back to a disk cache that is empty on a fresh robot — so the
    // robot greets nobody, forever. The error must name the cause.
    const unauth = new TourRouteSource({
      serverUrl: 'http://server',
      cachePath: path.join(dir, 'empty.json'),
      authToken: '',
      fetchImpl: (async () => new Response('no', { status: 401 })) as unknown as typeof fetch,
    });
    const denied = await unauth.fetch('zema-visit');
    expect(denied.origin).toBe('none');
    expect(denied.error).toContain('NEODEM_SERVICE_TOKEN');
  });
});

// ── driving a tour ──────────────────────────────────────────────────────────

describe('TourRunner.drive', () => {
  it('walks every stop, says every chunk and ends done', async () => {
    const { runner, events, said, hooks } = rig();
    // The visitor says yes to "shall we go on?" after the first stop.
    hooks.onSleep = () => runner.pushReply('yes');
    runner.begin(ROUTE, 'visitor', { disclosureSpoken: true });
    const { exec, ran } = scriptedExec(() => ({ ok: true, message: 'ok' }));
    const run = await runner.drive('plan-1', exec);

    expect(run.status).toBe('done');
    expect(ran).toEqual([
      'goto:AISLE-1',
      'present:1/2',
      'present:2/2',
      'demo:narrate',
      'wait',
      'goto:DOCK-1',
      'present:1/1',
      'goto:STAGING',
      'speak',
    ]);
    expect(run.legs.map((l) => l.status)).toEqual(['done', 'done']);
    expect(run.legs[0]!.spoken).toEqual({ said: 2, of: 2 });
    expect(run.disclosureSpoken).toBe(true);
    expect(events.map((e) => e.type)).toEqual([
      'agent:tour:started',
      'agent:tour:leg',
      'agent:tour:leg',
      'agent:tour:finished',
    ]);
    expect(said).toContain(tourPhrase('goOn', 'de'));
    expect(said).toContain(tourPhrase('continueYes', 'de'));
  });

  it('a stop it cannot reach is skipped and the tour goes on', async () => {
    const { runner, hooks } = rig();
    hooks.onSleep = () => runner.pushReply('yes');
    runner.begin(ROUTE, 'operator');
    const { exec, skipped } = scriptedExec((b) =>
      b.kind === 'goto' && b.params.place === 'AISLE-1' ? { ok: false, message: 'blocked' } : { ok: true, message: 'ok' },
    );
    const run = await runner.drive('plan-1', exec);
    expect(run.legs[0]!.status).toBe('failed');
    expect(run.legs[1]!.status).toBe('done');
    expect(run.status).toBe('done');
    expect(run.reason).toMatch(/1 stop\(s\) were not shown/);
    expect(skipped.some((s) => s.startsWith('present:1/2'))).toBe(true);
  });

  it('an abort skips the remaining stops and the walk home, and still says goodbye', async () => {
    const { runner, events } = rig();
    runner.begin(ROUTE, 'visitor');
    let stop = false;
    const { exec, ran, skipped } = scriptedExec(() => {
      stop = true; // abort after the very first block
      return { ok: true, message: 'ok' };
    }, () => stop);
    const run = await runner.drive('plan-1', exec);

    expect(run.status).toBe('aborted');
    expect(run.reason).toBe('E-Stop');
    expect(run.legs[1]!.status).toBe('skipped');
    expect(skipped.some((s) => s.startsWith('goto:STAGING'))).toBe(true);
    expect(ran).toContain('speak');
    expect(events.at(-1)!.type).toBe('agent:tour:finished');
  });

  it('the visitor saying no to "shall we go on?" ends the tour without failing it', async () => {
    const { runner, hooks } = rig();
    hooks.onSleep = () => runner.pushReply('no');
    runner.begin(ROUTE, 'visitor');
    const { exec } = scriptedExec(() => ({ ok: true, message: 'ok' }));
    const run = await runner.drive('plan-1', exec);
    expect(run.status).toBe('done');
    expect(run.reason).toMatch(/ended the tour after 1 of 2/);
    expect(run.legs[1]!.status).toBe('skipped');
  });

  it('nobody answering "shall we go on?" ends the tour as abandoned, and it still goes home', async () => {
    const { runner, said } = rig();
    runner.begin(ROUTE, 'visitor');
    const { exec, ran } = scriptedExec(() => ({ ok: true, message: 'ok' }));
    const run = await runner.drive('plan-1', exec);
    expect(run.status).toBe('abandoned');
    expect(run.reason).toMatch(/nobody answered/);
    expect(said).toContain(tourPhrase('abandoned', 'de'));
    // The robot must not be left standing in an aisle: it walks back to where
    // the next visitor will find it.
    expect(ran).toContain('goto:STAGING');
  });

  it('a question asked during the talk track is answered at the next gap and recorded', async () => {
    const answer = vi.fn(async () => ({ answer: 'Das Modell ist ein VLA-Modell.', answered: 'grounded' as const }));
    const { runner, events, said } = rig({ answer });
    runner.begin(ROUTE, 'visitor');
    const { exec } = scriptedExec((b) => {
      if (b.kind === 'present' && b.params.chunk === 1) runner.enqueueQuestion('Was ist das für ein Modell?', 'de');
      return { ok: true, message: 'ok' };
    });
    const run = await runner.drive('plan-1', exec);

    expect(answer).toHaveBeenCalledTimes(1);
    expect(run.turns).toHaveLength(1);
    expect(run.turns[0]).toMatchObject({ stopId: 'stop-1', answered: 'grounded', language: 'de' });
    expect(said).toContain('Das Modell ist ein VLA-Modell.');
    expect(events.map((e) => e.type)).toContain('agent:tour:turn');
  });

  it('declines rather than inventing when the runner has no answerer at all', async () => {
    const { runner, said } = rig({ answer: undefined });
    runner.begin(ROUTE, 'visitor');
    const { exec } = scriptedExec((b) => {
      if (b.kind === 'present') runner.enqueueQuestion('Was hat der Roboter gekostet?', 'de');
      return { ok: true, message: 'ok' };
    });
    const run = await runner.drive('plan-1', exec);
    expect(run.turns[0]!.answered).toBe('declined');
    expect(said.some((s) => s.includes(tourPhrase('dontKnow', 'de')))).toBe(true);
  });

  it('takes at most three questions at a time', () => {
    const { runner } = rig();
    runner.begin(ROUTE, 'visitor');
    expect(runner.enqueueQuestion('a', 'de')).toBe(true);
    expect(runner.enqueueQuestion('b', 'de')).toBe(true);
    expect(runner.enqueueQuestion('c', 'de')).toBe(true);
    expect(runner.enqueueQuestion('d', 'de')).toBe(false);
  });

  it('an operator-started tour speaks the disclosure first, and records it only once it was played', async () => {
    const { runner } = rig();
    runner.begin(ROUTE, 'operator'); // nobody was greeted, so nothing was disclosed
    const spoken: string[] = [];
    const { exec } = scriptedExec((b) => {
      if (b.kind === 'speak') {
        spoken.push(String(b.params.text));
        // The executor stamps this when the voice service accepted the line.
        b.params.spoken = true;
      }
      return { ok: true, message: 'ok' };
    });
    const run = await runner.drive('plan-1', exec);
    expect(spoken[0]).toContain('künstlicher Intelligenz');
    expect(run.disclosureSpoken).toBe(true);
  });

  it('a disclosure the voice service never played is NOT recorded as spoken', async () => {
    const { runner } = rig();
    runner.begin(ROUTE, 'operator');
    const { exec } = scriptedExec(() => ({ ok: true, message: 'said (text-only, voice service unreachable)' }));
    const run = await runner.drive('plan-1', exec);
    // The block ran; nothing reached a speaker. The Art. 50 record follows the
    // ears, and "we meant to tell them" is not a disclosure.
    expect(run.disclosureSpoken).toBe(false);
  });

  it('a goodbye ends the visit politely: the robot still walks home and says farewell', async () => {
    const { runner } = rig();
    runner.begin(ROUTE, 'visitor', { disclosureSpoken: true });
    const spoken: string[] = [];
    const { exec, ran } = scriptedExec((b) => {
      // The visitor says goodbye while the robot is talking at the first stop.
      if (b.kind === 'present' && b.params.chunk === 1) runner.endByVisitor('the visitor said goodbye');
      if (b.kind === 'speak') spoken.push(String(b.params.text));
      return { ok: true, message: 'ok' };
    });
    const run = await runner.drive('plan-1', exec);

    // NOT `aborted`: an abort is the E-Stop shape and skips the walk home.
    expect(run.status).toBe('done');
    expect(run.reason).toBe('the visitor said goodbye');
    expect(run.legs[1]!.status).toBe('skipped');
    expect(ran).toContain('goto:STAGING');
    expect(spoken).toContain('Danke für Ihren Besuch!');
  });

  it('records what each demo actually did, and never calls a narrated one done', async () => {
    const { runner, hooks } = rig();
    hooks.onSleep = () => runner.pushReply('yes');
    runner.begin(ROUTE, 'visitor', { disclosureSpoken: true });
    const { exec } = scriptedExec((b) => {
      if (b.kind === 'demo') {
        b.startedAt = '2026-08-17T10:00:00.000Z';
        b.finishedAt = '2026-08-17T10:00:12.000Z';
        return { ok: true, message: 'Described "Apfel auf den Teller" — not executed.' };
      }
      return { ok: true, message: 'ok' };
    });
    const run = await runner.drive('plan-1', exec);

    expect(run.legs[0]!.demo).toMatchObject({
      mode: 'narrate',
      status: 'narrated',
      skillId: 'skill-apple',
      skillName: 'Apfel auf den Teller',
      durationMs: 12_000,
      model: 'mv-1',
    });
    expect(run.legs[0]!.demo!.message).toMatch(/not executed/);
    // The stop with no demo authored records none at all.
    expect(run.legs[1]!.demo).toBeNull();
  });

  it('TOUR_TRANSCRIPT_ENABLED=false keeps the count and the outcome, and drops the words', async () => {
    const previous = config.agentMode.tour.transcriptEnabled;
    config.agentMode.tour.transcriptEnabled = false;
    try {
      const { runner, hooks, events } = rig({
        answer: async () => ({ answer: 'Ein VLA-Modell.', answered: 'grounded' as const }),
      });
      hooks.onSleep = () => runner.pushReply('yes');
      runner.begin(ROUTE, 'visitor', { disclosureSpoken: true });
      let asked = false;
      const { exec } = scriptedExec((b) => {
        if (!asked && b.kind === 'present') {
          asked = true;
          runner.enqueueQuestion('Was für ein Modell ist das?', 'de');
        }
        return { ok: true, message: 'ok' };
      });
      const run = await runner.drive('plan-1', exec);

      // The turn is still there — an operator has to be able to see that a
      // question was asked and how it went — but the words are gone.
      expect(run.turns).toHaveLength(1);
      expect(run.turns[0]).toMatchObject({ question: '', answer: '', answered: 'grounded' });
      // And nothing carried them off the robot either.
      const turnEvent = events.find((e) => e.type === 'agent:tour:turn')!;
      expect(JSON.stringify(turnEvent.run)).not.toContain('Modell ist das');
    } finally {
      config.agentMode.tour.transcriptEnabled = previous;
    }
  });

});

// ── the offer ───────────────────────────────────────────────────────────────


describe('the offer', () => {
  it('lapses after the reply window, is recorded as abandoned, and stops answering', () => {
    let now = 1_000_000;
    const { runner, events } = rig({ now: () => now });
    runner.armOffer(ROUTE, { disclosureSpoken: true, windowMs: 30_000 });
    expect(runner.pending()).toMatchObject({ kind: 'offer' });

    now += 31_000;
    // A late "ja" must not start a tour: the offer is gone before it is read.
    expect(runner.pending()).toBeNull();
    const run = runner.expireOffer();
    expect(run).toMatchObject({ status: 'abandoned', disclosureSpoken: true });
    expect(run!.reason).toMatch(/not answered/);
    expect(events.at(-1)!.type).toBe('agent:tour:finished');
    // Only once — the slot is cleared, so a second sweep has nothing to record.
    expect(runner.expireOffer()).toBeNull();
  });

  it('a declined offer is recorded as declined, not as a failure', () => {
    const { runner } = rig();
    const run = runner.decline(ROUTE, 'the visitor declined the tour', true);
    expect(run).toMatchObject({ status: 'declined', origin: 'visitor', disclosureSpoken: true });
    expect(run.legs.every((l) => l.status === 'skipped')).toBe(true);
  });

  it('a refusal is recorded as a skipped run so the server can see it', () => {
    const { runner, events } = rig();
    const result = runner.refuse(ROUTE, 'visitor', 'battery', 'battery too low');
    expect(result).toMatchObject({ accepted: false, reason: 'battery' });
    expect(events.at(-1)!.run.status).toBe('skipped');
    expect(events.at(-1)!.run.reason).toMatch(/^battery: /);
  });
});

// ── persistence ─────────────────────────────────────────────────────────────

describe('TourRunStore', () => {
  it('closes runs a restart left running, and never touches finished ones', async () => {
    const { runner, ws, hooks } = rig();
    hooks.onSleep = () => runner.pushReply('yes');
    runner.begin(ROUTE, 'visitor');
    const { exec } = scriptedExec(() => ({ ok: true, message: 'ok' }));
    const done = await runner.drive('plan-1', exec);

    const store = new TourRunStore({ workspace: ws });
    // Forge an interrupted run next to the finished one.
    store.saveRun({ ...done, runId: 'run-interrupted', status: 'running', finishedAt: null, legs: done.legs.map((l) => ({ ...l, status: 'running' })) });

    const closed = store.closeInterrupted();
    expect(closed.map((r) => r.runId)).toEqual(['run-interrupted']);
    expect(closed[0]!.status).toBe('failed');
    expect(closed[0]!.reason).toMatch(/restarted/);
    expect(closed[0]!.legs.every((l) => l.status === 'skipped')).toBe(true);
    expect(store.findRun(done.runId)!.status).toBe('done');
  });

  it('the sweep clears the transcript of an old run and keeps the run itself', async () => {
    const { runner, ws, hooks } = rig({ answer: async () => ({ answer: 'ja', answered: 'grounded' as const }) });
    hooks.onSleep = () => runner.pushReply('yes');
    runner.begin(ROUTE, 'visitor');
    let asked = false;
    const { exec } = scriptedExec((b) => {
      if (!asked && b.kind === 'present') {
        asked = true;
        runner.enqueueQuestion('Frage?', 'de');
      }
      return { ok: true, message: 'ok' };
    });
    const run = await runner.drive('plan-1', exec);
    expect(run.turns).toHaveLength(1);

    // 31 days later, with a 30-day retention.
    const store = new TourRunStore({ workspace: ws, now: () => Date.parse(run.startedAt) + 31 * 24 * 60 * 60_000 });
    expect(store.sweep(30)).toEqual([run.runId]);
    const swept = store.findRun(run.runId)!;
    expect(swept.turns).toEqual([]);
    expect(swept.status).toBe('done');
    expect(swept.legs).toHaveLength(2);
  });
});

// ── the two new block handlers ──────────────────────────────────────────────

describe('BlockExecutor: present and demo', () => {
  function executor(opts: { runSkill?: BlockExecutorDeps['runSkill']; say?: (t: string) => void } = {}) {
    const said: string[] = [];
    const exec = new BlockExecutor({
      scene: new SceneMemoryStore('robot-1'),
      vision: { observe: async () => ({ currentView: '', entities: [], personVisible: false, raw: '{}', degraded: false }) } as unknown as VisionClient,
      range: new RangeSensor({ enabled: false }),
      isAborted: () => false,
      memory: null,
      say: async (t) => {
        said.push(t);
        opts.say?.(t);
        return true;
      },
      language: () => 'de',
      sleep: async () => {},
      ...(opts.runSkill ? { runSkill: opts.runSkill } : {}),
    });
    return { exec, said };
  }

  function block(kind: 'present' | 'demo', params: Record<string, unknown>): AgentBlock {
    return { id: `b-${kind}`, kind, params, status: 'pending' };
  }

  it('present says one chunk, reports which one it was, and records that it reached a speaker', async () => {
    const { exec, said } = executor();
    const b = block('present', { stopId: 's', text: 'Hallo.', chunk: 2, of: 3 });
    const outcome = await exec.execute(b);
    expect(outcome.ok).toBe(true);
    expect(outcome.message).toBe('Said part 2 of 3: "Hallo."');
    expect(said).toEqual(['Hallo.']);
    // Structured, not parsed back out of the English: the disclosure record
    // depends on this flag.
    expect(b.params.spoken).toBe(true);
  });

  it('a narrated demo says it is only describing the skill, and never runs it', async () => {
    const runSkill = vi.fn();
    const { exec, said } = executor({ runSkill: runSkill as unknown as BlockExecutorDeps['runSkill'] });
    const outcome = await exec.execute(block('demo', { skillId: 'skill-apple', skillName: 'Apfel', mode: 'narrate' }));

    expect(runSkill).not.toHaveBeenCalled();
    expect(outcome.ok).toBe(true);
    // The timeline must not read as though a grasp happened.
    expect(outcome.message).toBe('Described "Apfel" — not executed.');
    expect(said[0]).toMatch(/beschreibe ich es nur/);
  });

  it('an executed demo runs the skill and reports what it did', async () => {
    const runSkill = vi.fn(async () => ({ ok: true, steps: 42, durationMs: 8000, message: 'Ran "Apfel": 42 step(s) in 8.0 s.' }));
    const { exec } = executor({ runSkill });
    const outcome = await exec.execute(block('demo', { skillId: 'skill-apple', skillName: 'Apfel', mode: 'execute', expectSeconds: 30 }));
    expect(runSkill).toHaveBeenCalledWith({ skillId: 'skill-apple', skillName: 'Apfel', timeoutMs: 60_000 });
    expect(outcome).toMatchObject({ ok: true, message: 'Ran "Apfel": 42 step(s) in 8.0 s.' });
  });

  it('an agent that cannot run skills says so out loud rather than pretending', async () => {
    const { exec, said } = executor();
    const outcome = await exec.execute(block('demo', { skillId: 'skill-apple', skillName: 'Apfel', mode: 'execute' }));
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toMatch(/cannot run skills/);
    expect(said[0]).toMatch(/beschreibe ich es nur/);
  });
});
