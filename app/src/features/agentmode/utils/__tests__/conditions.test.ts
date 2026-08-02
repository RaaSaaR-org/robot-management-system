/**
 * @file conditions.test.ts
 * @description Pins the two rules the condition list exists for: it is always
 *              COMPLETE (the false entries prove an absent badge is absent
 *              because the condition is false), and its severity is the MAX
 *              over everything true right now, never the first match.
 * @feature agentmode
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CONDITION_ORDER, conditionLevel, selectConditions } from '../conditions';
import type { ConditionKey } from '../conditions';
import { useAgentModeStore } from '../../store/agentmodeStore';
import type { AgentSelfState } from '../../types/agentmode.types';

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
  place: 'AISLE-3',
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

/** The store IS the input shape — no hand-built fake can drift away from it. */
const conditions = (now?: number) =>
  selectConditions(useAgentModeStore.getState(), now);

const byKey = (key: ConditionKey, now?: number) =>
  conditions(now).find((condition) => condition.key === key)!;

beforeEach(() => {
  useAgentModeStore.getState().reset();
});

describe('selectConditions', () => {
  it('returns all seven conditions, in severity order, whatever the state', () => {
    expect(conditions().map((c) => c.key)).toEqual([...CONDITION_ORDER]);
    expect(conditions()).toHaveLength(7);

    useAgentModeStore.setState({ damped: true, estopActive: true, estopStatus: 'failed' });
    expect(conditions().map((c) => c.key)).toEqual([...CONDITION_ORDER]);
    expect(conditions()).toHaveLength(7);
  });

  // The false entries are the point: an operator has to be able to check that
  // the rail is calm because nothing is wrong, not because the rail broke.
  it('reports a calm robot as seven inactive conditions at level 0', () => {
    for (const condition of conditions()) {
      expect(condition.active).toBe(false);
      expect(condition.level).toBe(0);
    }
    expect(conditionLevel(conditions())).toBe(0);
  });

  it('reports two simultaneous conditions as BOTH active', () => {
    useAgentModeStore.setState({
      damped: true,
      recovered: { fromCrash: true, estopLatched: false, at: new Date().toISOString() },
    });

    expect(byKey('damped').active).toBe(true);
    expect(byKey('recovered').active).toBe(true);
    // …and nothing else got swept in with them.
    expect(conditions().filter((c) => c.active).map((c) => c.key)).toEqual([
      'recovered',
      'damped',
    ]);
  });

  it('raises the E-Stop to an alarm only when the hardware did not confirm it', () => {
    useAgentModeStore.setState({ estopActive: true, estopStatus: 'acknowledged' });
    expect(byKey('estop').level).toBe(2);

    useAgentModeStore.setState({ estopStatus: 'unconfirmed' });
    expect(byKey('estop').level).toBe(3);

    useAgentModeStore.setState({ estopStatus: 'failed' });
    expect(byKey('estop').level).toBe(3);
  });

  it('keeps a failed console request below the safety conditions', () => {
    useAgentModeStore.setState({ error: 'Request failed' });

    expect(byKey('error').active).toBe(true);
    expect(byKey('error').level).toBe(1);
    expect(conditionLevel(conditions())).toBe(1);
  });

  describe('snapshot age', () => {
    const takenAt = new Date('2026-07-31T10:00:00Z').getTime();

    it('is not stale while it is fresh', () => {
      useAgentModeStore.setState({
        self: self(),
        selfUpdatedAt: new Date(takenAt).toISOString(),
        selfLive: true,
      });

      expect(byKey('stale', takenAt + 30_000).active).toBe(false);
    });

    it('goes stale a minute after the snapshot was taken', () => {
      useAgentModeStore.setState({
        self: self(),
        selfUpdatedAt: new Date(takenAt).toISOString(),
        selfLive: true,
      });

      expect(byKey('stale', takenAt + 60_000).active).toBe(true);
    });

    // "Nobody can date this" is not better news than "this is five minutes old".
    it('treats an undatable snapshot as stale', () => {
      useAgentModeStore.setState({
        self: self(),
        selfUpdatedAt: null,
        selfAgeUnknown: true,
      });

      expect(byKey('stale').active).toBe(true);
    });

    it('does not call a robot that has said nothing yet stale', () => {
      expect(byKey('stale').active).toBe(false);
    });
  });
});

describe('conditionLevel', () => {
  // The regression a ranked "worst condition wins" strip introduces silently.
  it('is the MAX over the active conditions, not the first match', () => {
    useAgentModeStore.setState({
      stateReachability: 'unreachable',
      stateUnavailableReason: 'robot did not answer',
      estopActive: true,
      estopStatus: 'unconfirmed',
    });

    const list = conditions();
    // The unreachable notice sorts FIRST and is only level 2…
    expect(list.find((c) => c.active)!.key).toBe('stateUnknown');
    expect(byKey('stateUnknown').level).toBe(2);
    // …so a first-match implementation would lose the alarm's red here.
    expect(conditionLevel(list)).toBe(3);
  });

  it('ignores the level of conditions that are not active', () => {
    expect(
      conditionLevel([
        { key: 'estop', active: false, level: 3 },
        { key: 'damped', active: true, level: 2 },
      ])
    ).toBe(2);
  });
});

describe('identity', () => {
  // Consumers subscribe with `useAgentModeStore(selectConditions)`; a fresh
  // array on every call is an infinite re-render under zustand v5.
  it('hands back the same array while nothing changed', () => {
    useAgentModeStore.setState({ damped: true });
    const first = conditions();
    expect(conditions()).toBe(first);

    useAgentModeStore.setState({ damped: false });
    expect(conditions()).not.toBe(first);
  });
});
