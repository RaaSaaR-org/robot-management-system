/**
 * @file BlockTimeline.test.tsx
 * @description Tests for the execution bar — STOPP is the one control that
 *              always works, so it must stay a >=44px touch target on coarse
 *              pointers (Apple HIG / WCAG 2.5.5).
 * @feature agentmode
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BlockTimeline } from '../BlockTimeline';
import { useAgentModeStore } from '../../store/agentmodeStore';
import type { AgentPlan } from '../../types/agentmode.types';

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

  it('says so when there is no plan instead of rendering an empty rail', () => {
    // A rail that renders nothing is indistinguishable from a rail that broke,
    // so the resting page states the absence. `agent-mode.spec.ts` asserts both
    // this string and the attribute on the resting page.
    render(<BlockTimeline onStop={() => {}} />);

    const rail = screen.getByTestId('agent-block-timeline');
    expect(rail).toHaveAttribute('data-plan-status', 'none');
    expect(rail).toHaveTextContent('No active plan');
  });

  it('renders `leading` inside the rail, ahead of STOPP', () => {
    // The identity and place chips ride in the rail rather than in rows of
    // their own — so they have to be INSIDE the timeline element, which is what
    // the e2e suite scopes its block-chip queries to.
    render(
      <BlockTimeline
        onStop={() => {}}
        leading={<span data-testid="leading-probe">Nova</span>}
      />
    );

    const rail = screen.getByTestId('agent-block-timeline');
    expect(rail).toContainElement(screen.getByTestId('leading-probe'));
    expect(rail).toContainElement(screen.getByTestId('agent-stop-button'));
  });

  it('keeps STOPP out of the horizontally scrolling group', () => {
    // The one control that always works must never be the thing an operator has
    // to scroll sideways to find: only the block group may scroll, and STOPP is
    // `shrink-0` and ordered onto the first row at every width.
    render(<BlockTimeline onStop={() => {}} />);

    const stop = screen.getByTestId('agent-stop-button');
    expect(stop).toHaveClass('shrink-0');
    expect(stop.closest('.overflow-x-auto')).toBeNull();
  });

  /**
   * THE CLIPPING REGRESSION.
   *
   * `.glass-card` sets `overflow: hidden`, and the rail is a flex row that ends
   * in STOPP. With the root left as a clipper, a `leading` group too wide for
   * the card pushed the emergency stop past the right edge, where it was
   * invisible AND unclickable — no scrollbar, because `hidden` is not `auto`,
   * and no `disabled` state to hint that it had gone. Reproduced at 1024px with
   * the sidebar expanded and a robot carrying a crash badge and a superseded
   * badge.
   *
   * jsdom computes no Tailwind styles, so the class tokens are the contract.
   * Three of them together are what make the failure impossible:
   */
  describe('nothing on the rail can be clipped away', () => {
    it('does not let the card clip its own contents', () => {
      render(<BlockTimeline onStop={() => {}} />);

      const rail = screen.getByTestId('agent-block-timeline');
      // Explicitly overrides `.glass-card { overflow: hidden }`.
      expect(rail).toHaveClass('overflow-visible');
      expect(rail).not.toHaveClass('overflow-hidden');
      // A FIXED height is the vertical version of the same bug: content that
      // wraps then has nowhere to go. `min-h-11` keeps the 44px touch row.
      expect(rail).toHaveClass('min-h-11');
      expect(rail).not.toHaveClass('h-11');
    });

    it('lets the leading group yield before STOPP does', () => {
      render(
        <BlockTimeline
          onStop={() => {}}
          leading={<span data-testid="leading-probe">Nova</span>}
        />
      );

      const group = screen.getByTestId('leading-probe').parentElement!;
      // Capped, so flex line-breaking always leaves room for STOPP beside it…
      expect(group.className).toMatch(/max-w-\[calc\(100%-/);
      // …and able to give way rather than shoving the button off the card.
      expect(group).not.toHaveClass('shrink-0');
      expect(group).not.toHaveClass('whitespace-nowrap');
      expect(group).toHaveClass('min-w-0');
      expect(group).toHaveClass('flex-wrap');
    });

    it('wraps rather than scrolling the rail sideways', () => {
      // Over-wide content is allowed to become a second row. It is never
      // allowed to become a horizontal scroll the stop button hides inside.
      render(<BlockTimeline onStop={() => {}} />);

      const rail = screen.getByTestId('agent-block-timeline');
      expect(rail).toHaveClass('flex-wrap');
      expect(rail).not.toHaveClass('overflow-x-auto');
    });
  });

  it('gives STOPP an accessible name that contains the word on the button', () => {
    // WCAG 2.5.3 (Label in Name): a voice-control user says what they can see.
    // "click STOPP" must match, so the name is a SUPERSET of the visible text —
    // the old `aria-label="Emergency stop"` replaced it and matched nothing.
    render(<BlockTimeline onStop={() => {}} />);

    const stop = screen.getByTestId('agent-stop-button');
    expect(stop).toHaveTextContent('STOPP');
    expect(stop.getAttribute('aria-label')).toContain('STOPP');
    expect(screen.getByRole('button', { name: /STOPP/ })).toBe(stop);
  });
  // =========================================================================
  // HOW LONG IT HAS BEEN PLANNING (TASK-202)
  // =========================================================================
  //
  // A wedged local model and a slow one both render as "Planning". The counter
  // is what turns "is it stuck?" into a question an operator can answer without
  // reading a log on the robot.

  describe('the planning counter', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    const planningPlan = (createdAt: string) =>
      ({
        id: 'plan-1',
        robotId: 'robot-1',
        command: 'geh zum Tisch',
        blocks: [],
        cursor: -1,
        status: 'planning',
        createdAt,
        updatedAt: createdAt,
      }) as unknown as AgentPlan;

    it('counts up while the plan is still being planned', async () => {
      useAgentModeStore.setState({ plan: planningPlan(new Date().toISOString()) });
      render(<BlockTimeline onStop={() => {}} />);

      const before = screen.getByTestId('agent-planning-elapsed').textContent;

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });

      const after = screen.getByTestId('agent-planning-elapsed').textContent;
      expect(after).not.toBe(before);
      expect(after).toMatch(/5\.\ds/);
    });

    it('prefers this console own send stamp over the robot clock', async () => {
      // The robot says the plan is 10 minutes old because its clock is ahead;
      // this tab knows it sent the command two seconds ago. The browser-frame
      // stamp wins, so the counter measures elapsed time rather than skew.
      const robotClockAhead = new Date(Date.now() - 600_000).toISOString();
      useAgentModeStore.setState({
        plan: planningPlan(robotClockAhead),
        pendingCommand: {
          planId: 'plan-1',
          text: 'geh zum Tisch',
          robotId: 'robot-1',
          sentAt: new Date(Date.now() - 2_000).toISOString(),
        },
      });
      render(<BlockTimeline onStop={() => {}} />);

      expect(screen.getByTestId('agent-planning-elapsed')).toHaveTextContent(/2\.\ds/);
    });

    it('never runs backwards when the robot clock is ahead', async () => {
      // A plan stamped in the future would otherwise render a negative value,
      // or a counter that ticks DOWN towards zero.
      useAgentModeStore.setState({
        plan: planningPlan(new Date(Date.now() + 30_000).toISOString()),
      });
      render(<BlockTimeline onStop={() => {}} />);

      expect(screen.getByTestId('agent-planning-elapsed')).toHaveTextContent('0ms');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000);
      });

      expect(screen.getByTestId('agent-planning-elapsed')).toHaveTextContent('0ms');
    });

    it('shows nothing once the plan is running', () => {
      useAgentModeStore.setState({
        plan: { ...planningPlan(new Date().toISOString()), status: 'running' } as AgentPlan,
      });
      render(<BlockTimeline onStop={() => {}} />);

      expect(screen.queryByTestId('agent-planning-elapsed')).toBeNull();
    });

    it('stays out of the page live region', () => {
      // The page announces through ConditionAnnouncer alone. A per-second
      // counter inside a live region would re-announce the rail every tick.
      useAgentModeStore.setState({ plan: planningPlan(new Date().toISOString()) });
      render(<BlockTimeline onStop={() => {}} />);

      const rail = screen.getByTestId('agent-block-timeline');
      expect(rail.querySelector('[aria-live]')).toBeNull();
      expect(rail.getAttribute('aria-live')).toBeNull();
    });
  });
});
