/**
 * @file AgentChat.test.tsx
 * @description Tests for the Agent Mode chat — the send control must stay a
 *              44x44 touch target on coarse pointers (WCAG 2.5.5).
 * @feature agentmode
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { AgentChat, ackTextFor } from '../AgentChat';
import type {
  AgentBlock,
  AgentChatMessage,
  AgentModeEvent,
  AgentPlan,
} from '../../types/agentmode.types';
import { useAgentModeStore } from '../../store/agentmodeStore';

beforeEach(() => {
  useAgentModeStore.getState().reset();
});

describe('AgentChat', () => {
  it('keeps the send button a 44x44 touch target on coarse pointers', () => {
    // jsdom computes no Tailwind styles, so the class tokens are the contract:
    // `h-11`/`w-11` are 44px on touch; desktop keeps the compact 40px button.
    render(<AgentChat robotId="demo-g1-001" />);

    const button = screen.getByTestId('agent-send-button');
    expect(button).toHaveClass('pointer-coarse:h-11');
    expect(button).toHaveClass('pointer-coarse:w-11');
  });
});

describe('AgentChat — a plan this console did not see', () => {
  const plan = {
    id: 'plan-9', robotId: 'demo-g1-001', command: 'walk into the kitchen', blocks: [], cursor: -1,
    status: 'done', createdAt: '2026-08-16T10:00:00.000Z', updatedAt: '2026-08-16T10:02:00.000Z',
  } as unknown as AgentPlan;

  it('renders the robot’s plan as the exchange it was instead of the empty state', () => {
    // A reload (or a command over A2A / the microphone) leaves `messages` empty
    // while the rail already says "Done" — the empty state then reads as "the
    // robot has never done anything".
    useAgentModeStore.setState({ plan });
    render(<AgentChat robotId="demo-g1-001" />);
    expect(screen.getByTestId('agent-user-message')).toHaveTextContent('walk into the kitchen');
    expect(screen.getByTestId('agent-agent-message')).toHaveTextContent('Done.');
    expect(screen.getByTestId('agent-chat-restored')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'turn left and look around' })).toBeNull();
  });

  it('keeps the suggestions when there is no plan at all', () => {
    render(<AgentChat robotId="demo-g1-001" />);
    expect(screen.queryByTestId('agent-chat-restored')).toBeNull();
    expect(screen.getByRole('button', { name: 'turn left and look around' })).toBeInTheDocument();
  });

  it('keeps the restored exchange when the closing summary arrives', () => {
    // The reload case, one event later: `agent:plan:finished` pushes the first
    // real message into a conversation that had none. Keyed on emptiness, the
    // whole restored exchange — and with it every block card — disappeared
    // from under the operator at the moment the plan ended.
    useAgentModeStore.setState({ plan });
    const { rerender } = render(<AgentChat robotId="demo-g1-001" />);

    act(() => {
      useAgentModeStore.getState().applyEvent({
        type: 'agent:plan:finished',
        robotId: 'demo-g1-001',
        plan: { ...plan, status: 'done' },
        timestamp: '2026-08-16T10:02:00.000Z',
      } as AgentModeEvent);
    });
    rerender(<AgentChat robotId="demo-g1-001" />);

    expect(screen.getByTestId('agent-user-message')).toHaveTextContent('walk into the kitchen');
    expect(screen.getByTestId('agent-chat-restored')).toBeInTheDocument();
    // … and the summary lands after it, not instead of it.
    const agentLines = screen.getAllByTestId('agent-agent-message');
    expect(agentLines[agentLines.length - 1]).toHaveTextContent('Plan completed');
  });
});

describe('AgentChat — a plan nobody typed here', () => {
  const block = (id: string, kind: string): AgentBlock =>
    ({ id, kind, params: {}, status: 'pending' }) as unknown as AgentBlock;

  const spokenPlan = {
    id: 'plan-7',
    robotId: 'demo-g1-001',
    command: 'lauf in die Küche',
    language: 'de',
    blocks: [block('b1', 'turn'), block('b2', 'walk')],
    cursor: -1,
    status: 'running',
    createdAt: '2026-08-16T10:00:00.000Z',
    updatedAt: '2026-08-16T10:00:00.000Z',
  } as unknown as AgentPlan;

  it('renders the blocks of a plan that arrived as an event, not as a send', () => {
    // Voice, A2A, patrol, a second operator: nothing goes through
    // `sendCommand`, so nothing used to write the acknowledgement the block
    // cards hang off. The transcript line appeared and then the operator saw
    // nothing at all — no reasoning, no results, no errors, no durations —
    // until a bare "Plan completed" at the very end.
    useAgentModeStore.getState().applyEvent({
      type: 'agent:plan:started',
      robotId: 'demo-g1-001',
      plan: spokenPlan,
      timestamp: '2026-08-16T10:00:00.000Z',
    } as AgentModeEvent);

    render(<AgentChat robotId="demo-g1-001" />);

    expect(screen.getByTestId('agent-user-message')).toHaveTextContent('lauf in die Küche');
    expect(screen.getByTestId('agent-spoken-marker')).toHaveTextContent('DE');
    expect(screen.getByTestId('agent-plan-blocks')).toHaveAttribute('data-plan-id', 'plan-7');
    expect(screen.getAllByTestId('agent-block-card')).toHaveLength(2);
    // It is this console's live view of a running plan, not a reconstruction.
    expect(screen.queryByTestId('agent-chat-restored')).toBeNull();
    expect(screen.getByTestId('agent-agent-message')).toHaveTextContent('On it.');
  });
});

describe('ackTextFor — the acknowledgement follows its plan', () => {
  const msg = {
    id: 'm1', role: 'agent', text: 'Planning…', timestamp: 't', planId: 'plan-1', showsPlan: true,
  } as unknown as AgentChatMessage;
  const plan = (status: AgentPlan['status'], id = 'plan-1') => ({ id, status } as unknown as AgentPlan);

  it('keeps the first reply while the plan is still being planned', () => {
    expect(ackTextFor(msg, plan('planning'))).toBe('Planning…');
  });

  it('does not say "Planning…" next to a rail that says Done', () => {
    expect(ackTextFor(msg, plan('running'))).toBe('On it.');
    expect(ackTextFor(msg, plan('done'))).toBe('Done.');
    expect(ackTextFor(msg, plan('failed'))).toBe('That did not work.');
    expect(ackTextFor(msg, plan('aborted'))).toBe('Stopped.');
  });

  it('leaves messages that carry no plan (or another plan) alone', () => {
    expect(ackTextFor({ ...msg, showsPlan: false }, plan('done'))).toBe('Planning…');
    expect(ackTextFor(msg, plan('done', 'plan-2'))).toBe('Planning…');
    expect(ackTextFor(msg, null)).toBe('Planning…');
  });
});
