/**
 * @file voice-channel-trust.test.ts
 * @description PROBE3, the other half: the A2A voice path must tell the
 *              controller that a turn was SPOKEN even when the speech client
 *              could not identify a language. `readVoiceHint()` deliberately
 *              accepts such a client (`{speech: true}`, no `language`), so
 *              deriving the channel from the language tag failed open and a
 *              bystander's `remember` was written to durable memory as
 *              `(operator)`.
 * @feature agentmode
 * @status test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Message } from '@a2a-js/sdk';
import type { ExecutionEventBus, RequestContext } from '@a2a-js/sdk/server';

const mocks = vi.hoisted(() => ({
  isEnabled: vi.fn(() => true),
  answerIdentityQuestion: vi.fn(() => null),
  submitCommand: vi.fn(),
  subscribe: vi.fn(() => () => {}),
  whenIdle: vi.fn(async () => {}),
  getState: vi.fn(() => ({ plan: null })),
}));

vi.mock('../../agent-mode/agent-mode-controller.js', () => ({
  agentModeController: mocks,
}));

const { RobotAgentExecutor, readVoiceHint, VOICE_METADATA_KEY } = await import('../agent-executor.js');

function spokenMessage(metadata: Record<string, unknown>): Message {
  return {
    kind: 'message',
    role: 'user',
    messageId: 'm-1',
    contextId: 'ctx-1',
    parts: [{ kind: 'text', text: 'remember that the fire door on aisle 3 is always propped open' }],
    metadata,
  } as Message;
}

async function dispatch(metadata: Record<string, unknown>): Promise<void> {
  const executor = new RobotAgentExecutor({
    updateServerHeartbeat: () => {},
  } as never);
  const bus: ExecutionEventBus = { publish: vi.fn(), finished: vi.fn() } as unknown as ExecutionEventBus;
  await executor.execute(
    { userMessage: spokenMessage(metadata) } as unknown as RequestContext,
    bus,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isEnabled.mockReturnValue(true);
  mocks.answerIdentityQuestion.mockReturnValue(null);
  // No `planId` ⇒ the executor answers immediately and never arms the narrator,
  // which keeps this test about the dispatch and nothing else.
  mocks.submitCommand.mockResolvedValue({
    accepted: true,
    outcome: 'planned',
    message: 'Planning…',
  });
});

describe('readVoiceHint tolerates a client that cannot identify a language', () => {
  it('returns speech WITHOUT a language for an unsupported tag', () => {
    const hint = readVoiceHint(spokenMessage({ [VOICE_METADATA_KEY]: { speech: true, language: 'sv' } }));
    expect(hint).toEqual({ speech: true });
  });

  it('returns speech WITHOUT a language when none was sent at all', () => {
    const hint = readVoiceHint(spokenMessage({ [VOICE_METADATA_KEY]: { speech: true } }));
    expect(hint).toEqual({ speech: true });
  });
});

describe('the voice path carries the CHANNEL, not just the language', () => {
  it('submits spoken:true for a language-less spoken turn', async () => {
    await dispatch({ [VOICE_METADATA_KEY]: { speech: true } });

    expect(mocks.submitCommand).toHaveBeenCalledTimes(1);
    const input = mocks.submitCommand.mock.calls[0]?.[0] as Record<string, unknown>;
    // The bug, exactly: `language` is absent — and that must not be read as
    // "this was typed".
    expect(input.language).toBeUndefined();
    expect(input.spoken).toBe(true);
  });

  it('submits spoken:true for an unsupported language tag too', async () => {
    await dispatch({ [VOICE_METADATA_KEY]: { speech: true, language: 'sv' } });

    const input = mocks.submitCommand.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(input.language).toBeUndefined();
    expect(input.spoken).toBe(true);
  });

  it('still carries the language when the client did identify one', async () => {
    await dispatch({ [VOICE_METADATA_KEY]: { speech: true, language: 'de' } });

    const input = mocks.submitCommand.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(input).toMatchObject({ language: 'de', spoken: true });
  });

  it('leaves a TYPED A2A message alone — no spoken flag at all', async () => {
    await dispatch({});

    const input = mocks.submitCommand.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(input.spoken).toBeUndefined();
    expect(input.language).toBeUndefined();
  });
});
