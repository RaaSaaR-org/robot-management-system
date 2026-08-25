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
   * Before the first `look` the scene snapshot is null, but the place belief
   * (surveyed graph + odometry) can already be confident. The chip used to say
   * "Place unknown" then — the exact wrong-aisle failure it exists to prevent —
   * while the map panel, reading the belief directly, said "Hallway".
   */
  it('shows the believed place before anything was seen — the belief does not wait for a scene', () => {
    useAgentModeStore.setState({ scene: null, place: place({ id: 'HALLWAY', name: 'Hallway' }) });
    render(<PlaceChip />);

    const chip = screen.getByTestId('agent-scene-place');
    expect(chip).toHaveAttribute('data-place-known', 'yes');
    expect(chip).toHaveAttribute('data-place-id', 'HALLWAY');
    expect(chip).toHaveTextContent('Hallway');
  });

  it('prefers the live scene\'s place over the mirrored belief when both are held', () => {
    useAgentModeStore.setState({
      scene: scene({ place: place({ id: 'AISLE-3', name: 'Aisle 3' }) }),
      place: place({ id: 'HALLWAY', name: 'Hallway' }),
    });
    render(<PlaceChip />);
    expect(screen.getByTestId('agent-scene-place')).toHaveAttribute('data-place-id', 'AISLE-3');
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

/**
 * TASK-201. "Stale place" and "keepout fence not enforcing" are two different
 * claims about one robot, and an operator must not have to infer the second
 * from the first. They are therefore two separate markers, each of which can
 * appear without the other.
 */
describe('the fence-off marker (TASK-201)', () => {
  const NOT_ENFORCING = {
    enforcement: 'not-enforcing' as const,
    reason: 'the pose has drifted past its budget',
  };

  it('says the fence is off IN WORDS, not by colour alone', () => {
    useAgentModeStore.setState({
      scene: scene({ place: place() }),
      geofence: NOT_ENFORCING,
    });
    render(<PlaceChip />);

    // The visible word, reachable without a pointer and surviving a washed-out
    // projector or a colour-blind operator — the same rule `· stale` follows.
    expect(screen.getByTestId('agent-geofence-off')).toHaveTextContent(/fence off/i);
    // And the full sentence in the DOM for a screen reader, not only on hover.
    expect(screen.getByTestId('agent-geofence-off')).toHaveTextContent(
      /would NOT be stopped from walking into a keepout/i
    );
  });

  /**
   * The decisive separation. A CONFIDENT place with the fence off is the
   * realistic case for a dropped pose poll, and folding the marker into the
   * `· stale` branch would have hidden it completely.
   */
  it('appears on a confident place — it is not a spelling of `· stale`', () => {
    useAgentModeStore.setState({
      scene: scene({ place: place({ confidence: 'confident' }) }),
      geofence: NOT_ENFORCING,
    });
    render(<PlaceChip />);

    expect(screen.getByTestId('agent-geofence-off')).toBeVisible();
    expect(screen.getByTestId('agent-scene-place')).not.toHaveTextContent(/stale/i);
  });

  it('and a stale place still renders without it when the fence is holding', () => {
    useAgentModeStore.setState({
      scene: scene({ place: place({ confidence: 'stale' }) }),
      geofence: { enforcement: 'enforcing', reason: null },
    });
    render(<PlaceChip />);

    expect(screen.getByTestId('agent-scene-place')).toHaveTextContent(/stale/i);
    expect(screen.queryByTestId('agent-geofence-off')).toBeNull();
  });

  /**
   * The unknown-place branch returns early, and a robot with no pose at all has
   * BOTH an unknown place and a fence that cannot fence. An unknown-place chip
   * on its own reads as the milder of the two problems.
   */
  it('renders in the unknown-place branch too — no pose means both are true', () => {
    useAgentModeStore.setState({
      scene: null,
      place: null,
      geofence: { enforcement: 'not-enforcing', reason: 'no pose sample' },
    });
    render(<PlaceChip />);

    expect(screen.getByTestId('agent-scene-place')).toHaveAttribute('data-place-known', 'no');
    expect(screen.getByTestId('agent-geofence-off')).toBeVisible();
  });

  it('is absent for `no-map`, and for an agent that reports nothing at all', () => {
    useAgentModeStore.setState({
      scene: scene({ place: place() }),
      geofence: { enforcement: 'no-map', reason: 'no place graph' },
    });
    const { unmount } = render(<PlaceChip />);
    expect(screen.queryByTestId('agent-geofence-off')).toBeNull();
    unmount();

    // Absent must render as NOTHING — never as a claim in either direction.
    useAgentModeStore.setState({ geofence: undefined });
    render(<PlaceChip />);
    expect(screen.queryByTestId('agent-geofence-off')).toBeNull();
  });
});
