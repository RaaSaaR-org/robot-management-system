/**
 * @file EstopBanner.test.tsx
 * @description Tests for the E-Stop banner — an unverified stop must never be
 *              presented to the operator as a completed one (TASK-194).
 * @feature agentmode
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EstopBanner } from '../EstopBanner';
import { useAgentModeStore } from '../../store/agentmodeStore';
import type { AgentEstopStatus } from '../../types/agentmode.types';

function latch(status: AgentEstopStatus, estopError: string | null = null) {
  useAgentModeStore.setState({ estopActive: true, estopStatus: status, estopError });
}

beforeEach(() => {
  useAgentModeStore.getState().reset();
});

describe('EstopBanner', () => {
  it('renders nothing while no latch is set', () => {
    const { container } = render(<EstopBanner onReset={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('says the stop is only requested while the call is in flight', () => {
    latch('requesting');
    render(<EstopBanner onReset={() => {}} />);

    expect(screen.getByTestId('agent-estop-banner')).toHaveAttribute(
      'data-estop-status',
      'requesting'
    );
    expect(screen.getByTestId('agent-estop-title')).toHaveTextContent('E-Stop requested');
    // Nothing is known about the robot yet — it must not be called stopped.
    expect(screen.queryByText(/stopped and damped/i)).toBeNull();
    expect(screen.getByTestId('agent-estop-detail')).toHaveTextContent(/not confirmed yet/i);
  });

  it('claims the robot is stopped only once the agent acknowledged', () => {
    latch('acknowledged');
    render(<EstopBanner onReset={() => {}} />);

    expect(screen.getByTestId('agent-estop-title')).toHaveTextContent('E-Stop latched');
    expect(screen.getByTestId('agent-estop-detail')).toHaveTextContent(/stopped and damped/i);
  });

  it('shows the hardware-unconfirmed warning instead of the clean-stop claim', () => {
    // `delivered: false` from the agent: latched in software, StopMove/Damp
    // not acked — the banner must alarm, not claim "stopped and damped".
    latch('unconfirmed', 'Damp rejected by sidecar');
    render(<EstopBanner onReset={() => {}} />);

    const banner = screen.getByTestId('agent-estop-banner');
    expect(banner).toHaveAttribute('data-estop-status', 'unconfirmed');
    expect(banner).toHaveAttribute('role', 'alert');
    expect(screen.getByTestId('agent-estop-title')).toHaveTextContent(
      /NOT confirmed by the robot/i
    );
    expect(screen.getByTestId('agent-estop-detail')).toHaveTextContent('Damp rejected by sidecar');
    expect(screen.getByTestId('agent-estop-detail')).toHaveTextContent(/may still be moving/i);
    expect(screen.queryByText(/stopped and damped/i)).toBeNull();
  });

  it('shouts when the stop request failed and shows why', () => {
    latch('failed', 'Robot agent unreachable');
    render(<EstopBanner onReset={() => {}} />);

    const banner = screen.getByTestId('agent-estop-banner');
    expect(banner).toHaveAttribute('data-estop-status', 'failed');
    expect(banner).toHaveAttribute('role', 'alert');
    expect(screen.getByTestId('agent-estop-title')).toHaveTextContent('E-Stop NOT confirmed');
    // The server's message is the evidence the stop never left the browser.
    expect(screen.getByTestId('agent-estop-detail')).toHaveTextContent('Robot agent unreachable');
    expect(screen.getByTestId('agent-estop-detail')).toHaveTextContent(/may still be moving/i);
    expect(screen.queryByText(/stopped and damped/i)).toBeNull();
  });

  it('still offers the reset control', async () => {
    const onReset = vi.fn();
    latch('failed', 'Robot agent unreachable');
    render(<EstopBanner onReset={onReset} />);

    await userEvent.click(screen.getByTestId('agent-estop-reset'));

    expect(onReset).toHaveBeenCalledTimes(1);
  });

  describe('damped base', () => {
    it('says the robot cannot move and what brings it back up', () => {
      useAgentModeStore.setState({ damped: true, fsmId: 1 });
      render(<EstopBanner onReset={() => {}} />);

      const banner = screen.getByTestId('agent-damped-banner');
      expect(banner).toBeVisible();
      expect(banner).toHaveAttribute('data-fsm-id', '1');
      expect(banner).toHaveTextContent(/cannot move/i);
      expect(banner).toHaveTextContent(/FSM 1/);
      // Locomotion blocks are accepted and do nothing — say so, and say what
      // actually re-arms the base.
      expect(screen.getByTestId('agent-damped-detail')).toHaveTextContent(/do nothing/i);
      expect(screen.getByTestId('agent-damped-detail')).toHaveTextContent(/posture/i);
      expect(screen.getByTestId('agent-damped-detail')).toHaveTextContent(/stand/i);
    });

    it('never offers a control that re-arms the robot', () => {
      // Manual-E-Stop-only: telling the operator what to send is the goal,
      // sending FSM 500 for them is not.
      useAgentModeStore.setState({ damped: true, fsmId: 1 });
      render(<EstopBanner onReset={() => {}} />);

      expect(screen.queryByRole('button')).toBeNull();
    });

    it('outlives the latch — the reset does not re-arm the base', () => {
      latch('acknowledged');
      useAgentModeStore.setState({ damped: true, fsmId: 1 });
      const { rerender } = render(<EstopBanner onReset={() => {}} />);

      expect(screen.getByTestId('agent-estop-banner')).toBeVisible();
      expect(screen.getByTestId('agent-damped-banner')).toBeVisible();

      // Latch cleared, base still damped.
      act(() => {
        useAgentModeStore.setState({ estopActive: false, estopStatus: 'idle' });
      });
      rerender(<EstopBanner onReset={() => {}} />);

      expect(screen.queryByTestId('agent-estop-banner')).toBeNull();
      expect(screen.getByTestId('agent-damped-banner')).toBeVisible();
    });

    it('stays silent while the base is not damped', () => {
      useAgentModeStore.setState({ damped: false });
      const { container } = render(<EstopBanner onReset={() => {}} />);
      expect(container).toBeEmptyDOMElement();
    });
  });
});
