/**
 * @file SelfHeader.test.tsx
 * @description The identity chip that says which robot this is (TASK-198) — and
 *              the things it must never do: hide a crash the operator has to act
 *              on, dress a cached snapshot up as a live one, or render the place
 *              belief a second time (PlaceChip owns it, and two renderers of one
 *              belief drift).
 * @feature agentmode
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SelfHeader } from '../SelfHeader';
import { useAgentModeStore } from '../../store/agentmodeStore';
import type { AgentSelfState } from '../../types/agentmode.types';

function self(over: Partial<AgentSelfState> = {}): AgentSelfState {
  return {
    name: 'Nova',
    emoji: null,
    unit: 'Unitree G1 EDU (Dex3-1)',
    robotId: 'sim-robot-g1-edu',
    operator: null,
    site: null,
    bootstrapRequired: false,
    bootId: 'b-now',
    incarnation: 47,
    incarnationExact: true,
    uptimeS: 120,
    lastShutdown: null,
    place: 'AISLE-3',
    poseSource: 'odometry',
    batteryPct: 71,
    controlOwner: 'idle',
    damped: false,
    estopLatched: false,
    plansLast24h: 3,
    failuresLast24h: 1,
    memoryEntries: 2,
    ...over,
  };
}

beforeEach(() => {
  useAgentModeStore.getState().reset();
});

describe('SelfHeader', () => {
  it('renders nothing while the agent reports no self and no robot is bound', () => {
    const { container } = render(<SelfHeader />);
    // Absent means "this agent does not report a self", which must not be
    // rendered as a robot with placeholder facts.
    expect(container).toBeEmptyDOMElement();
  });

  /**
   * A robot that has never answered this console is the state in which the
   * condition checklist matters MOST — and it was the state in which the drawer
   * became unreachable, because its only trigger is the robot's name and there
   * is no name to click. "No badges on the rail" then could not be told apart
   * from "the badges are broken", which is the exact ambiguity the checklist
   * exists to resolve.
   *
   * No identity is invented for it: the trigger says what it opens.
   */
  it('still opens the details drawer for a bound robot that has said nothing', async () => {
    render(<SelfHeader robotId="sim-robot-g1-edu" />);

    expect(screen.queryByTestId('agent-self-name')).toBeNull();
    const trigger = screen.getByRole('button', { name: /robot details/i });
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');

    await userEvent.click(trigger);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeVisible();
    // The drawer's own `!self` branch — no placeholder facts there either.
    expect(dialog).toHaveTextContent(/has not reported who it is/i);
    // …and the all-clear checklist is reachable, which is the point.
    expect(dialog).toHaveTextContent('Robot reachable');
  });

  it('says who the robot is', () => {
    useAgentModeStore.setState({ self: self() });
    render(<SelfHeader />);

    expect(screen.getByTestId('agent-self-name')).toHaveTextContent('Nova');
    expect(screen.queryByTestId('agent-self-crash')).toBeNull();
  });

  /**
   * THE SINGLE-RENDERER RULE for the place belief.
   *
   * This line used to carry `· AISLE-3` / `· place unknown` beside the scene
   * panel's own copy. Two renderers of one belief drift, and this is the belief
   * where drift means an operator sends a robot from the wrong room — so
   * `PlaceChip` is now the only thing that renders it (see PlaceChip.test.tsx,
   * which owns the unknown-is-rendered-as-unknown guarantee).
   *
   * This test fails the moment somebody puts the place back on this line.
   */
  it('does not render the place — PlaceChip is the single renderer of that belief', () => {
    useAgentModeStore.setState({ self: self({ place: 'AISLE-3' }) });
    render(<SelfHeader />);
    expect(screen.getByTestId('agent-self-header')).not.toHaveTextContent('AISLE-3');

    // ...and the unknown half of the same rule: no second "place unknown".
    act(() => {
      useAgentModeStore.setState({ self: self({ place: null }) });
    });
    expect(screen.getByTestId('agent-self-header')).not.toHaveTextContent(/place unknown/i);
  });

  /**
   * The numbers the freshness clause qualifies are never readable without it.
   * Moving them into the drawer is what buys the rail back; keeping them OUT of
   * this line is the half of that bargain a future edit is likely to undo.
   * (Their honesty rules are tested at their new home:
   * RobotDetailsDrawer.test.tsx.)
   */
  it('leaves the incarnation, operator and site to the details drawer', () => {
    useAgentModeStore.setState({
      self: self({ incarnation: 197, incarnationExact: false, operator: 'Sebastian', site: 'Robot Lab' }),
    });
    render(<SelfHeader />);

    const header = screen.getByTestId('agent-self-header');
    expect(header).not.toHaveTextContent(/starts/);
    expect(header).not.toHaveTextContent(/incarnation/);
    expect(header).not.toHaveTextContent('Sebastian');
    expect(header).not.toHaveTextContent('Robot Lab');
  });

  // The chip is the door into everything it stopped saying out loud — above
  // all the condition checklist, which is what lets an operator verify that a
  // calm rail is calm because the conditions are false, not because it broke.
  describe('the details drawer', () => {
    it('opens from the robot’s name', async () => {
      useAgentModeStore.setState({ self: self() });
      render(<SelfHeader />);

      const name = screen.getByTestId('agent-self-name');
      expect(name).toHaveAttribute('aria-haspopup', 'dialog');
      await userEvent.click(name);

      expect(screen.getByRole('dialog')).toBeVisible();
      expect(screen.getByText('incarnation 47')).toBeVisible();
    });

    /**
     * AMENDMENT A — the name trigger and the "name it" badge are SIBLINGS. A
     * button nested in a button is invalid markup and leaves keyboard and
     * screen-reader users unable to reach the inner one, and no amount of
     * stopPropagation fixes that.
     */
    it('never nests the naming badge inside the chip trigger', () => {
      useAgentModeStore.setState({ self: self({ bootstrapRequired: true }) });
      render(<SelfHeader robotId="sim-robot-g1-edu" />);

      const name = screen.getByTestId('agent-self-name');
      const unnamed = screen.getByTestId('agent-self-unnamed');
      expect(name.contains(unnamed)).toBe(false);
      expect(unnamed.closest('button')).toBe(unnamed);
    });
  });

  it('marks a recovered crash distinctly — it is the field an operator acts on', () => {
    useAgentModeStore.setState({
      self: self({ lastShutdown: { at: null, exit: 'crash', place: 'AISLE-3' } }),
    });
    render(<SelfHeader />);

    const crash = screen.getByTestId('agent-self-crash');
    expect(crash).toHaveTextContent('recovered from crash in AISLE-3');
    expect(crash.className).toMatch(/amber/);
  });

  it('does not call a clean shutdown a crash', () => {
    useAgentModeStore.setState({
      self: self({ lastShutdown: { at: '2026-08-02T09:40:00.000Z', exit: 'sigterm', place: null } }),
    });
    render(<SelfHeader />);
    expect(screen.queryByTestId('agent-self-crash')).toBeNull();
  });

  it('says the robot has not been named yet', () => {
    useAgentModeStore.setState({ self: self({ bootstrapRequired: true, name: 'G1-EDU-Bot' }) });
    render(<SelfHeader />);
    expect(screen.getByTestId('agent-self-unnamed')).toHaveTextContent('not named yet');
  });

  // TASK-198: the badge is the door into the naming ritual. A robot that is
  // asking to be named has to be nameable from the surface that says so.
  describe('naming an un-bootstrapped robot', () => {
    it('opens the identity form from the badge', async () => {
      useAgentModeStore.setState({ self: self({ bootstrapRequired: true }) });
      render(<SelfHeader robotId="sim-robot-g1-edu" />);

      await userEvent.click(screen.getByTestId('agent-self-unnamed'));

      expect(screen.getByTestId('agent-identity-name')).toBeVisible();
      expect(screen.getByTestId('agent-identity-save')).toBeVisible();
    });

    it('offers nothing to click while no robot is bound', () => {
      useAgentModeStore.setState({ self: self({ bootstrapRequired: true }) });
      render(<SelfHeader robotId={null} />);

      expect(screen.getByTestId('agent-self-unnamed')).toBeDisabled();
    });
  });

  // The state on this page comes from the SERVER's mirror, which only moves
  // when the robot pushes — it has been observed a whole incarnation behind the
  // robot. The line must not present a cached fact as a live one.
  describe('freshness', () => {
    it('says how old the snapshot is without shouting while it is fresh', () => {
      useAgentModeStore.setState({
        self: self(),
        selfUpdatedAt: new Date().toISOString(),
        selfLive: true,
      });
      render(<SelfHeader />);

      const freshness = screen.getByTestId('agent-self-freshness');
      expect(freshness).toHaveAttribute('data-stale', 'false');
      expect(freshness).toHaveTextContent(/just now|s ago/);
      // Quiet: a badge that always warns is a badge nobody reads.
      expect(freshness.className).not.toMatch(/amber/);
    });

    it('calls an old mirror read cached, visibly', () => {
      useAgentModeStore.setState({
        self: self(),
        selfUpdatedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
        selfLive: false,
      });
      render(<SelfHeader />);

      const freshness = screen.getByTestId('agent-self-freshness');
      expect(freshness).toHaveAttribute('data-stale', 'true');
      expect(freshness).toHaveAttribute('data-live', 'false');
      expect(freshness).toHaveTextContent(/cached/);
      expect(freshness).toHaveTextContent(/5 min ago/);
      expect(freshness.className).toMatch(/amber/);
    });

    it('says nothing at all before the first snapshot is stamped', () => {
      // A self set by something that did not record when it arrived must not be
      // dressed up with an invented age.
      useAgentModeStore.setState({ self: self(), selfUpdatedAt: null });
      render(<SelfHeader />);

      expect(screen.queryByTestId('agent-self-freshness')).toBeNull();
    });

    // TASK-200 — THE regression test for the bug that was actually observed.
    // The mirror held a 68-minute-old snapshot pushed by a duplicate agent that
    // had since died; the store stamped its own fetch time, so this line read
    // "· just now" beside a dead process's incarnation, battery and uptime.
    // It is now dated by the server's `mirroredAt` and must go amber.
    it('renders an OLD mirror snapshot as stale, not as "just now"', () => {
      useAgentModeStore.setState({
        self: self({ incarnation: 200, uptimeS: 0, batteryPct: 79 }),
        // What GET /agent-mode reported: the server last heard from this robot
        // 68 minutes ago.
        selfUpdatedAt: new Date(Date.now() - 68 * 60_000).toISOString(),
        selfLive: false,
      });
      render(<SelfHeader />);

      const freshness = screen.getByTestId('agent-self-freshness');
      expect(freshness).toHaveAttribute('data-stale', 'true');
      expect(freshness).toHaveAttribute('data-live', 'false');
      expect(freshness).toHaveTextContent(/cached/);
      expect(freshness).not.toHaveTextContent(/just now/);
      expect(freshness.className).toMatch(/amber/);
    });

    it('renders a mirror read the server could not date as an unknown age', () => {
      // "We do not know how old this is" is not better news than "five minutes
      // old", and it must never look like fresh.
      useAgentModeStore.setState({
        self: self(),
        selfUpdatedAt: null,
        selfLive: false,
        selfAgeUnknown: true,
      });
      render(<SelfHeader />);

      const freshness = screen.getByTestId('agent-self-freshness');
      expect(freshness).toHaveAttribute('data-stale', 'true');
      expect(freshness).toHaveTextContent(/age unknown/);
      expect(freshness).not.toHaveTextContent(/just now/);
      expect(freshness.className).toMatch(/amber/);
    });
  });

  // A mirrored self from a different bootId is not a stale reading of this
  // robot — it is another process's reading. That is what the observed defect
  // put on screen for over an hour.
  describe('a snapshot from a different process', () => {
    it('names it, rather than calling it merely old', () => {
      useAgentModeStore.setState({
        self: self({ bootId: 'b-56cb257f5ffc', incarnation: 200 }),
        selfUpdatedAt: new Date(Date.now() - 68 * 60_000).toISOString(),
        selfLive: false,
        selfLiveBootId: 'b-50a41c128583',
        selfSuperseded: true,
      });
      render(<SelfHeader />);

      const badge = screen.getByTestId('agent-self-superseded');
      expect(badge).toHaveTextContent(/different process/);
      expect(badge.className).toMatch(/amber/);
    });

    it('stays quiet while the mirror agrees with the process that answered', () => {
      useAgentModeStore.setState({
        self: self({ bootId: 'b-now' }),
        selfUpdatedAt: new Date().toISOString(),
        selfLive: false,
        selfLiveBootId: 'b-now',
        selfSuperseded: false,
      });
      render(<SelfHeader />);

      expect(screen.queryByTestId('agent-self-superseded')).toBeNull();
    });

    // A reviewer's find: the badge used to be derived from the two bootIds
    // alone, so a FRESH mirror read after the agent restarted was flagged
    // beside a "just now" — an amber warning pointing at the live process and
    // treating the dead one as the reference. Whether a snapshot is a leftover
    // is decided by the store as it arrives (`isSupersededSnapshot`); this line
    // never claims it on its own.
    it('never contradicts a fresh reading', () => {
      useAgentModeStore.setState({
        self: self({ bootId: 'b-restarted' }),
        selfUpdatedAt: new Date().toISOString(),
        selfLive: false,
        // Our memory of who last answered is the out-of-date half here.
        selfLiveBootId: 'b-before-the-restart',
        selfSuperseded: false,
      });
      render(<SelfHeader />);

      expect(screen.getByTestId('agent-self-freshness')).toHaveAttribute('data-stale', 'false');
      expect(screen.queryByTestId('agent-self-superseded')).toBeNull();
    });
  });
});
