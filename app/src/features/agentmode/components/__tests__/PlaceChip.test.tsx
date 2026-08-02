/**
 * @file PlaceChip.test.tsx
 * @description Guards the single-renderer rule and the one thing this chip
 *              exists to prevent: an unknown place being answered with the last
 *              place the robot was in, which is a name somebody walks towards.
 * @feature agentmode
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PlaceChip } from '../PlaceChip';
import { useAgentModeStore } from '../../store/agentmodeStore';
import type {
  AgentMemoryDigest,
  AgentSelfState,
  SceneMemory,
  ScenePlace,
} from '../../types/agentmode.types';

const place = (over: Partial<ScenePlace> = {}): ScenePlace => ({
  id: 'AISLE-3',
  name: 'Aisle 3',
  placeType: 'aisle',
  confidence: 'confident',
  source: 'surveyed',
  ...over,
});

const scene = (over: Partial<SceneMemory> = {}): SceneMemory => ({
  robotId: 'sim-robot-g1-edu',
  currentView: 'a table with a hat on it',
  entities: [],
  personVisible: false,
  place: null,
  updatedAt: new Date().toISOString(),
  ...over,
});

const self = (over: Partial<AgentSelfState> = {}): AgentSelfState => ({
  name: 'Nova',
  emoji: null,
  unit: 'Unitree G1 EDU (Dex3-1)',
  robotId: 'sim-robot-g1-edu',
  operator: null,
  site: null,
  bootstrapRequired: false,
  bootId: 'b-now',
  incarnation: 47,
  uptimeS: 120,
  lastShutdown: null,
  place: null,
  poseSource: 'odometry',
  batteryPct: 71,
  controlOwner: 'idle',
  damped: false,
  estopLatched: false,
  plansLast24h: 0,
  failuresLast24h: 0,
  memoryEntries: 0,
  ...over,
});

const digest = (over: Partial<AgentMemoryDigest> = {}): AgentMemoryDigest => ({
  robotId: 'sim-robot-g1-edu',
  place: null,
  memoryBytes: 0,
  memoryMaxBytes: 8192,
  memoryEntries: 0,
  places: [],
  journalDays: [],
  retention: null,
  updatedAt: new Date().toISOString(),
  ...over,
});

beforeEach(() => {
  useAgentModeStore.getState().reset();
});

describe('PlaceChip', () => {
  it('renders even when nothing is known — an absent chip would read as "not applicable"', () => {
    render(<PlaceChip />);

    const chip = screen.getByTestId('agent-scene-place');
    expect(chip).toHaveAttribute('data-place-known', 'no');
    expect(chip).toHaveTextContent('Place unknown');
  });

  // The whole point of the belief: UNKNOWN is answered as unknown, never with
  // the perfectly good place name sitting two fields away in the same store.
  it('never answers an unknown place with a name from somewhere else', () => {
    useAgentModeStore.setState({
      scene: scene({ place: null }),
      self: self({ place: 'AISLE-3' }),
      memory: digest({ place: 'AISLE-3' }),
    });
    render(<PlaceChip />);

    const chip = screen.getByTestId('agent-scene-place');
    expect(chip).toHaveAttribute('data-place-known', 'no');
    expect(chip).toHaveTextContent('Place unknown');
    expect(chip).not.toHaveTextContent('AISLE-3');
    expect(chip).not.toHaveTextContent('Aisle 3');
  });

  it('renders a known place with its name and its confidence', () => {
    useAgentModeStore.setState({ scene: scene({ place: place() }) });
    render(<PlaceChip />);

    const chip = screen.getByTestId('agent-scene-place');
    expect(chip).toHaveAttribute('data-place-known', 'yes');
    expect(chip).toHaveAttribute('data-place-id', 'AISLE-3');
    expect(chip).toHaveAttribute('data-place-confidence', 'confident');
    expect(chip).toHaveTextContent('Aisle 3');
  });

  /**
   * A drifted place used to differ from a current one by TEXT COLOUR ALONE —
   * muted instead of cobalt — with the word only reachable through a hover
   * tooltip that the 44px rail clipped away. WCAG 1.4.1, and the page's own
   * invariant failing towards over-confidence: the operator reads a place name
   * as if the pose behind it were current.
   */
  it('keeps a drifted pose readable as drifted, in words and not only in colour', () => {
    useAgentModeStore.setState({ scene: scene({ place: place({ confidence: 'stale' }) }) });
    render(<PlaceChip />);

    const chip = screen.getByTestId('agent-scene-place');
    expect(chip).toHaveAttribute('data-place-confidence', 'stale');
    expect(chip).toHaveTextContent('Aisle 3');
    expect(chip).toHaveTextContent(/stale/i);
  });

  it('says nothing about drift while the pose is current', () => {
    // The qualifier is conditional by construction — a word that is always
    // there is a word nobody reads when it starts being true.
    useAgentModeStore.setState({ scene: scene({ place: place() }) });
    render(<PlaceChip />);

    expect(screen.getByTestId('agent-scene-place')).not.toHaveTextContent(/stale/i);
  });

  /**
   * The honesty sentence does not depend on a pointing device.
   *
   * `Tooltip` is CSS-positioned, not portalled, and only mounts its panel while
   * the pointer is over a trigger that carries no tab stop — so in the rail the
   * sentence was unreachable by hover (clipped) AND by keyboard (no focus). It
   * is now in the DOM unconditionally.
   */
  it('states why the place is unknown without anyone having to hover it', () => {
    render(<PlaceChip />);

    expect(screen.getByTestId('agent-scene-place')).toHaveTextContent(
      /not the last place it was in/i
    );
  });

  // A caller saying "unknown" must not be silently upgraded by the store.
  it('takes an explicit place over the store, null included', () => {
    useAgentModeStore.setState({ scene: scene({ place: place() }) });
    render(<PlaceChip place={null} />);

    expect(screen.getByTestId('agent-scene-place')).toHaveAttribute('data-place-known', 'no');
  });

  // The single-renderer rule: a second, action-time copy carries no testid, so
  // the page keeps exactly one element answering "where does it think it is".
  it('can render without the testid so only one instance owns it', () => {
    useAgentModeStore.setState({ scene: scene({ place: place() }) });
    render(<PlaceChip testId={null} />);

    expect(screen.queryByTestId('agent-scene-place')).toBeNull();
    expect(screen.getByText('Aisle 3')).toBeVisible();
  });
});
