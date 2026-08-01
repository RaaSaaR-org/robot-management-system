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

describe('Planner — prompt contents', () => {
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
  });

  it('rejects a posture without a pose', () => {
    expect(() => coerceParams({ kind: 'posture' })).toThrow(/pose/);
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
