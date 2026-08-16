/**
 * @file AgentChat.test.tsx
 * @description Tests for the Agent Mode chat — the send control must stay a
 *              44x44 touch target on coarse pointers (WCAG 2.5.5).
 * @feature agentmode
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AgentChat, ackTextFor } from '../AgentChat';
import type { AgentChatMessage, AgentPlan } from '../../types/agentmode.types';
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
