/**
 * @file agent-executor-voice.test.ts
 * @description The A2A speech path: a spoken command is answered as soon as the
 *   plan is understood, not when it has finished running, and the reply names
 *   the planned steps in the language the operator spoke.
 * @feature agent-mode
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { Message, TaskStatusUpdateEvent } from '@a2a-js/sdk';
import type { ExecutionEventBus, RequestContext } from '@a2a-js/sdk/server';

import { agentModeController } from '../agent-mode/agent-mode-controller.js';
import { RobotAgentExecutor, VOICE_METADATA_KEY, readVoiceHint } from '../agent/agent-executor.js';
import * as narrator from '../agent-mode/voice-narrator.js';
import type { AgentModeEvent, AgentPlan } from '../agent-mode/types.js';
import type { RobotStateManager } from '../robot/state.js';

const PLAN_ID = 'plan-voice-1';

function plan(overrides: Partial<AgentPlan> = {}): AgentPlan {
  return {
    id: PLAN_ID,
    robotId: 'g1',
    command: 'geh zur Tuer',
    blocks: [
      { id: 'b1', kind: 'scan_room', params: { steps: 8 }, status: 'pending' },
      { id: 'b2', kind: 'goto', params: { entity: 'door' }, status: 'pending' },
    ],
    cursor: -1,
    status: 'running',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function message(text: string, metadata?: Record<string, unknown>): Message {
  return {
    kind: 'message',
    role: 'user',
    messageId: 'm-1',
    parts: [{ kind: 'text', text }],
    contextId: 'ctx-1',
    ...(metadata ? { metadata } : {}),
  };
}

/** Collects the status-update texts the executor publishes. */
function makeBus() {
  const published: TaskStatusUpdateEvent[] = [];
  const bus = {
    publish: (event: unknown) => {
      const e = event as TaskStatusUpdateEvent;
      if (e.kind === 'status-update') published.push(e);
    },
  } as unknown as ExecutionEventBus;
  return {
    bus,
    published,
    finalText: () => {
      const last = published.filter((e) => e.final).at(-1);
      const part = last?.status.message?.parts?.[0];
      return part && part.kind === 'text' ? part.text : null;
    },
    finalState: () => published.filter((e) => e.final).at(-1)?.status.state ?? null,
  };
}

const stateManager = {
  updateServerHeartbeat: () => {},
  getState: () => ({ id: 'g1' }),
  stop: async () => {},
} as unknown as RobotStateManager;

function context(msg: Message): RequestContext {
  return { userMessage: msg, task: undefined } as unknown as RequestContext;
}

describe('readVoiceHint', () => {
  it('reads the speech flag and language', () => {
    const hint = readVoiceHint(
      message('hi', { [VOICE_METADATA_KEY]: { speech: true, language: 'de' } })
    );
    expect(hint).toEqual({ speech: true, language: 'de' });
  });

  it('treats anything malformed as not-speech rather than failing the command', () => {
    expect(readVoiceHint(message('hi'))).toBeNull();
    expect(readVoiceHint(message('hi', { [VOICE_METADATA_KEY]: 'yes' }))).toBeNull();
    expect(readVoiceHint(message('hi', { [VOICE_METADATA_KEY]: { speech: 'true' } }))).toBeNull();
    // An unknown language is dropped, the speech flag survives: the reply is
    // still short and immediate, just in the default language.
    expect(
      readVoiceHint(message('hi', { [VOICE_METADATA_KEY]: { speech: true, language: 'fr' } }))
    ).toEqual({ speech: true });
  });
});

describe('RobotAgentExecutor — spoken commands', () => {
  let listeners: Array<(event: AgentModeEvent) => void>;

  beforeEach(() => {
    listeners = [];
    // One narrator per plan id is enforced process-wide; every test here uses
    // the same PLAN_ID, so a leftover from the previous one would silently turn
    // the next arming into a no-op.
    narrator.resetNarrationState();
    vi.spyOn(agentModeController, 'isEnabled').mockReturnValue(true);
    vi.spyOn(agentModeController, 'subscribe').mockImplementation((listener) => {
      listeners.push(listener);
      return () => {
        listeners = listeners.filter((l) => l !== listener);
      };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const emit = (event: AgentModeEvent) => listeners.slice().forEach((l) => l(event));

  it('answers with the planned steps as soon as the plan exists — not when it ends', async () => {
    vi.spyOn(agentModeController, 'submitCommand').mockResolvedValue({
      accepted: true,
      planId: PLAN_ID,
      message: 'Planning…',
    });
    // whenIdle is the blocking wait the SCREEN path uses. If the speech path
    // ever awaits it again, this rejection fails the test loudly — that wait is
    // the bug this branch exists to avoid.
    vi.spyOn(agentModeController, 'whenIdle').mockRejectedValue(
      new Error('speech path must not wait for the plan to finish')
    );

    const { bus, finalText, finalState } = makeBus();
    const executor = new RobotAgentExecutor(stateManager);
    const running = executor.execute(
      context(message('geh zur Tuer', { [VOICE_METADATA_KEY]: { speech: true, language: 'de' } })),
      bus
    );

    // The planner answers a moment later; only then can the reply name steps.
    await vi.waitFor(() => expect(listeners.length).toBeGreaterThan(0));
    emit({ type: 'agent:plan:updated', robotId: 'g1', plan: plan(), timestamp: 'now' });

    await running;
    expect(finalState()).toBe('completed');
    expect(finalText()).toBe(
      'Alles klar, ich sehe mich im Raum um und gehe zu door.'
    );
  });

  it('passes the spoken language to the controller so the plan answers in it', async () => {
    const submit = vi.spyOn(agentModeController, 'submitCommand').mockResolvedValue({
      accepted: true,
      planId: PLAN_ID,
      message: 'Planning…',
    });
    vi.spyOn(narrator, 'narratePlanOutcome').mockReturnValue(() => {});
    vi.spyOn(narrator, 'awaitPlannedBlocks').mockResolvedValue(plan());

    const { bus } = makeBus();
    await new RobotAgentExecutor(stateManager).execute(
      context(message('geh zur Tuer', { [VOICE_METADATA_KEY]: { speech: true, language: 'de' } })),
      bus
    );

    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'geh zur Tuer', language: 'de' })
    );
  });

  it('still answers when the planner is slow, without holding the microphone', async () => {
    vi.spyOn(agentModeController, 'submitCommand').mockResolvedValue({
      accepted: true,
      planId: PLAN_ID,
      message: 'Planning…',
    });
    vi.spyOn(narrator, 'narratePlanOutcome').mockReturnValue(() => {});
    vi.spyOn(narrator, 'awaitPlannedBlocks').mockResolvedValue(null); // timed out

    const { bus, finalText, finalState } = makeBus();
    await new RobotAgentExecutor(stateManager).execute(
      context(message('geh zur Tuer', { [VOICE_METADATA_KEY]: { speech: true, language: 'de' } })),
      bus
    );

    expect(finalState()).toBe('completed');
    expect(finalText()).toBe('Ich denke noch darüber nach.');
  });

  it('answers a spoken stop word immediately, in German, ahead of everything else', async () => {
    vi.spyOn(agentModeController, 'submitCommand').mockResolvedValue({
      accepted: true,
      outcome: 'estop',
      delivered: true,
      message: 'E-Stop: the running plan was discarded and the robot was damped.',
    });
    const narrate = vi.spyOn(narrator, 'narratePlanOutcome');

    const { bus, finalText, finalState } = makeBus();
    await new RobotAgentExecutor(stateManager).execute(
      context(message('stopp', { [VOICE_METADATA_KEY]: { speech: true, language: 'de' } })),
      bus
    );

    expect(finalState()).toBe('completed');
    // NOT the English timeline prose: that message is read out by a German TTS
    // voice, and it is the one reply that has to land instantly.
    expect(finalText()).toBe('Gestoppt.');
    expect(narrate).not.toHaveBeenCalled(); // there is no plan to narrate
  });

  it('spells out a stop the robot never confirmed', async () => {
    vi.spyOn(agentModeController, 'submitCommand').mockResolvedValue({
      accepted: true,
      outcome: 'estop',
      delivered: false,
      deliveryError: 'no sidecar ack',
      message: 'E-Stop: the running plan was discarded but the robot did NOT confirm…',
    });

    const { bus, finalText } = makeBus();
    await new RobotAgentExecutor(stateManager).execute(
      context(message('stopp', { [VOICE_METADATA_KEY]: { speech: true, language: 'de' } })),
      bus
    );

    expect(finalText()).toContain('Not-Aus');
  });

  it('acknowledges a spoken interrupt without describing the plan already running', async () => {
    // The interrupt carries the RUNNING plan's id. Describing it back would
    // promise steps the robot has already taken — and awaiting its blocks
    // resolves instantly from the transitions it is emitting anyway.
    vi.spyOn(agentModeController, 'submitCommand').mockResolvedValue({
      accepted: true,
      outcome: 'folded',
      planId: PLAN_ID,
      message: 'Understood — I will fold that into the running plan after the current block.',
    });
    const awaitBlocks = vi.spyOn(narrator, 'awaitPlannedBlocks');
    const narrate = vi.spyOn(narrator, 'narratePlanOutcome').mockReturnValue(() => {});

    const { bus, finalText, finalState } = makeBus();
    await new RobotAgentExecutor(stateManager).execute(
      context(message('dreh dich um', { [VOICE_METADATA_KEY]: { speech: true, language: 'de' } })),
      bus
    );

    expect(finalState()).toBe('completed');
    expect(finalText()).toBe('Alles klar, das mache ich nach dem aktuellen Schritt.');
    expect(awaitBlocks).not.toHaveBeenCalled();
    // Still armed: a spoken interrupt on a plan someone TYPED would otherwise
    // never get its outcome spoken. Arming twice is a no-op by design.
    expect(narrate).toHaveBeenCalledWith(PLAN_ID, 'de', expect.anything());
  });

  it('refuses in the operator language when a latch forbids driving', async () => {
    vi.spyOn(agentModeController, 'submitCommand').mockResolvedValue({
      accepted: false,
      outcome: 'estop_latched',
      message: 'E-Stop is latched (fall detected) — reset it before sending commands.',
    });

    const { bus, finalText, finalState } = makeBus();
    await new RobotAgentExecutor(stateManager).execute(
      context(message('geh vor', { [VOICE_METADATA_KEY]: { speech: true, language: 'de' } })),
      bus
    );

    expect(finalState()).toBe('failed');
    expect(finalText()).toBe('Der Not-Aus ist noch aktiv — setz ihn erst zurück.');
  });

  it('keeps the English prose for the typed path, outcome codes or not', async () => {
    vi.spyOn(agentModeController, 'submitCommand').mockResolvedValue({
      accepted: false,
      outcome: 'estop_latched',
      message: 'E-Stop is latched (fall detected) — reset it before sending commands.',
    });

    const { bus, finalText } = makeBus();
    await new RobotAgentExecutor(stateManager).execute(context(message('walk forward')), bus);

    expect(finalText()).toContain('E-Stop is latched');
  });

  it('leaves the typed path blocking on the plan, with its streamed block lines', async () => {
    vi.spyOn(agentModeController, 'submitCommand').mockResolvedValue({
      accepted: true,
      planId: PLAN_ID,
      message: 'Planning…',
    });
    vi.spyOn(agentModeController, 'whenIdle').mockResolvedValue(undefined);
    vi.spyOn(agentModeController, 'getState').mockReturnValue({
      robotId: 'g1',
      enabled: true,
      controlOwner: 'agent',
      plan: plan({ status: 'done', blocks: [] }),
      scene: null,
      estopActive: false,
    });

    const { bus, finalText } = makeBus();
    await new RobotAgentExecutor(stateManager).execute(context(message('walk to the door')), bus);

    // Unchanged behaviour for the UI: the machine-readable summary, not speech.
    expect(finalText()).toContain('blocks completed');
  });
});
