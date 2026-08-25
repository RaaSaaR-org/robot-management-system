/**
 * @file TourStopChip.test.tsx
 * @description The rail's host-mode chip (TASK-213): it names the stop a
 *              visitor is being shown, it says the same words the /tour banner
 *              says, and outside a tour it is not on the rail at all.
 * @feature agentmode
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TourStopChip } from '../TourStopChip';
import { BlockTimeline } from '../BlockTimeline';
import { useAgentModeStore } from '../../store/agentmodeStore';
import type { AgentBlock, AgentPlan } from '../../types/agentmode.types';

let seq = 0;
const block = (
  kind: AgentBlock['kind'],
  params: Record<string, unknown> = {},
  status: AgentBlock['status'] = 'done'
): AgentBlock => ({ id: `b${++seq}`, kind, params, status });

const plan = (blocks: AgentBlock[], status: AgentPlan['status'] = 'running'): AgentPlan => ({
  id: 'plan-1',
  robotId: 'sim-robot-g1-edu',
  command: 'Tour "ZeMA visitor tour"',
  blocks,
  cursor: blocks.findIndex((b) => b.status === 'running'),
  status,
  createdAt: '2026-08-25T10:00:00.000Z',
  updatedAt: '2026-08-25T10:00:00.000Z',
});

const TOUR = block('tour', { routeId: 'zema-visit', routeName: 'ZeMA visitor tour', stops: 4 }, 'running');

beforeEach(() => {
  useAgentModeStore.getState().reset();
});

describe('TourStopChip', () => {
  it('renders nothing when no tour is running', () => {
    // The rail is one line and STOPP lives at the end of it. A chip that said
    // "no tour" every day of the week would spend that width on nothing.
    const resting = render(<TourStopChip />);
    expect(screen.queryByTestId('agent-tour-stop')).toBeNull();
    resting.unmount();

    // …nor for a plan that is not a tour: a `walk` is not a visit.
    useAgentModeStore.setState({ plan: plan([block('walk', { distanceM: 1 }, 'running')]) });
    render(<TourStopChip />);
    expect(screen.queryByTestId('agent-tour-stop')).toBeNull();
  });

  it('names the stop the robot is standing at, in the words /tour uses', () => {
    // Byte-for-byte what `ActiveRunBanner` renders on the /tour page, because
    // both call `currentStopText`. An operator with both open is looking at one
    // robot and must not be told about it in two phrasings.
    useAgentModeStore.setState({
      plan: plan([
        TOUR,
        block('goto', { place: 'AISLE-1', stopId: 'stop-b', stopIndex: 2, stopName: 'Workstation' }),
        block(
          'present',
          { stopId: 'stop-b', stopIndex: 2, stopName: 'Workstation', text: 'Hier arbeite ich.', chunk: 1, of: 2 },
          'running'
        ),
      ]),
    });

    render(<TourStopChip />);

    expect(screen.getByTestId('agent-tour-stop')).toHaveTextContent('at stop 2: Workstation');
  });

  it('carries the route it belongs to without spending rail width on it', () => {
    useAgentModeStore.setState({
      plan: plan([
        TOUR,
        block('present', { stopId: 'stop-a', stopIndex: 1, stopName: 'Reception' }, 'running'),
      ]),
    });

    render(<TourStopChip />);

    // The name of the tour reaches a screen reader and a hover, and it is NOT
    // repeated in the visible text — the stop is what the chip is for.
    const chip = screen.getByTestId('agent-tour-stop');
    expect(chip.getAttribute('title')).toContain('ZeMA visitor tour');
    expect(chip).toHaveTextContent('Tour “ZeMA visitor tour” · 4 stops');
    expect(chip.textContent?.match(/at stop 1: Reception/g)).toHaveLength(1);
  });

  it('falls back to the tour itself while the robot is between stops', () => {
    // Before the first stop and on the walk home there is no stop to name. The
    // chip still says a tour is running: that is the fact the rail was missing.
    useAgentModeStore.setState({
      plan: plan([TOUR, block('speak', { text: 'Sie sprechen mit einer KI.', disclosure: true }, 'running')]),
    });

    render(<TourStopChip />);

    const chip = screen.getByTestId('agent-tour-stop');
    expect(chip).toHaveTextContent('ZeMA visitor tour');
    expect(chip).toHaveTextContent('between stops');
    expect(chip).toHaveAttribute('data-tour-stop', 'none');
  });

  it('leaves the rail when the tour ends', () => {
    useAgentModeStore.setState({
      plan: plan([TOUR, block('speak', { text: 'Danke für Ihren Besuch!' })], 'done'),
    });

    render(<TourStopChip />);

    expect(screen.queryByTestId('agent-tour-stop')).toBeNull();
  });

  it('rides in the rail as `leading`, and gives way before STOPP does', () => {
    // The chip belongs to the page's leading group, not to `BlockTimeline` —
    // and it has to obey that group's rule: shrink and truncate rather than
    // push the emergency stop towards the edge of the card.
    useAgentModeStore.setState({
      plan: plan([
        TOUR,
        block('present', { stopId: 'stop-a', stopIndex: 1, stopName: 'Reception' }, 'running'),
      ]),
    });

    render(<BlockTimeline onStop={() => {}} leading={<TourStopChip />} />);

    const chip = screen.getByTestId('agent-tour-stop');
    expect(screen.getByTestId('agent-block-timeline')).toContainElement(chip);
    expect(chip).toHaveClass('min-w-0');
    expect(chip).not.toHaveClass('shrink-0');
    expect(chip).not.toHaveClass('whitespace-nowrap');
  });
});
