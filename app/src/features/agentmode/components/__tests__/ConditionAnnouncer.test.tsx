/**
 * @file ConditionAnnouncer.test.tsx
 * @description The page's live regions. A screen-reader user is told that
 *              something became true — which is what the condition stack, being
 *              unmounted while the robot is calm, structurally cannot do.
 * @feature agentmode
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { ConditionAnnouncer } from '../ConditionAnnouncer';
import { useAgentModeStore } from '../../store/agentmodeStore';

beforeEach(() => {
  useAgentModeStore.getState().reset();
});

describe('ConditionAnnouncer', () => {
  /**
   * THE reason this component exists. NVDA and JAWS only announce changes to a
   * region that was ALREADY in the accessible tree; a region inserted together
   * with its text is silent. `EstopBanner` returns null while nothing is wrong,
   * so its own `aria-live="polite"` never fired once.
   */
  it('is mounted and empty while the robot is calm', () => {
    render(<ConditionAnnouncer />);

    const polite = screen.getByRole('status');
    expect(polite).toBeInTheDocument();
    expect(polite).toHaveAttribute('aria-live', 'polite');
    expect(polite).toHaveTextContent('');
    // …and it costs the layout nothing, so the page's spacing is unchanged.
    expect(polite).toHaveClass('sr-only');
  });

  it('writes into the existing region when a condition becomes true', () => {
    const { rerender } = render(<ConditionAnnouncer />);
    const polite = screen.getByRole('status');

    act(() => {
      useAgentModeStore.setState({ damped: true, fsmId: 1 });
    });
    rerender(<ConditionAnnouncer />);

    // The SAME node, now carrying text — not a new node carrying text.
    expect(screen.getByRole('status')).toBe(polite);
    expect(polite).toHaveTextContent('Base arming: damped — it cannot walk, turn or go to');
  });

  it('says every condition that is true, not just the loudest', () => {
    useAgentModeStore.setState({
      stateReachability: 'unreachable',
      stateUnavailableReason: 'the robot agent could not be reached',
      damped: true,
      fsmId: 1,
    });
    render(<ConditionAnnouncer />);

    const polite = screen.getByRole('status');
    expect(polite).toHaveTextContent(/Robot reachable: not reachable/);
    expect(polite).toHaveTextContent(/Base arming: damped/);
  });

  /**
   * `conditionLevel` is a MAX, not a first match. Unreachable (level 2) sorts
   * ABOVE an unconfirmed stop (level 3), so a first-match implementation would
   * announce "it may still be moving" politely, behind whatever the screen
   * reader happened to be saying.
   */
  it('interrupts for a stop the hardware never confirmed, and only then', () => {
    useAgentModeStore.setState({
      stateReachability: 'unreachable',
      stateUnavailableReason: 'the robot agent could not be reached',
      estopActive: true,
      estopStatus: 'unconfirmed',
    });
    render(<ConditionAnnouncer />);

    const assertive = screen.getByRole('alert');
    expect(assertive).toHaveAttribute('aria-live', 'assertive');
    expect(assertive).toHaveTextContent(/E-Stop latch: latched/);
    // One announcement, not two: the polite region is emptied so the same
    // sentence is not read twice over the top of itself.
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('keeps an ordinary condition out of the assertive region', () => {
    useAgentModeStore.setState({ damped: true, fsmId: 1 });
    render(<ConditionAnnouncer />);

    expect(screen.getByRole('alert')).toHaveTextContent('');
    expect(screen.getByRole('status')).not.toHaveTextContent('');
  });
});
