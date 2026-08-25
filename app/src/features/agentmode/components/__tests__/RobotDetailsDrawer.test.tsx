/**
 * @file RobotDetailsDrawer.test.tsx
 * @description The drawer the identity chip opens. Two things are on trial
 *              here: the incarnation honesty rules that MOVED out of
 *              SelfHeader when the rail was cut down (a lower bound must not be
 *              rendered as an ordinal), and the condition checklist, which is
 *              the only reason a page with no badges on it can be believed.
 * @feature agentmode
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RobotDetailsDrawer } from '../RobotDetailsDrawer';
import { useAgentModeStore } from '../../store/agentmodeStore';
import {
  CONDITION_CLEAR_HEADLINE,
  CONDITION_LABELS,
  CONDITION_ORDER,
} from '../../utils/conditions';
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

function open(over: Partial<AgentSelfState> = {}) {
  useAgentModeStore.setState({ self: self(over) });
  return render(<RobotDetailsDrawer isOpen onClose={() => {}} robotId="sim-robot-g1-edu" />);
}

beforeEach(() => {
  useAgentModeStore.getState().reset();
});

describe('RobotDetailsDrawer', () => {
  it('renders nothing while it is closed', () => {
    useAgentModeStore.setState({ self: self() });
    render(<RobotDetailsDrawer isOpen={false} onClose={() => {}} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('says which robot this is, and which life it is on', () => {
    open({ operator: 'Sebastian', site: 'Robot Lab' });

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Unitree G1 EDU (Dex3-1)');
    expect(dialog).toHaveTextContent('incarnation 47');
    expect(dialog).toHaveTextContent('Sebastian');
    expect(dialog).toHaveTextContent('Robot Lab');
    // Nothing here may imply a plan outlives the session that made it.
    expect(dialog).toHaveTextContent('Plans are ephemeral and never persisted.');
  });

  /**
   * MOVED from SelfHeader.test.tsx when the clause line was cut — the rule is
   * unchanged and so is this test's reason for existing.
   *
   * The lineage file is a ring buffer, and a count derived from a line's index
   * in it decreases whenever rotation discards a line (observed live: 199 →
   * 197 across a restart). The robot now carries a true lifetime ordinal — but
   * where it can only supply a lower bound, this must not be presented as an
   * ordinal, because "incarnation 197" reads as a count of starts.
   */
  it('renders a lower-bound boot count as a lower bound, not as an ordinal', () => {
    open({ incarnation: 197, incarnationExact: false });

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('at least 197 starts');
    expect(dialog).not.toHaveTextContent('incarnation 197');
  });

  it('treats a snapshot from an agent that reports no exactness as a lower bound', () => {
    // An older robot-agent computed the number from the rotating file, so a
    // missing flag means "floor", never "exact".
    const legacy = self({ incarnation: 88 });
    delete legacy.incarnationExact;
    useAgentModeStore.setState({ self: legacy });
    render(<RobotDetailsDrawer isOpen onClose={() => {}} />);

    expect(screen.getByRole('dialog')).toHaveTextContent('at least 88 starts');
  });

  it('renders a field the identity card does not carry as "not set", not as blank', () => {
    open({ operator: null, site: null });
    // "not set" is a different answer from "unknown", and both are different
    // from an empty cell the eye fills in on the operator's behalf.
    expect(screen.getAllByText('not set').length).toBeGreaterThanOrEqual(2);
  });

  it('does not invent an identity for a robot that has not reported one', () => {
    render(<RobotDetailsDrawer isOpen onClose={() => {}} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('has not reported who it is');
    expect(dialog).not.toHaveTextContent('incarnation');
  });

  /**
   * THE ALL-CLEAR CHECKLIST. Badges that only appear when something is wrong
   * cannot be told apart from badges that are broken, so every condition is
   * listed with its current value — the false ones especially. A cap, a filter
   * or a "+n more" here would quietly reintroduce exactly that ambiguity.
   */
  describe('the condition checklist', () => {
    it('lists every condition, including the ones that are clear', () => {
      open();

      const dialog = screen.getByRole('dialog');
      for (const key of CONDITION_ORDER) {
        expect(dialog).toHaveTextContent(CONDITION_LABELS[key]);
        // Each false condition says what IT is, not a shared word. See the
        // regression below for why one word for every row is not good enough.
        expect(screen.getByText(CONDITION_CLEAR_HEADLINE[key])).toBeInTheDocument();
      }
    });

    /**
     * The section's copy promises a COUNT ("All eight, whether they are true or
     * not"), and that promise is the only reason a calm checklist can be read as
     * "nothing is wrong" rather than "this list is broken". TASK-201 added an
     * eighth row under a paragraph that still said seven, which turns the one
     * check this section exists to support into the wrong answer.
     *
     * So the number is rendered FROM the list and this pins the two together.
     * Re-typing a literal here or in the component is the failure mode.
     */
    it('promises exactly as many rows as it renders', () => {
      open();

      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveTextContent(
        `All ${CONDITION_ORDER.length}, whether they are true or not`
      );
      expect(dialog.querySelectorAll('ul > li').length).toBeGreaterThanOrEqual(
        CONDITION_ORDER.length
      );
    });

    it('names the ones that are true, and still lists the rest as clear', () => {
      useAgentModeStore.setState({ self: self({ damped: true }), damped: true });
      render(<RobotDetailsDrawer isOpen onClose={() => {}} />);

      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveTextContent('damped — it cannot walk, turn or go to');
      // Every other condition is false and every one of them still says so.
      for (const key of CONDITION_ORDER) {
        if (key === 'damped') continue;
        expect(screen.getByText(CONDITION_CLEAR_HEADLINE[key])).toBeInTheDocument();
      }
    });

    /**
     * The checklist's whole job is to let an operator tell "this badge is absent
     * because the condition is false" from "this badge is absent because the page
     * is broken". It fails that job the moment a row looks like it contradicts a
     * badge that IS on screen.
     *
     * `recovered` is the trap: it means "there is an UNACKNOWLEDGED recovery
     * record", not "this boot followed a crash". Acknowledge the crash and the
     * condition goes false while the rail keeps saying "recovered from crash" —
     * correctly, because the crash still happened. Rendering that row as the bare
     * word "clear" reads as "no crash", and the operator is left choosing which
     * of two true statements to disbelieve.
     */
    it('does not read as "no crash happened" once a crash has been acknowledged', () => {
      useAgentModeStore.setState({
        // The crash is history and still shown on the rail...
        self: self({ lastShutdown: { at: '2026-08-02T09:00:00.000Z', exit: 'crash', place: null } }),
        // ...but there is nothing left to acknowledge.
        recovered: null,
      });
      render(<RobotDetailsDrawer isOpen onClose={() => {}} />);

      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveTextContent('nothing unacknowledged');
      expect(dialog).not.toHaveTextContent('Boot recovery clear');
    });
  });
});
