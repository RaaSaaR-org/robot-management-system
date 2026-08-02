/**
 * @file AgentModeToggle.test.tsx
 * @description Tests for the Agent Mode switch — a two-position control has no
 *              honest position for a robot that could not be asked, so it must
 *              stop claiming one.
 * @feature agentmode
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AgentModeToggle } from '../AgentModeToggle';
import { useAgentModeStore } from '../../store/agentmodeStore';

vi.mock('../../api/agentmodeApi', () => ({
  agentmodeApi: {
    getState: vi.fn(),
    getScene: vi.fn(),
    sendCommand: vi.fn(),
    toggle: vi.fn(),
    estop: vi.fn(),
    resetEstop: vi.fn(),
    getMemory: vi.fn(),
    writeIdentity: vi.fn(),
  },
}));

import { agentmodeApi } from '../../api/agentmodeApi';

const mockedApi = vi.mocked(agentmodeApi);
const ROBOT_ID = 'demo-g1-001';

const unreachable = () =>
  useAgentModeStore.setState({
    stateReachability: 'unreachable',
    stateUnavailableReason: 'the robot agent could not be reached',
  });

beforeEach(() => {
  useAgentModeStore.getState().reset();
  useAgentModeStore.setState({ robotId: ROBOT_ID });
  vi.clearAllMocks();
});

describe('AgentModeToggle', () => {
  it('renders the switch as off when the robot says it is off', () => {
    render(<AgentModeToggle robotId={ROBOT_ID} />);

    const toggle = screen.getByTestId('agent-mode-toggle');
    expect(toggle).toHaveAttribute('role', 'switch');
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByTestId('agent-mode-label')).toHaveTextContent('Agent Mode off');
  });

  it('flips the mode when the robot is reachable', async () => {
    mockedApi.toggle.mockResolvedValue({
      robotId: ROBOT_ID,
      enabled: true,
      controlOwner: 'idle',
      plan: null,
      scene: null,
      estopActive: false,
    });

    render(<AgentModeToggle robotId={ROBOT_ID} />);

    await userEvent.click(screen.getByTestId('agent-mode-toggle'));

    expect(mockedApi.toggle).toHaveBeenCalledWith(ROBOT_ID, true);
  });

  // The cockpit's rule: nothing renders an always-on status. A badge that is
  // present on every calm page is one nobody reads by the time it matters.
  describe('says nothing while there is nothing to say', () => {
    it('hides the control-owner pill while the robot is idle', () => {
      render(<AgentModeToggle robotId={ROBOT_ID} />);

      expect(screen.queryByTestId('agent-control-owner')).not.toBeInTheDocument();
    });

    it.each(['teleop', 'vla', 'agent'] as const)(
      'shows the control-owner pill for %s — someone else can move this robot',
      (owner) => {
        useAgentModeStore.setState({ controlOwner: owner });
        render(<AgentModeToggle robotId={ROBOT_ID} />);

        expect(screen.getByTestId('agent-control-owner')).toBeVisible();
      }
    );

    it('keeps the on/off word for screen readers but off the screen', () => {
      useAgentModeStore.setState({ enabled: true });
      render(<AgentModeToggle robotId={ROBOT_ID} />);

      const label = screen.getByTestId('agent-mode-label');
      // Still readable non-visually — the switch alone is not a label.
      expect(label).toHaveTextContent('Agent Mode on');
      expect(label).toHaveClass('sr-only');
    });

    it('puts the word back on screen when the state is unknown', () => {
      // A switch has no position for "unknown", so the word is the only thing
      // carrying it visually and must not be hidden with the other two.
      unreachable();
      render(<AgentModeToggle robotId={ROBOT_ID} />);

      const label = screen.getByTestId('agent-mode-label');
      expect(label).toHaveTextContent('Agent Mode unknown');
      expect(label).not.toHaveClass('sr-only');
    });
  });

  describe('robot unreachable', () => {
    it('says "unknown" instead of "off"', () => {
      unreachable();
      render(<AgentModeToggle robotId={ROBOT_ID} />);

      expect(screen.getByTestId('agent-mode-label')).toHaveTextContent('Agent Mode unknown');
      expect(screen.getByTestId('agent-mode-toggle')).toHaveAttribute(
        'data-state-unknown',
        'true'
      );
    });

    it('announces no switch position at all', () => {
      // ARIA switches are two-state: any `aria-checked` here would tell a screen
      // reader "off" about a mode nobody knows.
      unreachable();
      render(<AgentModeToggle robotId={ROBOT_ID} />);

      const toggle = screen.getByTestId('agent-mode-toggle');
      expect(toggle).not.toHaveAttribute('role', 'switch');
      expect(toggle).not.toHaveAttribute('aria-checked');
      expect(toggle).toHaveAccessibleName(/state unknown/i);
    });

    it('cannot be flipped — a click would re-invent the false display', async () => {
      unreachable();
      render(<AgentModeToggle robotId={ROBOT_ID} />);

      const toggle = screen.getByTestId('agent-mode-toggle');
      expect(toggle).toBeDisabled();
      await userEvent.click(toggle);

      expect(mockedApi.toggle).not.toHaveBeenCalled();
      expect(useAgentModeStore.getState().enabled).toBe(false);
    });

    it('stops claiming who owns the robot as well', () => {
      useAgentModeStore.setState({ controlOwner: 'agent' });
      unreachable();
      render(<AgentModeToggle robotId={ROBOT_ID} />);

      expect(screen.getByTestId('agent-control-owner')).toHaveTextContent('Unknown');
    });

    it('goes back to a real position once the robot answers', () => {
      unreachable();
      const { rerender } = render(<AgentModeToggle robotId={ROBOT_ID} />);
      expect(screen.getByTestId('agent-mode-label')).toHaveTextContent('unknown');

      act(() => {
        useAgentModeStore.setState({
          stateReachability: 'known',
          stateUnavailableReason: null,
          enabled: true,
        });
      });
      rerender(<AgentModeToggle robotId={ROBOT_ID} />);

      expect(screen.getByTestId('agent-mode-toggle')).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByTestId('agent-mode-label')).toHaveTextContent('Agent Mode on');
    });
  });
});
