/**
 * @file BlockTimeline.test.tsx
 * @description Tests for the execution bar — STOPP is the one control that
 *              always works, so it must stay a >=44px touch target on coarse
 *              pointers (Apple HIG / WCAG 2.5.5).
 * @feature agentmode
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BlockTimeline } from '../BlockTimeline';
import { useAgentModeStore } from '../../store/agentmodeStore';

beforeEach(() => {
  useAgentModeStore.getState().reset();
});

describe('BlockTimeline', () => {
  it('fires onStop from the STOPP button', async () => {
    const onStop = vi.fn();
    render(<BlockTimeline onStop={onStop} />);

    await userEvent.click(screen.getByTestId('agent-stop-button'));

    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('disables STOPP only when no robot is bound', () => {
    const { rerender } = render(<BlockTimeline onStop={() => {}} disabled />);
    expect(screen.getByTestId('agent-stop-button')).toBeDisabled();

    rerender(<BlockTimeline onStop={() => {}} />);
    expect(screen.getByTestId('agent-stop-button')).toBeEnabled();
  });

  it('keeps STOPP a >=44px touch target on coarse pointers', () => {
    // jsdom computes no Tailwind styles, so the class token is the contract:
    // `min-h-11` is 44px — the minimum for a safety control on touch screens.
    render(<BlockTimeline onStop={() => {}} />);

    expect(screen.getByTestId('agent-stop-button')).toHaveClass('pointer-coarse:min-h-11');
  });
});
