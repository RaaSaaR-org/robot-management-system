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

  // Same rule as the STOPP button in BlockTimeline: a safety control has to be
  // hittable on a touch screen (>=44px, WCAG 2.5.5) — this is the button an
  // operator goes for while the robot is stopped in front of them.
  it('gives the reset a touch-sized target on coarse pointers', () => {
    latch('acknowledged');
    render(<EstopBanner onReset={() => {}} />);
    expect(screen.getByTestId('agent-estop-reset')).toHaveClass('pointer-coarse:min-h-11');
  });

  // The robot exists and could not be asked (server 502). With no state,
  // `estopActive` falls back to false — and a silent page then means "E-Stop
  // clear" to whoever is looking at it. It must say the opposite: we do not know.
  describe('robot unreachable', () => {
    const unknown = (reason: string | null = 'the robot agent could not be reached') =>
      useAgentModeStore.setState({
        stateReachability: 'unreachable',
        stateUnavailableReason: reason,
      });

    it('speaks up even though nothing is latched, damped or recovered', () => {
      unknown();
      render(<EstopBanner onReset={() => {}} />);

      const banner = screen.getByTestId('agent-state-unknown-banner');
      expect(banner).toBeVisible();
      expect(screen.getByTestId('agent-state-unknown-title')).toHaveTextContent(/UNKNOWN/);
      expect(screen.getByTestId('agent-state-unknown-detail')).toHaveTextContent(
        /the robot agent could not be reached/
      );
    });

    it('says in plain words that this is not "E-Stop clear"', () => {
      unknown();
      render(<EstopBanner onReset={() => {}} />);

      const detail = screen.getByTestId('agent-state-unknown-detail');
      expect(detail).toHaveTextContent(/not\s+.?E-Stop\s+clear/i);
      expect(detail).toHaveTextContent(/hardware E-Stop/i);
      // No claim about the latch in either direction.
      expect(screen.queryByTestId('agent-estop-banner')).toBeNull();
      expect(screen.queryByText(/stopped and damped/i)).toBeNull();
    });

    it('stays a status, not an alarm — an offline robot is an ordinary condition', () => {
      unknown();
      render(<EstopBanner onReset={() => {}} />);

      expect(screen.getByTestId('agent-state-unknown-banner')).toHaveAttribute('role', 'status');
    });

    it('works without a reason from the server', () => {
      unknown(null);
      render(<EstopBanner onReset={() => {}} />);

      expect(screen.getByTestId('agent-state-unknown-detail')).toHaveTextContent(
        /could not ask the robot for its state\./
      );
    });

    it('downgrades an earlier acknowledgement to "no longer confirmed"', () => {
      // The stop DID happen; "it is stopped and damped" is a present-tense
      // claim about a robot that has since gone quiet.
      latch('acknowledged');
      unknown();
      render(<EstopBanner onReset={() => {}} />);

      expect(screen.getByTestId('agent-estop-title')).toHaveTextContent(/no longer confirmed/i);
      expect(screen.queryByText(/stopped and damped/i)).toBeNull();
      // The latch itself is still shown — this console keeps refusing commands.
      expect(screen.getByTestId('agent-estop-detail')).toHaveTextContent(/stay refused/i);
    });

    /**
     * The clamp is `line-clamp-1`, so the FIRST sentence is the one an operator
     * reads without expanding anything — which is why every other notice on
     * this stack was re-ordered to lead with the actionable half.
     *
     * This one was not, and it led with "The robot confirmed this stop while it
     * was still reachable": the reassuring half on screen, and "whether it is
     * still stopped cannot be verified from here" hidden behind the disclosure,
     * with only the title carrying the truth. This notice is NOT alarm-grade
     * (`alwaysExpanded` is false for it), so the clamp really is what people see.
     */
    it('leads with the sentence the clamp will show, not with the reassuring one', () => {
      latch('acknowledged');
      unknown();
      render(<EstopBanner onReset={() => {}} />);

      const detail = screen.getByTestId('agent-estop-detail');
      // Collapsed by default — the prose stays in the DOM, only clamped.
      expect(detail).toHaveClass('line-clamp-1');
      expect(detail.textContent ?? '').toMatch(/^It is not answering now, so whether it is still stopped cannot be verified/);
      // The confirmation history is kept, just no longer first.
      expect(detail).toHaveTextContent(/confirmed this stop while it was still reachable/i);
    });

    it('keeps the reset control live so the operator can try', () => {
      // Try-and-report: a reset that does not land keeps the latch and reports
      // why, which is strictly better than a control that cannot be pressed.
      latch('acknowledged');
      unknown();
      render(<EstopBanner onReset={() => {}} />);

      expect(screen.getByTestId('agent-estop-reset')).toBeEnabled();
    });

    it('sits above the notices it qualifies', () => {
      unknown();
      useAgentModeStore.setState({ damped: true, fsmId: 1 });
      render(<EstopBanner onReset={() => {}} />);

      const banners = screen.getAllByTestId(/agent-(state-unknown|damped)-banner/);
      expect(banners.map((b) => b.getAttribute('data-testid'))).toEqual([
        'agent-state-unknown-banner',
        'agent-damped-banner',
      ]);
    });

    it('disappears once the robot answers again', () => {
      unknown();
      const { rerender } = render(<EstopBanner onReset={() => {}} />);
      expect(screen.getByTestId('agent-state-unknown-banner')).toBeVisible();

      act(() => {
        useAgentModeStore.setState({
          stateReachability: 'known',
          stateUnavailableReason: null,
        });
      });
      rerender(<EstopBanner onReset={() => {}} />);

      expect(screen.queryByTestId('agent-state-unknown-banner')).toBeNull();
    });
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

  // TASK-196: a robot that comes back latched after a restart must SAY so and
  // offer one click out. Without it the first operator who meets one deletes
  // the state file to "fix" it — which is worse than the bug.
  describe('recovered after a restart', () => {
    const recovered = (overrides: Partial<{ fromCrash: boolean; estopLatched: boolean }> = {}) =>
      useAgentModeStore.setState({
        recovered: {
          fromCrash: false,
          estopLatched: true,
          at: '2026-08-02T08:00:00.000Z',
          ...overrides,
        },
      });

    it('says the latch survived the restart, not that it was just pressed', () => {
      latch('acknowledged');
      recovered();
      render(<EstopBanner onReset={() => {}} />);

      const banner = screen.getByTestId('agent-recovered-banner');
      expect(banner).toBeVisible();
      expect(banner).toHaveAttribute('data-estop-latched', 'true');
      expect(screen.getByTestId('agent-recovered-title')).toHaveTextContent(/before the restart/i);
      expect(screen.getByTestId('agent-recovered-detail')).toHaveTextContent(/off disk/i);
    });

    it('warns the operator away from deleting the state file', () => {
      recovered();
      render(<EstopBanner onReset={() => {}} />);

      expect(screen.getByTestId('agent-recovered-detail')).toHaveTextContent(
        /do not delete the robot's state file/i
      );
    });

    it('clears it in one click, through the normal reset path', async () => {
      const onReset = vi.fn();
      latch('acknowledged');
      recovered();
      render(<EstopBanner onReset={onReset} />);

      await userEvent.click(screen.getByTestId('agent-recovered-reset'));

      expect(onReset).toHaveBeenCalledTimes(1);
    });

    it('gives the acknowledge button a touch-sized target on coarse pointers', () => {
      recovered();
      render(<EstopBanner onReset={() => {}} />);
      expect(screen.getByTestId('agent-recovered-reset')).toHaveClass('pointer-coarse:min-h-11');
    });

    it('reports an unclean shutdown even when nothing was latched', () => {
      recovered({ fromCrash: true, estopLatched: false });
      render(<EstopBanner onReset={() => {}} />);

      const banner = screen.getByTestId('agent-recovered-banner');
      expect(banner).toHaveAttribute('data-from-crash', 'true');
      expect(screen.getByTestId('agent-recovered-title')).toHaveTextContent(/unclean shutdown/i);
      expect(screen.getByTestId('agent-recovered-detail')).toHaveTextContent(
        /without a clean shutdown/i
      );
      // The one-click way out is offered even with no latch to clear.
      expect(screen.getByTestId('agent-recovered-reset')).toBeVisible();
    });

    it('shows up next to the damped notice without hiding it', () => {
      recovered({ fromCrash: true });
      useAgentModeStore.setState({ damped: true, fsmId: 1 });
      render(<EstopBanner onReset={() => {}} />);

      expect(screen.getByTestId('agent-recovered-banner')).toBeVisible();
      expect(screen.getByTestId('agent-damped-banner')).toBeVisible();
    });

    it('disappears once the agent reports it acknowledged', () => {
      recovered();
      const { rerender } = render(<EstopBanner onReset={() => {}} />);
      expect(screen.getByTestId('agent-recovered-banner')).toBeVisible();

      act(() => {
        useAgentModeStore.setState({ recovered: null });
      });
      rerender(<EstopBanner onReset={() => {}} />);

      expect(screen.queryByTestId('agent-recovered-banner')).toBeNull();
    });
  });

  // The stack is the whole safety surface of the page. Simultaneous conditions
  // are the normal case (a robot that crashed is usually also damped, and one
  // that went quiet is usually both), so a ranked strip that shows the worst one
  // and stops would silently drop the others.
  describe('condition stack', () => {
    it('renders every active notice, none folded into a summary', () => {
      useAgentModeStore.setState({
        stateReachability: 'unreachable',
        stateUnavailableReason: 'the robot agent could not be reached',
        recovered: { fromCrash: true, estopLatched: false, at: '2026-08-02T08:00:00.000Z' },
        damped: true,
        fsmId: 1,
      });
      render(<EstopBanner onReset={() => {}} />);

      const banners = screen.getAllByTestId(/agent-(state-unknown|recovered|damped)-banner/);
      expect(banners.map((b) => b.getAttribute('data-testid'))).toEqual([
        'agent-state-unknown-banner',
        'agent-recovered-banner',
        'agent-damped-banner',
      ]);
      // No "+2 more" anywhere: each notice says its own thing, in full.
      expect(screen.queryByText(/\bmore\b/)).toBeNull();
    });

    // The load-bearing rule of this redesign: collapsing is a CSS clamp, so the
    // sentences are in the DOM for a screen reader, a copy-paste and every
    // assertion above, whether or not anyone expanded the line.
    it('keeps the collapsed prose in the DOM and only clamps it', () => {
      useAgentModeStore.setState({ damped: true, fsmId: 1 });
      render(<EstopBanner onReset={() => {}} />);

      const detail = screen.getByTestId('agent-damped-detail');
      expect(detail).toHaveClass('line-clamp-1');
      expect(detail).toHaveTextContent(/clearing the E-Stop latch does not re-arm the base/i);
    });

    // "It may still be moving — use the hardware E-Stop" is an instruction, not
    // an explanation. An instruction is never one click away.
    it('renders an unconfirmed stop fully expanded, with no disclosure at all', () => {
      latch('unconfirmed', 'Damp rejected by sidecar');
      render(<EstopBanner onReset={() => {}} />);

      const detail = screen.getByTestId('agent-estop-detail');
      expect(detail).not.toHaveClass('line-clamp-1');
      expect(detail).toHaveTextContent(/use the hardware E-Stop/i);
      // Nothing to expand ⇒ no disclosure control of any kind on that line.
      expect(screen.queryByRole('checkbox')).toBeNull();
      expect(screen.queryByRole('button', { name: /details/i })).toBeNull();
    });

    it('lets the operator expand the tail of a collapsible notice', async () => {
      useAgentModeStore.setState({ damped: true, fsmId: 1 });
      render(<EstopBanner onReset={() => {}} />);

      const disclosure = screen.getByRole('checkbox', { name: /details/i });
      expect(disclosure).toHaveAttribute('aria-expanded', 'false');
      expect(screen.getByTestId('agent-damped-detail')).toHaveClass('line-clamp-1');

      await userEvent.click(disclosure);

      expect(disclosure).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByTestId('agent-damped-detail')).not.toHaveClass('line-clamp-1');
    });
  });

  // The console's own failed request: shown, dismissable, and the quietest line
  // on the stack — it says something about this browser tab, not about the robot.
  describe('failed request', () => {
    it('renders the error as the lowest-severity line, with a way to dismiss it', async () => {
      const onDismissError = vi.fn();
      render(
        <EstopBanner
          onReset={() => {}}
          error="Failed to reach the robot agent"
          onDismissError={onDismissError}
        />
      );

      expect(screen.getByTestId('agent-error-banner')).toHaveTextContent(
        'Failed to reach the robot agent'
      );

      await userEvent.click(screen.getByRole('button', { name: /dismiss error/i }));
      expect(onDismissError).toHaveBeenCalledTimes(1);
    });

    it('sits below the conditions that are about the robot', () => {
      useAgentModeStore.setState({ damped: true, fsmId: 1 });
      render(<EstopBanner onReset={() => {}} error="Failed to reach the robot agent" />);

      const banners = screen.getAllByTestId(/agent-(damped|error)-banner/);
      expect(banners.map((b) => b.getAttribute('data-testid'))).toEqual([
        'agent-damped-banner',
        'agent-error-banner',
      ]);
    });

    it('stays out of the way while there is no error', () => {
      const { container } = render(<EstopBanner onReset={() => {}} error={null} />);
      expect(container).toBeEmptyDOMElement();
    });

    /**
     * A failed HTTP request is not a claim about the robot. It used to render as
     * a red dot in a red-bordered card — the same shape and the same red as the
     * E-Stop alarm, in the same stack, two rows below it. `levelFor` grades it 1
     * with a comment saying that giving it safety colour is how colour stops
     * meaning anything; the rendering did it one level louder.
     */
    it('does not dress a failed request up as a safety condition', () => {
      render(<EstopBanner onReset={() => {}} error="Request failed with status code 500" />);

      const banner = screen.getByTestId('agent-error-banner');
      expect(banner.className).not.toMatch(/border-red/);
      // Neutral dot: no element inside this notice may carry the alarm red.
      expect(banner.querySelector('.bg-red-500')).toBeNull();
      // It still says whose failure it is, so it cannot be misread as the
      // robot's — and the message itself keeps the red.
      expect(banner).toHaveTextContent('Last request failed');
      expect(banner).toHaveTextContent('Request failed with status code 500');
    });
  });

  /**
   * With three notices up at once — the normal case, not the edge case — every
   * disclosure announced as "Details, checkbox, collapsed" with nothing to tell
   * them apart. `aria-controls` points at the detail span, but no screen reader
   * reads the controlled element's context on focus.
   */
  it('names each disclosure after the condition it belongs to', () => {
    useAgentModeStore.setState({
      stateReachability: 'unreachable',
      stateUnavailableReason: 'the robot agent could not be reached',
      damped: true,
      fsmId: 1,
    });
    render(<EstopBanner onReset={() => {}} />);

    // Still "Details" to the eye, and still findable by that word.
    expect(screen.getAllByRole('checkbox', { name: /details/i })).toHaveLength(2);
    // …but distinguishable, which is the whole point.
    expect(screen.getByRole('checkbox', { name: /Base damped/i })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /E-Stop state UNKNOWN/i })).toBeInTheDocument();
  });
});
