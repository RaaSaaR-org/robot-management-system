/**
 * @file agent-mode-service.test.ts
 * @description The mirror's age (TASK-200). `mirroredAt` is the only thing that
 *              separates "what the robot is doing" from "what a process that
 *              died an hour ago was doing", so it has to move on ingest — and
 *              on nothing else.
 * @feature agentmode
 */

import { describe, it, expect } from 'vitest';
import { AgentModeService, isValidAgentModeSnapshot } from '../services/AgentModeService.js';
import type { AgentModeEvent, AgentModeState } from '../types/agent-mode.types.js';

const STATE: AgentModeState = {
  robotId: 'robot-001',
  enabled: true,
  controlOwner: 'agent',
  plan: null,
  scene: null,
  estopActive: false,
};

const PLAN = {
  id: 'plan-1',
  robotId: 'robot-001',
  command: 'geh zum Tisch',
  blocks: [{ id: 'b1', kind: 'walk', params: {}, status: 'running' }],
  cursor: 0,
  status: 'running',
  createdAt: '2026-08-02T07:00:00.000Z',
  updatedAt: '2026-08-02T07:00:00.000Z',
} as unknown as NonNullable<AgentModeState['plan']>;

/** A service on a clock the test drives, so the instants are exact. */
function makeService(startMs = Date.parse('2026-08-02T07:00:00.000Z')) {
  const clock = { ms: startMs };
  const service = new AgentModeService({ now: () => clock.ms });
  return {
    service,
    clock,
    advance: (ms: number) => {
      clock.ms += ms;
    },
  };
}

const stateEvent = (over: Partial<AgentModeEvent> = {}): AgentModeEvent => ({
  type: 'agent:state:changed',
  robotId: 'robot-001',
  state: STATE,
  timestamp: '2026-08-02T07:00:00.000Z',
  ...over,
});

describe('AgentModeService.mirroredAt', () => {
  it('has no age for a robot it never heard from', () => {
    const { service } = makeService();
    expect(service.getMirroredAt('robot-001')).toBeNull();
  });

  it('records WHEN it ingested, not the timestamp the event carried', () => {
    // The event's timestamp is the ROBOT's clock, and the two are not the same
    // clock. The age of the mirror is a fact about this server.
    const { service } = makeService();

    service.ingest(stateEvent({ timestamp: '2020-01-01T00:00:00.000Z' }));

    expect(service.getMirroredAt('robot-001')).toBe('2026-08-02T07:00:00.000Z');
  });

  it('moves on every ingest, including events that carry no snapshot', () => {
    // A plan event is not a state, but it IS proof the pushing process is
    // alive — which is the question this field answers.
    const { service, advance } = makeService();
    service.ingest(stateEvent());

    advance(30_000);
    service.ingest({
      type: 'agent:plan:started',
      robotId: 'robot-001',
      plan: PLAN,
      timestamp: '2026-08-02T07:00:30.000Z',
    });

    expect(service.getMirroredAt('robot-001')).toBe('2026-08-02T07:00:30.000Z');
  });

  it('does NOT move on a read — reading a mirror does not make it younger', () => {
    // The whole defect in one assertion: the app stamped its own fetch time and
    // a 68-minute-old snapshot rendered as "just now" on every poll.
    const { service, advance } = makeService();
    service.ingest(stateEvent());

    advance(68 * 60_000);
    service.getState('robot-001');
    service.isHydrated('robot-001');
    service.getScene('robot-001');

    expect(service.getMirroredAt('robot-001')).toBe('2026-08-02T07:00:00.000Z');
  });

  it('keeps one age per robot', () => {
    const { service, advance } = makeService();
    service.ingest(stateEvent());
    advance(60_000);
    service.ingest(stateEvent({ robotId: 'robot-002' }));

    expect(service.getMirroredAt('robot-001')).toBe('2026-08-02T07:00:00.000Z');
    expect(service.getMirroredAt('robot-002')).toBe('2026-08-02T07:01:00.000Z');
  });

  // A reviewer's find: `mirroredAt` dates the last event of ANY kind, but the
  // app renders it as the age of the `self` inside the state. A block event
  // then makes a snapshot it did not touch look newly taken — the same "just
  // now" lie, one indirection further in.
  describe('stateMirroredAt — the age of the state itself', () => {
    it('has no snapshot age for a robot it never heard from', () => {
      const { service } = makeService();
      expect(service.getStateMirroredAt('robot-001')).toBeNull();
    });

    it('does NOT move for an event that leaves the stored state alone', () => {
      const { service, advance } = makeService();
      service.ingest(stateEvent());

      advance(30 * 60_000);
      service.ingest({
        type: 'agent:block:started',
        robotId: 'robot-001',
        plan: PLAN,
        timestamp: '2026-08-02T07:30:00.000Z',
      });

      // Proof of life moved; the age of what the mirror can SAY did not.
      expect(service.getMirroredAt('robot-001')).toBe('2026-08-02T07:30:00.000Z');
      expect(service.getStateMirroredAt('robot-001')).toBe('2026-08-02T07:00:00.000Z');
    });

    it('moves on every snapshot ingest', () => {
      const { service, advance } = makeService();
      service.ingest(stateEvent());
      advance(15_000);
      service.ingest(stateEvent({ timestamp: '2026-08-02T07:00:15.000Z' }));

      expect(service.getStateMirroredAt('robot-001')).toBe('2026-08-02T07:00:15.000Z');
    });

    it('stays null while only invalid snapshots arrive', () => {
      // `{}` POSTed as `state` is not a snapshot, must not hydrate — and must
      // not date a state that was never stored either.
      const { service } = makeService();
      service.ingest(stateEvent({ state: {} as AgentModeState }));

      expect(service.isHydrated('robot-001')).toBe(false);
      expect(service.getMirroredAt('robot-001')).toBe('2026-08-02T07:00:00.000Z');
      expect(service.getStateMirroredAt('robot-001')).toBeNull();
    });

    it('keeps one snapshot age per robot, and never moves on a read', () => {
      const { service, advance } = makeService();
      service.ingest(stateEvent());
      advance(60_000);
      service.ingest(stateEvent({ robotId: 'robot-002' }));
      advance(68 * 60_000);
      service.getState('robot-001');

      expect(service.getStateMirroredAt('robot-001')).toBe('2026-08-02T07:00:00.000Z');
      expect(service.getStateMirroredAt('robot-002')).toBe('2026-08-02T07:01:00.000Z');
    });

    it('reports its own clock, so an age can be taken in one frame', () => {
      const { service, advance } = makeService();
      service.ingest(stateEvent());
      advance(45_000);

      expect(service.nowIso()).toBe('2026-08-02T07:00:45.000Z');
      // The age of the snapshot, entirely inside the server's clock.
      expect(
        Date.parse(service.nowIso()) - Date.parse(service.getStateMirroredAt('robot-001')!)
      ).toBe(45_000);
    });
  });

  it('leaves the hydration guard exactly as it was', () => {
    // `mirroredAt` says HOW OLD the entry is, never whether it may be served.
    // An entry seeded by a plan event is dated and still unhydrated.
    const { service } = makeService();
    service.ingest({
      type: 'agent:plan:started',
      robotId: 'robot-001',
      plan: PLAN,
      timestamp: '2026-08-02T07:00:00.000Z',
    });

    expect(service.getMirroredAt('robot-001')).toBe('2026-08-02T07:00:00.000Z');
    expect(service.isHydrated('robot-001')).toBe(false);

    service.ingest(stateEvent());
    expect(service.isHydrated('robot-001')).toBe(true);
    expect(isValidAgentModeSnapshot(service.getState('robot-001'))).toBe(true);
  });
});
