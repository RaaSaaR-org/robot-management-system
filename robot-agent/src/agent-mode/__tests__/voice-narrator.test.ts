/**
 * @file voice-narrator.test.ts
 * @description What the robot says out loud about a plan: the acknowledgement
 *              names the planned steps in the operator's language, the outcome
 *              is spoken once the plan ends, and neither ever waits for the
 *              plan to run.
 * @feature agentmode
 * @status test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  awaitPlannedBlocks,
  describeCommandReplyAloud,
  describeNameAloud,
  describeOutcomeAloud,
  describePlanAloud,
  isVoiceTurnInFlight,
  narratePlanOutcome,
  resetNarrationState,
} from '../voice-narrator.js';
import type { AgentBlock, AgentModeEvent, AgentPlan } from '../types.js';

// One narrator per plan id is now enforced across calls, so the armed set has to
// be cleared between tests that all use `plan-1`.
beforeEach(() => resetNarrationState());

function block(kind: AgentBlock['kind'], params: Record<string, unknown> = {}): AgentBlock {
  return { id: `${kind}-${Math.random()}`, kind, params, status: 'pending' };
}

function plan(blocks: AgentBlock[], overrides: Partial<AgentPlan> = {}): AgentPlan {
  return {
    id: 'plan-1',
    robotId: 'g1',
    command: 'test',
    blocks,
    cursor: -1,
    status: 'running',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

/** A minimal stand-in for the controller's event fan-out. */
function makeBus() {
  const listeners = new Set<(event: AgentModeEvent) => void>();
  return {
    subscribe: (listener: (event: AgentModeEvent) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit: (event: AgentModeEvent) => listeners.forEach((l) => l(event)),
    get size() {
      return listeners.size;
    },
  };
}

describe('describePlanAloud', () => {
  it('names the planned steps, with their parameters, in German', () => {
    const spoken = describePlanAloud(
      plan([block('turn', { angleDeg: 90 }), block('goto', { entity: 'door' })]),
      'de'
    );
    expect(spoken).toBe('Alles klar, ich drehe mich 90 Grad nach links und gehe zu door.');
  });

  it('names the same steps in English', () => {
    const spoken = describePlanAloud(
      plan([block('walk', { distanceM: 2, direction: 'forward' }), block('look')]),
      'en'
    );
    expect(spoken).toBe('Okay, I will walk 2 metres forward and take a look.');
  });

  it('says the turn direction the sign actually means', () => {
    expect(describePlanAloud(plan([block('turn', { angleDeg: -90 })]), 'de')).toContain('rechts');
    expect(describePlanAloud(plan([block('turn', { angleDeg: 90 })]), 'de')).toContain('links');
    expect(describePlanAloud(plan([block('turn', { angleDeg: 180 })]), 'de')).toContain(
      'drehe mich um'
    );
  });

  it('trims a long plan rather than reciting twelve blocks at someone', () => {
    const spoken = describePlanAloud(
      plan([
        block('scan_room'),
        block('goto', { entity: 'table' }),
        block('look'),
        block('walk', { distanceM: 1 }),
        block('turn', { angleDeg: 45 }),
      ]),
      'en'
    );
    expect(spoken).toBe(
      'Okay, I will look around the room, walk to the table and take a look, and carry on from there.'
    );
  });

  it('announces nothing for a plan that is only speech — the words are the answer', () => {
    // Otherwise "Okay, I will say something." lands in front of the greeting
    // and the robot answers a question with an announcement of the answer.
    expect(describePlanAloud(plan([block('speak', { text: 'Hallo!' })]), 'de')).toBeNull();
    expect(describePlanAloud(plan([block('greet', { text: 'Hi' })]), 'en')).toBeNull();
  });
});

describe('describeOutcomeAloud', () => {
  it('says done, briefly, when the plan completed', () => {
    expect(describeOutcomeAloud(plan([block('walk')], { status: 'done' }), 'de')).toBe('Fertig.');
  });

  it('names the step that failed but does NOT read the operator prose aloud', () => {
    // Block messages are English timeline text ("2 looks in a row did not
    // report it…"). A German voice reading them is worse than saying nothing;
    // the operator is told which step and where to read why.
    const failed: AgentBlock = {
      ...block('goto', { entity: 'door' }),
      status: 'failed',
      error: '2 looks in a row did not report it, so the stored bearing is stale',
    };
    const spoken = describeOutcomeAloud(plan([failed], { status: 'failed' }), 'de');
    expect(spoken).toBe('Das hat nicht geklappt: gehe zu door. Die Einzelheiten stehen in der Zeitleiste.');
    expect(spoken).not.toContain('bearing');
  });

  it('reports an abort as stopped, not as failed', () => {
    expect(describeOutcomeAloud(plan([block('walk')], { status: 'aborted' }), 'en')).toBe('Stopped.');
  });

  it('stays silent after a plan that only spoke', () => {
    expect(
      describeOutcomeAloud(plan([block('speak', { text: 'Hallo' })], { status: 'done' }), 'de')
    ).toBeNull();
  });

  it('answers a plan that produced no blocks at all', () => {
    // The operator already heard "one moment" while the planner ran. Silence
    // after that leaves them waiting for a robot that has finished doing
    // nothing.
    expect(describeOutcomeAloud(plan([], { status: 'done' }), 'de')).toBe(
      'Fertig, es war nichts zu tun.'
    );
  });
});

describe('describeCommandReplyAloud', () => {
  it('says a stop was taken, in the operator language, not the English E-Stop prose', () => {
    expect(describeCommandReplyAloud({ outcome: 'estop', delivered: true }, 'de')).toBe('Gestoppt.');
    expect(describeCommandReplyAloud({ outcome: 'estop', delivered: true }, 'en')).toBe('Stopped.');
  });

  it('warns, at length, when the robot never confirmed the stop', () => {
    // The one reply where brevity must lose: the latch is set but the base was
    // never told, so it may still be walking.
    const spoken = describeCommandReplyAloud({ outcome: 'estop', delivered: false }, 'de');
    expect(spoken).toContain('nicht bestätigt');
    expect(spoken).toContain('Not-Aus');
  });

  it('acknowledges an interrupt without describing the running plan', () => {
    expect(describeCommandReplyAloud({ outcome: 'folded' }, 'de')).toBe(
      'Alles klar, das mache ich nach dem aktuellen Schritt.'
    );
  });

  it('says out loud that an earlier instruction was displaced', () => {
    // An accepted order that silently evaporates is one the operator waits for
    // forever — and by voice there is no timeline to notice it in.
    const spoken = describeCommandReplyAloud(
      { outcome: 'folded', replacedCommand: 'geh zum Tisch' },
      'de'
    );
    expect(spoken).toContain('ersetzt');
  });

  it('speaks refusals in the operator language', () => {
    expect(describeCommandReplyAloud({ outcome: 'estop_latched' }, 'de')).toContain('Not-Aus');
    expect(describeCommandReplyAloud({ outcome: 'busy' }, 'en')).toBe(
      'Something else has control right now.'
    );
  });

  it('falls back to the caller prose for outcomes with no spoken form', () => {
    // A fresh plan is answered by the plan acknowledgement, and an unmapped
    // future code must still leave the caller something to say.
    expect(describeCommandReplyAloud({ outcome: 'planned' }, 'de')).toBeNull();
    expect(describeCommandReplyAloud({}, 'de')).toBeNull();
  });
});

describe('awaitPlannedBlocks', () => {
  it('resolves as soon as the planner has produced blocks', async () => {
    const bus = makeBus();
    const pending = awaitPlannedBlocks('plan-1', { subscribe: bus.subscribe });
    bus.emit({
      type: 'agent:plan:updated',
      robotId: 'g1',
      plan: plan([block('look')]),
      timestamp: 'now',
    });
    await expect(pending).resolves.toMatchObject({ id: 'plan-1' });
    expect(bus.size).toBe(0); // unsubscribed
  });

  it('ignores an empty plan and another plan entirely', async () => {
    const bus = makeBus();
    const pending = awaitPlannedBlocks('plan-1', { subscribe: bus.subscribe, timeoutMs: 40 });
    bus.emit({ type: 'agent:plan:updated', robotId: 'g1', plan: plan([]), timestamp: 'now' });
    bus.emit({
      type: 'agent:plan:updated',
      robotId: 'g1',
      plan: plan([block('look')], { id: 'other' }),
      timestamp: 'now',
    });
    await expect(pending).resolves.toBeNull();
  });

  it('gives up on time rather than holding the microphone shut', async () => {
    const bus = makeBus();
    await expect(
      awaitPlannedBlocks('plan-1', { subscribe: bus.subscribe, timeoutMs: 20 })
    ).resolves.toBeNull();
    expect(bus.size).toBe(0);
  });
});

describe('narratePlanOutcome', () => {
  it('speaks the outcome when the plan finishes, in the operator language', async () => {
    const bus = makeBus();
    const say = vi.fn(async () => true);
    narratePlanOutcome('plan-1', 'de', { subscribe: bus.subscribe, say });

    expect(say).not.toHaveBeenCalled(); // nothing said while it runs
    bus.emit({
      type: 'agent:plan:finished',
      robotId: 'g1',
      plan: plan([block('walk')], { status: 'done' }),
      timestamp: 'now',
    });
    expect(say).toHaveBeenCalledWith('Fertig.', 'de');
    expect(bus.size).toBe(0);
  });

  it('says nothing about a different plan', () => {
    const bus = makeBus();
    const say = vi.fn(async () => true);
    narratePlanOutcome('plan-1', 'en', { subscribe: bus.subscribe, say });
    bus.emit({
      type: 'agent:plan:finished',
      robotId: 'g1',
      plan: plan([block('walk')], { id: 'other', status: 'done' }),
      timestamp: 'now',
    });
    expect(say).not.toHaveBeenCalled();
  });

  it('speaks the outcome ONCE however many commands were folded into the plan', () => {
    // Every spoken interrupt arms a narrator on the SAME running plan. Without
    // the guard the robot said "Fertig." once per command it had been given.
    const bus = makeBus();
    const say = vi.fn(async () => true);
    narratePlanOutcome('plan-1', 'de', { subscribe: bus.subscribe, say });
    narratePlanOutcome('plan-1', 'de', { subscribe: bus.subscribe, say });
    narratePlanOutcome('plan-1', 'de', { subscribe: bus.subscribe, say });

    bus.emit({
      type: 'agent:plan:finished',
      robotId: 'g1',
      plan: plan([block('walk')], { status: 'done' }),
      timestamp: 'now',
    });
    expect(say).toHaveBeenCalledTimes(1);
    expect(bus.size).toBe(0);
  });

  it('answers in the language of the person who spoke last', () => {
    // A German interrupt folded into an English plan: the controller moves
    // `plan.language` on, and the outcome has to follow it — the operator
    // waiting for the answer is the one who spoke most recently.
    const bus = makeBus();
    const say = vi.fn(async () => true);
    narratePlanOutcome('plan-1', 'en', { subscribe: bus.subscribe, say });
    bus.emit({
      type: 'agent:plan:finished',
      robotId: 'g1',
      plan: plan([block('walk')], { status: 'done', language: 'de' }),
      timestamp: 'now',
    });
    expect(say).toHaveBeenCalledWith('Fertig.', 'de');
  });

  it('can be cancelled, and speaks nothing afterwards', () => {
    const bus = makeBus();
    const say = vi.fn(async () => true);
    const stop = narratePlanOutcome('plan-1', 'en', { subscribe: bus.subscribe, say });
    stop();
    bus.emit({
      type: 'agent:plan:finished',
      robotId: 'g1',
      plan: plan([block('walk')], { status: 'done' }),
      timestamp: 'now',
    });
    expect(say).not.toHaveBeenCalled();
    expect(bus.size).toBe(0);
  });
});

// ============================================================================
// THE ROBOT'S OWN NAME (TASK-198)
// ============================================================================

describe('describeNameAloud', () => {
  it('is a template — the name is the only substitution', () => {
    expect(describeNameAloud('Nova', 'en')).toBe('I am Nova.');
    expect(describeNameAloud('Nova', 'de')).toBe('Ich bin Nova.');
  });

  it('degrades honestly when the robot has no name', () => {
    // A robot that has not been named still has to be able to say something —
    // "I am ." is worse than admitting it.
    expect(describeNameAloud('  ', 'en')).toBe('I do not have a name yet.');
    expect(describeNameAloud('', 'de')).toBe('Ich habe noch keinen Namen.');
  });
});

// ============================================================================
// THE HALF-DUPLEX SPAN (TASK-199)
// ============================================================================

describe('isVoiceTurnInFlight', () => {
  it('is true for exactly as long as the robot owes somebody a spoken answer', async () => {
    const bus = makeBus();
    let finishSpeaking!: () => void;
    const spoken = new Promise<boolean>((resolve) => {
      finishSpeaking = () => resolve(true);
    });
    const say = vi.fn(() => spoken);

    expect(isVoiceTurnInFlight()).toBe(false);

    // Armed the moment a spoken command is accepted — before the planner has
    // even answered. That is the span an unsolicited heartbeat utterance must
    // not land inside: every span of robot speech mutes the microphone, and the
    // microphone is where "stopp" has to go.
    narratePlanOutcome('plan-1', 'de', { subscribe: bus.subscribe, say });
    expect(isVoiceTurnInFlight()).toBe(true);

    bus.emit({
      type: 'agent:plan:finished',
      robotId: 'g1',
      plan: plan([block('walk')], { status: 'done' }),
      timestamp: 'now',
    });

    // THE assertion: the plan is over, the closing line is being SPOKEN, and
    // the span is still held. It used to be released one line before `say` was
    // even called, so a heartbeat could start a second utterance on top of this
    // one and extend the mute window over the operator's stop word.
    expect(say).toHaveBeenCalledTimes(1);
    expect(isVoiceTurnInFlight()).toBe(true);

    finishSpeaking();
    await vi.waitFor(() => expect(isVoiceTurnInFlight()).toBe(false));
  });

  it('gives the span back even when the voice service rejects', async () => {
    const bus = makeBus();
    const say = vi.fn(async () => {
      throw new Error('voice service exploded');
    });
    narratePlanOutcome('plan-1', 'en', { subscribe: bus.subscribe, say });

    bus.emit({
      type: 'agent:plan:finished',
      robotId: 'g1',
      plan: plan([block('walk')], { status: 'done' }),
      timestamp: 'now',
    });

    // A voice service that threw must not wedge the microphone shut forever.
    await vi.waitFor(() => expect(isVoiceTurnInFlight()).toBe(false));
  });

  it('gives the span back immediately when there is nothing to say', () => {
    const bus = makeBus();
    const say = vi.fn(async () => true);
    narratePlanOutcome('plan-1', 'en', { subscribe: bus.subscribe, say });

    // A plan that only spoke has no closing line (`describeOutcomeAloud`
    // returns null) — nothing is uttered, so nothing holds the microphone.
    bus.emit({
      type: 'agent:plan:finished',
      robotId: 'g1',
      plan: plan([block('speak')], { status: 'done' }),
      timestamp: 'now',
    });

    expect(say).not.toHaveBeenCalled();
    expect(isVoiceTurnInFlight()).toBe(false);
  });

  it('is false again once a narrator is cancelled', () => {
    const bus = makeBus();
    const stop = narratePlanOutcome('plan-1', 'en', {
      subscribe: bus.subscribe,
      say: vi.fn(async () => true),
    });
    expect(isVoiceTurnInFlight()).toBe(true);
    stop();
    expect(isVoiceTurnInFlight()).toBe(false);
  });
});
