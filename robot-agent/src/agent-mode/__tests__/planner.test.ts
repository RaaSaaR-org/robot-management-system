/**
 * @file planner.test.ts
 * @description Planner schema handling: a valid answer parses into normalized
 *              blocks, a malformed answer is retried exactly once, and a second
 *              failure degrades to the honest `speak` fallback.
 * @feature agentmode
 * @status test
 */

import { describe, it, expect, vi } from 'vitest';
import {
  Planner,
  coerceParams,
  enforceTurnDirection,
  mergeAdjacentWaveIntoGreet,
  mergeSplitReasoningBlocks,
  plannerFallback,
} from '../planner.js';
import type { PlannedBlock } from '../planner.js';
import type { GenerateRequest, GenerateResponse } from '../llm.js';

const MODEL_REF = 'test-ollama/gemma3:4b';

function makePlanner(responses: Array<Partial<GenerateResponse>>) {
  const calls: GenerateRequest[] = [];
  const generate = vi.fn(async (req: GenerateRequest): Promise<GenerateResponse> => {
    calls.push(req);
    const next = responses[Math.min(calls.length - 1, responses.length - 1)];
    return { text: next.text ?? '', output: next.output ?? null };
  });
  return { planner: new Planner({ generate, modelRef: MODEL_REF }), generate, calls };
}

function promptText(req: GenerateRequest): string {
  return req.prompt.map((p) => ('text' in p ? p.text : '[media]')).join('\n');
}

describe('Planner — valid output', () => {
  it('parses a valid block list and normalizes params', async () => {
    const { planner, generate } = makePlanner([
      {
        text: JSON.stringify({
          blocks: [
            { kind: 'scan_room', reasoning: 'Look at the room first.' },
            { kind: 'goto', entity: 'table', reasoning: 'Walk to the table.' },
            { kind: 'speak', text: 'I am here.' },
          ],
        }),
      },
    ]);

    const result = await planner.plan({ command: 'geh zum Tisch', sceneSummary: 'empty' });

    expect(generate).toHaveBeenCalledTimes(1);
    expect(result.fallback).toBe(false);
    expect(result.attempts).toBe(1);
    expect(result.blocks).toEqual([
      { kind: 'scan_room', params: { steps: 8 }, reasoning: 'Look at the room first.' },
      { kind: 'goto', params: { entity: 'table' }, reasoning: 'Walk to the table.' },
      { kind: 'speak', params: { text: 'I am here.' } },
    ]);
  });

  it('accepts a fenced / prose-wrapped answer by extracting the JSON object', async () => {
    const { planner } = makePlanner([
      {
        text:
          'Sure! Here is the plan:\n```json\n' +
          JSON.stringify({ blocks: [{ kind: 'turn', angleDeg: -90 }] }) +
          '\n```\nHope that helps.',
      },
    ]);

    const result = await planner.plan({ command: 'dreh dich nach rechts', sceneSummary: 'empty' });

    expect(result.fallback).toBe(false);
    expect(result.blocks).toEqual([{ kind: 'turn', params: { angleDeg: -90 } }]);
  });

  it("prefers Genkit's structured output over the raw text when present", async () => {
    const { planner } = makePlanner([
      { text: 'garbage that would never parse', output: { blocks: [{ kind: 'look' }] } },
    ]);

    const result = await planner.plan({ command: 'schau mal', sceneSummary: 'empty' });

    expect(result.fallback).toBe(false);
    expect(result.blocks).toEqual([{ kind: 'look', params: {} }]);
  });

  it('clamps out-of-range parameters instead of failing the plan', async () => {
    const { planner } = makePlanner([
      {
        text: JSON.stringify({
          blocks: [
            { kind: 'walk', distanceM: 99, direction: 'left' },
            { kind: 'turn', angleDeg: 400 },
            { kind: 'wait', seconds: 900 },
            { kind: 'scan_room', steps: 40 },
          ],
        }),
      },
    ]);

    const result = await planner.plan({ command: 'lauf ganz weit', sceneSummary: 'empty' });

    expect(result.blocks.map((b) => b.params)).toEqual([
      { distanceM: 10, direction: 'left' },
      { angleDeg: 180 },
      { seconds: 30 },
      { steps: 12 },
    ]);
  });
});

describe('Planner — malformed output', () => {
  it('retries exactly once and succeeds on the repair attempt', async () => {
    const { planner, generate, calls } = makePlanner([
      { text: 'I am terribly sorry, I cannot do JSON today.' },
      { text: JSON.stringify({ blocks: [{ kind: 'wave', turn: true }] }) },
    ]);

    const result = await planner.plan({ command: 'winke mal', sceneSummary: 'empty' });

    expect(generate).toHaveBeenCalledTimes(2);
    expect(result.attempts).toBe(2);
    expect(result.fallback).toBe(false);
    expect(result.blocks).toEqual([{ kind: 'wave', params: { turn: true } }]);
    // The second prompt must tell the model what was wrong with the first.
    expect(promptText(calls[0])).not.toMatch(/previous answer was rejected/i);
    expect(promptText(calls[1])).toMatch(/previous answer was rejected/i);
  });

  it('falls back to a single honest speak block after two failures', async () => {
    const { planner, generate } = makePlanner([{ text: 'still not json' }]);

    const result = await planner.plan({ command: 'tu was Unmoegliches', sceneSummary: 'empty' });

    expect(generate).toHaveBeenCalledTimes(2);
    expect(result.attempts).toBe(2);
    expect(result.fallback).toBe(true);
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].kind).toBe('speak');
    expect(String(result.blocks[0].params.text)).toContain('tu was Unmoegliches');
    expect(String(result.blocks[0].params.text)).toMatch(/could not build a plan/);
    // Nothing that could move the robot is ever in the fallback.
    expect(result.blocks.every((b) => b.kind === 'speak')).toBe(true);
  });

  it('treats a missing required parameter as a schema failure', async () => {
    const { planner, generate } = makePlanner([
      { text: JSON.stringify({ blocks: [{ kind: 'walk', direction: 'forward' }] }) },
    ]);

    const result = await planner.plan({ command: 'lauf', sceneSummary: 'empty' });

    expect(generate).toHaveBeenCalledTimes(2);
    expect(result.fallback).toBe(true);
    expect(result.error).toMatch(/distanceM/);
  });

  it('falls back when the model call itself throws', async () => {
    const generate = vi.fn().mockRejectedValue(new Error('ECONNREFUSED 127.0.0.1:11434'));
    const planner = new Planner({ generate, modelRef: MODEL_REF });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await planner.plan({ command: 'lauf los', sceneSummary: 'empty' });

    expect(generate).toHaveBeenCalledTimes(2);
    expect(result.fallback).toBe(true);
    expect(result.blocks[0].kind).toBe('speak');
    expect(result.error).toMatch(/ECONNREFUSED/);
    // There is no rejected candidate when the call never returned — the
    // diagnostic must say that, not blow up trying to stringify `undefined`.
    expect(warn.mock.calls.flat().join('\n')).toContain('no answer — the model call failed');
    warn.mockRestore();
  });
});

// ===========================================================================
// THE DEADLINE (TASK-202)
// ===========================================================================
//
// Without one, "the local model is thinking" and "the local model is never
// going to answer" are the same screen forever. Real timings, so these tests
// also prove the deadline is honoured in wall-clock terms rather than only in
// a fake-timer world where an unresolved promise cannot be distinguished from
// a slow one.

const FAST_TIMEOUT_MS = 60;

/** A valid one-block answer, for the "slow but working" cases. */
const VALID_ANSWER = JSON.stringify({
  blocks: [{ kind: 'speak', text: 'ok', reasoning: 'Answer the operator.' }],
});

describe('Planner — the deadline', () => {
  it('gives up on a call that never answers, within the deadline', async () => {
    const generate = vi.fn(() => new Promise<GenerateResponse>(() => {}));
    const planner = new Planner({ generate, modelRef: MODEL_REF, timeoutMs: FAST_TIMEOUT_MS });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const started = Date.now();
    const result = await planner.plan({ command: 'geh zum Tisch', sceneSummary: 'empty' });
    const elapsed = Date.now() - started;

    expect(result.fallback).toBe(true);
    expect(result.timedOut).toBe(true);
    // A timeout is not retried: the repair attempt exists for a model that
    // answered badly, and one that answered nothing has not earned a second
    // deadline. (This does NOT pin the shared round budget — only one call is
    // made here, so a per-call deadline would look identical. The budget is
    // pinned below, where attempt 1 actually spends some of it.)
    expect(generate).toHaveBeenCalledTimes(1);
    expect(elapsed).toBeLessThan(FAST_TIMEOUT_MS * 2);
    warn.mockRestore();
  });

  it('gives the repair attempt only what attempt 1 left of the budget', async () => {
    // THE shared-budget test. Attempt 1 answers unparseable JSON after most of
    // the deadline, which is the only shape that tells the two designs apart:
    // with one budget for the round the repair attempt inherits the remainder
    // and the whole plan lands near the deadline; with a per-call deadline it
    // would get a fresh full one and land near 2x.
    let n = 0;
    const generate = vi.fn(() => {
      n++;
      if (n === 1) {
        return new Promise<GenerateResponse>((resolve) =>
          setTimeout(() => resolve({ text: 'not json', output: null }), 140)
        );
      }
      return new Promise<GenerateResponse>(() => {});
    });
    const planner = new Planner({ generate, modelRef: MODEL_REF, timeoutMs: 200 });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const started = Date.now();
    const result = await planner.plan({ command: 'geh zum Tisch', sceneSummary: 'empty' });
    const elapsed = Date.now() - started;

    expect(generate).toHaveBeenCalledTimes(2);
    expect(result.timedOut).toBe(true);
    // Measured ~203 ms as written; ~343 ms if the call site stops subtracting
    // what attempt 1 already spent.
    expect(elapsed).toBeLessThan(320);
    warn.mockRestore();
  });

  it('says what did not happen, to which model, and what to check', async () => {
    const generate = vi.fn(() => new Promise<GenerateResponse>(() => {}));
    const planner = new Planner({ generate, modelRef: MODEL_REF, timeoutMs: FAST_TIMEOUT_MS });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await planner.plan({ command: 'geh zum Tisch', sceneSummary: 'empty' });

    // A generic failure would be indistinguishable from a bad answer. The
    // model name is the actionable part: the planner is a local model on this
    // box and the operator can go look at it.
    expect(result.error).toContain(MODEL_REF);
    expect(result.error).toMatch(/did not answer/i);
    expect(result.error).toContain('ollama ps');
    // ...and the robot says so out loud rather than only logging it.
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].kind).toBe('speak');
    expect(String(result.blocks[0].params.text)).toContain('did not answer');
    warn.mockRestore();
  });

  it('aborts the call instead of abandoning it', async () => {
    // The task asks for this explicitly: a Promise.race alone leaves the
    // request in flight, holding a socket on a model that is already wedged.
    let signal: AbortSignal | undefined;
    let aborted = false;
    const generate = vi.fn((req: GenerateRequest) => {
      signal = req.signal;
      req.signal?.addEventListener('abort', () => {
        aborted = true;
      });
      return new Promise<GenerateResponse>(() => {});
    });
    const planner = new Planner({ generate, modelRef: MODEL_REF, timeoutMs: FAST_TIMEOUT_MS });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await planner.plan({ command: 'geh zum Tisch', sceneSummary: 'empty' });

    expect(signal).toBeDefined();
    expect(aborted).toBe(true);
    warn.mockRestore();
  });

  it('still accepts an answer that arrives just inside the deadline', async () => {
    // The fix cannot be "fail everything slow": a 3.5 minute plan on the
    // smallest supported model was legitimate, and this is that case in
    // miniature.
    const generate = vi.fn(
      () =>
        new Promise<GenerateResponse>((resolve) =>
          setTimeout(() => resolve({ text: VALID_ANSWER, output: null }), FAST_TIMEOUT_MS / 3)
        )
    );
    const planner = new Planner({ generate, modelRef: MODEL_REF, timeoutMs: FAST_TIMEOUT_MS });

    const result = await planner.plan({ command: 'sag hallo', sceneSummary: 'empty' });

    expect(result.fallback).toBe(false);
    expect(result.timedOut).toBeUndefined();
    expect(result.blocks[0].kind).toBe('speak');
  });

  it('leaves the repair attempt alone when there is budget for it', async () => {
    // A malformed FIRST answer must still buy its one retry — the deadline is
    // about a model that does not answer, not about a model that answers badly.
    const responses = ['not json at all', VALID_ANSWER];
    const generate = vi.fn(async (): Promise<GenerateResponse> => {
      const text = responses[Math.min(generate.mock.calls.length - 1, responses.length - 1)];
      return { text, output: null };
    });
    const planner = new Planner({ generate, modelRef: MODEL_REF, timeoutMs: FAST_TIMEOUT_MS });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await planner.plan({ command: 'sag hallo', sceneSummary: 'empty' });

    expect(generate).toHaveBeenCalledTimes(2);
    expect(result.fallback).toBe(false);
    expect(result.timedOut).toBeUndefined();
    warn.mockRestore();
  });

  it('does not open a call it has already run out of time for', async () => {
    const generate = vi.fn(async (): Promise<GenerateResponse> => ({ text: '', output: null }));
    const planner = new Planner({ generate, modelRef: MODEL_REF, timeoutMs: 0 });

    const result = await planner.plan({ command: 'geh zum Tisch', sceneSummary: 'empty' });

    expect(generate).not.toHaveBeenCalled();
    expect(result.attempts).toBe(0);
    expect(result.timedOut).toBe(true);
    expect(result.fallback).toBe(true);
  });

  it('tells a German speaker something a German speaker can act on', async () => {
    // The English fallback quotes the technical reason; the German one never
    // has, and a timeout is no reason to start reading `ollama ps` aloud in
    // German. It still must not say "phrase it differently" — the phrasing was
    // never the problem.
    const generate = vi.fn(() => new Promise<GenerateResponse>(() => {}));
    const planner = new Planner({ generate, modelRef: MODEL_REF, timeoutMs: FAST_TIMEOUT_MS });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await planner.plan({
      command: 'geh zum Tisch',
      sceneSummary: 'empty',
      language: 'de',
    });

    const spoken = String(result.blocks[0].params.text);
    expect(spoken).toContain('nicht rechtzeitig geantwortet');
    expect(spoken).not.toContain('anders');
    warn.mockRestore();
  });
});

describe('Planner — prompt contents', () => {
  it('tells the model that a room of the place graph is a `goto` with "place" (TASK-209)', async () => {
    const { planner, calls } = makePlanner([{ text: JSON.stringify({ blocks: [{ kind: 'goto', place: 'Kitchen' }] }) }]);
    const result = await planner.plan({
      command: 'walk into the kitchen',
      sceneSummary: 'Places on the map (use `goto` with "place" to walk into one): Hallway (here), Kitchen.',
    });
    expect(result.blocks).toEqual([{ kind: 'goto', params: { place: 'Kitchen' } }]);
    const prompt = promptText(calls[0]!);
    expect(prompt).toContain('or {"place": "<a place from the "Places on the map" line');
    expect(prompt).toMatch(/A room or area listed under "Places on the map" is reached with `goto`/);
    // And a question about memory is a `speak`, never a `remember` (measured regression).
    expect(prompt).toMatch(/A QUESTION about what you remember or know .* is answered with ONE `speak` block/s);
  });

  it('passes the scene summary and, when re-planning, the remaining blocks', async () => {
    const { planner, calls } = makePlanner([
      { text: JSON.stringify({ blocks: [{ kind: 'look' }] }) },
    ]);

    await planner.plan({
      command: 'halt an und schau',
      sceneSummary: 'Known entities:\n- table: bearing 30°',
      remainingPlan: [
        { id: 'b1', kind: 'walk', params: { distanceM: 2, direction: 'forward' }, status: 'pending' },
      ],
    });

    const text = promptText(calls[0]);
    expect(text).toContain('table: bearing 30°');
    expect(text).toContain('A plan is already running');
    expect(text).toContain('"distanceM":2');
    expect(text).toContain('halt an und schau');
  });

  it('shows the remaining blocks in the flat shape the schema demands', async () => {
    const { planner, calls } = makePlanner([
      { text: JSON.stringify({ blocks: [{ kind: 'look' }] }) },
    ]);

    await planner.plan({
      command: 'stop and look',
      sceneSummary: 'Known entities: none',
      remainingPlan: [
        { id: 'b1', kind: 'walk', params: { distanceM: 2, direction: 'forward' }, status: 'pending' },
      ],
    });

    const text = promptText(calls[0]);
    // The prompt tells the model to put params as flat siblings of `kind`. The
    // running plan is the only example of a block it ever sees, so rendering it
    // nested would teach the opposite of the rule two dozen lines above.
    expect(text).toContain('{"kind":"walk","distanceM":2,"direction":"forward"}');
    expect(text).not.toContain('"params":');
  });
});

describe('mergeAdjacentWaveIntoGreet', () => {
  const b = (kind: PlannedBlock['kind'], params: Record<string, unknown> = {}): PlannedBlock => ({
    kind,
    params,
  });

  it('drops a wave right before a greet — the greet waves anyway', () => {
    const { blocks, merged } = mergeAdjacentWaveIntoGreet([
      b('walk', { distanceM: 1, direction: 'forward' }),
      b('wave', { turn: false }),
      b('greet', { text: 'hello' }),
    ]);
    expect(merged).toBe(1);
    expect(blocks.map((x) => x.kind)).toEqual(['walk', 'greet']);
  });

  it('drops a wave right after a greet too', () => {
    const { blocks, merged } = mergeAdjacentWaveIntoGreet([
      b('greet', { text: 'hello' }),
      b('wave', { turn: false }),
    ]);
    expect(merged).toBe(1);
    expect(blocks.map((x) => x.kind)).toEqual(['greet']);
  });

  it('carries the wave\'s torso turn onto the greet', () => {
    const { blocks } = mergeAdjacentWaveIntoGreet([
      b('wave', { turn: true }),
      b('greet', { text: 'hi' }),
    ]);
    expect(blocks).toEqual([b('greet', { text: 'hi', turn: true })]);
  });

  it('leaves a wave alone when something runs between it and the greet', () => {
    const { blocks, merged } = mergeAdjacentWaveIntoGreet([
      b('wave', { turn: false }),
      b('walk', { distanceM: 2, direction: 'forward' }),
      b('greet', { text: 'hello' }),
    ]);
    expect(merged).toBe(0);
    expect(blocks.map((x) => x.kind)).toEqual(['wave', 'walk', 'greet']);
  });
});

describe('coerceParams / plannerFallback', () => {
  it('applies documented defaults', () => {
    // `wave` carries the sidecar's `turn` flag, not a hand: the G1 gesture is
    // right-arm only, so a hand selector could only ever be a false claim.
    expect(coerceParams({ kind: 'wave' })).toEqual({ turn: false });
    expect(coerceParams({ kind: 'wave', turn: true })).toEqual({ turn: true });
    expect(coerceParams({ kind: 'scan_room' })).toEqual({ steps: 8 });
    expect(coerceParams({ kind: 'walk', distanceM: 1 })).toEqual({
      distanceM: 1,
      direction: 'forward',
    });
    expect(coerceParams({ kind: 'greet' })).toEqual({});
    expect(coerceParams({ kind: 'look' })).toEqual({});
    expect(coerceParams({ kind: 'look', speak: true })).toEqual({ speak: true });
  });

  it('rejects a posture without a pose', () => {
    expect(() => coerceParams({ kind: 'posture' })).toThrow(/pose/);
  });

  it('goto takes an entity OR a place (TASK-209) — exactly one', () => {
    expect(coerceParams({ kind: 'goto', entity: 'table' })).toEqual({ entity: 'table' });
    expect(coerceParams({ kind: 'goto', place: ' Kitchen ' })).toEqual({ place: 'Kitchen' });
    expect(() => coerceParams({ kind: 'goto' })).toThrow(/missing "entity" \(or "place"\)/);
    expect(() => coerceParams({ kind: 'goto', entity: 'table', place: 'Kitchen' })).toThrow(/both/);
  });

  it('never produces a motion block in the fallback', () => {
    const blocks = plannerFallback('mach was', 'model offline');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe('speak');
    expect(String(blocks[0].params.text)).toContain('model offline');
  });
});

describe('Planner — reasoning split across two blocks', () => {
  it('recovers the real block instead of failing the whole plan', async () => {
    // Verbatim gemma3:4b output at temperature 0 for "dreh dich nach links",
    // reproduced 6/6 times. The first `turn` is the second one's justification,
    // not a plan step — rejecting the plan over it threw away a correct turn.
    const { planner, generate } = makePlanner([
      {
        text: JSON.stringify({
          blocks: [
            { kind: 'turn', reasoning: 'The operator wants to turn left.' },
            { kind: 'turn', angleDeg: 90 },
          ],
        }),
      },
    ]);

    const result = await planner.plan({ command: 'dreh dich nach links', sceneSummary: 'empty' });

    expect(generate).toHaveBeenCalledTimes(1);
    expect(result.fallback).toBe(false);
    // The reasoning is carried over, not discarded with the empty block.
    expect(result.blocks).toEqual([
      { kind: 'turn', params: { angleDeg: 90 }, reasoning: 'The operator wants to turn left.' },
    ]);
  });

  it('still fails a lone unexecutable block with no sibling to recover from', async () => {
    const { planner } = makePlanner([
      { text: JSON.stringify({ blocks: [{ kind: 'turn', reasoning: 'turning' }] }) },
    ]);

    const result = await planner.plan({ command: 'dreh dich', sceneSummary: 'empty' });

    expect(result.fallback).toBe(true);
    expect(result.error).toMatch(/angleDeg/);
  });
});

describe('mergeSplitReasoningBlocks', () => {
  it('drops only the unexecutable twin, keeping unrelated blocks in order', () => {
    const { blocks, dropped } = mergeSplitReasoningBlocks([
      { kind: 'speak', text: 'Ich drehe mich.' },
      { kind: 'turn', reasoning: 'nach links' },
      { kind: 'turn', angleDeg: 90 },
      { kind: 'look' },
    ]);

    expect(dropped).toEqual(['turn']);
    expect(blocks.map((b) => b.kind)).toEqual(['speak', 'turn', 'look']);
    expect(blocks[1]).toMatchObject({ angleDeg: 90, reasoning: 'nach links' });
  });

  it('does not drop across differing kinds', () => {
    // A parameterless `walk` followed by a `turn` is a genuinely broken plan,
    // not a reasoning split — it must still fail rather than be half-executed.
    const { blocks, dropped } = mergeSplitReasoningBlocks([
      { kind: 'walk', reasoning: 'los' },
      { kind: 'turn', angleDeg: 90 },
    ]);

    expect(dropped).toEqual([]);
    expect(blocks).toHaveLength(2);
  });

  it('keeps the executable block\'s own reasoning when it has one', () => {
    const { blocks } = mergeSplitReasoningBlocks([
      { kind: 'turn', reasoning: 'from the empty block' },
      { kind: 'turn', angleDeg: 90, reasoning: 'from the real block' },
    ]);

    expect(blocks[0].reasoning).toBe('from the real block');
  });

  it('leaves a plan with no split blocks completely untouched', () => {
    const input: Array<{ kind: 'turn' | 'walk'; angleDeg?: number; distanceM?: number }> = [
      { kind: 'turn', angleDeg: 90 },
      { kind: 'walk', distanceM: 1 },
    ];
    const { blocks, dropped } = mergeSplitReasoningBlocks(input);
    expect(dropped).toEqual([]);
    expect(blocks).toEqual(input);
  });
});

describe('enforceTurnDirection', () => {
  const turn = (angleDeg: number): PlannedBlock => ({ kind: 'turn', params: { angleDeg } });

  it('flips a turn that contradicts the direction the operator said', () => {
    // The live failure: gemma3:4b answered "dreh dich nach links" with -90 in
    // 5 of 5 runs, against a prompt carrying that exact example mapped to +90.
    const { blocks, corrections } = enforceTurnDirection('dreh dich nach links', [turn(-90)]);
    expect(blocks[0].params.angleDeg).toBe(90);
    expect(corrections).toEqual([{ from: -90, to: 90, direction: 'left' }]);
  });

  it('leaves a turn that already agrees with the command untouched', () => {
    const { blocks, corrections } = enforceTurnDirection('dreh dich nach rechts', [turn(-90)]);
    expect(blocks[0].params.angleDeg).toBe(-90);
    expect(corrections).toEqual([]);
  });

  it('does not touch a command naming both directions', () => {
    // Half-correcting "erst links, dann rechts" would be worse than not trying.
    const { blocks, corrections } = enforceTurnDirection('erst nach links, dann nach rechts', [
      turn(-90),
      turn(90),
    ]);
    expect(blocks.map((b) => b.params.angleDeg)).toEqual([-90, 90]);
    expect(corrections).toEqual([]);
  });

  it('leaves a 180° turn alone — it has no direction to be wrong about', () => {
    const { blocks, corrections } = enforceTurnDirection('dreh dich nach links um', [turn(180)]);
    expect(blocks[0].params.angleDeg).toBe(180);
    expect(corrections).toEqual([]);
  });

  it('ignores blocks that are not turns', () => {
    const walk: PlannedBlock = { kind: 'walk', params: { distanceM: 1, direction: 'forward' } };
    const { blocks, corrections } = enforceTurnDirection('geh nach links', [walk]);
    expect(blocks[0]).toBe(walk);
    expect(corrections).toEqual([]);
  });

  it('leaves the return leg of a counter-turn alone', () => {
    // "turn left, look, then turn back" names exactly one direction, so judging
    // each turn on its own flipped the RETURN leg to +90 — 180° from what the
    // operator asked for, logged as "turn direction corrected", with every
    // later walk in the plan running backwards.
    const look: PlannedBlock = { kind: 'look', params: {} };
    const { blocks, corrections } = enforceTurnDirection('schau nach links und dann wieder zurück', [
      turn(90),
      look,
      turn(-90),
    ]);
    expect(blocks.map((b) => b.params.angleDeg)).toEqual([90, undefined, -90]);
    expect(corrections).toEqual([]);
  });

  it('flips a counter-turn plan as a whole when the model has the convention inverted', () => {
    // The other half of the same bug: correcting per block turned
    // [-90, look, +90] into [+90, look, +90], equally 180° off. The convention
    // is a property of the PLAN, so it is decided once and applied to both.
    const look: PlannedBlock = { kind: 'look', params: {} };
    const { blocks, corrections } = enforceTurnDirection('schau nach links und dann wieder zurück', [
      turn(-90),
      look,
      turn(90),
    ]);
    expect(blocks.map((b) => b.params.angleDeg)).toEqual([90, undefined, -90]);
    expect(corrections).toEqual([
      { from: -90, to: 90, direction: 'left' },
      { from: 90, to: -90, direction: 'left' },
    ]);
  });
});
