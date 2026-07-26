/**
 * @file AgentChat.test.tsx
 * @description Tests for the Agent Mode chat — the send control must stay a
 *              44x44 touch target on coarse pointers (WCAG 2.5.5).
 * @feature agentmode
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AgentChat } from '../AgentChat';
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
