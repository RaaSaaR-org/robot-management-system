/**
 * @file AgentModeService.test.ts
 * @description Unit tests for the in-memory Agent Mode mirror (TASK-194):
 *              event merge semantics, scene/state reads, the bounded recent-
 *              event log and subscriber fan-out.
 * @feature agentmode
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { agentModeService, isValidAgentModeSnapshot } from '../AgentModeService.js';
import type {
  AgentBlock,
  AgentModeEvent,
  AgentModeState,
  AgentPlan,
  SceneMemory,
} from '../../types/agent-mode.types.js';

/** Unique robot id per test so the module-level singleton stays isolated. */
let robotSeq = 0;
const nextRobotId = (): string => `robot-${++robotSeq}`;

function makePlan(robotId: string, overrides: Partial<AgentPlan> = {}): AgentPlan {
  return {
    id: 'plan-1',
    robotId,
    command: 'geh zum Tisch mit dem Hut',
    blocks: [
      { id: 'b1', kind: 'scan_room', params: {}, status: 'running' },
      { id: 'b2', kind: 'walk', params: { distanceM: 1, direction: 'forward' }, status: 'pending' },
    ],
    cursor: 0,
    status: 'running',
    createdAt: '2026-07-25T10:00:00.000Z',
    updatedAt: '2026-07-25T10:00:00.000Z',
    ...overrides,
  };
}

function makeScene(robotId: string): SceneMemory {
  return {
    robotId,
    currentView: 'Ein Tisch mit einem Hut.',
    entities: [
      { label: 'Tisch', bearingDeg: 12, distanceEstM: 2.4, confidence: 0.8, lastSeen: '2026-07-25T10:00:02.000Z' },
    ],
    personVisible: false,
    updatedAt: '2026-07-25T10:00:02.000Z',
  };
}

function event(partial: Partial<AgentModeEvent> & Pick<AgentModeEvent, 'type' | 'robotId'>): AgentModeEvent {
  return { timestamp: '2026-07-25T10:00:00.000Z', ...partial };
}

describe('AgentModeService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null for a robot it has never heard from', () => {
    const robotId = nextRobotId();
    expect(agentModeService.getState(robotId)).toBeNull();
    expect(agentModeService.getScene(robotId)).toBeNull();
  });

  it('seeds a neutral state from a plan-only event', () => {
    const robotId = nextRobotId();
    const plan = makePlan(robotId);

    const merged = agentModeService.ingest(event({ type: 'agent:plan:started', robotId, plan }));

    expect(merged).toMatchObject({
      robotId,
      enabled: false,
      controlOwner: 'idle',
      estopActive: false,
      scene: null,
    });
    expect(merged.plan?.id).toBe('plan-1');
    expect(agentModeService.getState(robotId)).toEqual(merged);
    // ...but those neutral fields are defaults, not the robot's answer.
    expect(agentModeService.isHydrated(robotId)).toBe(false);
  });

  it('marks a robot hydrated only once a real snapshot arrives', () => {
    // Seen live: the server restarted, the running robot's next event was a
    // plan event, and the mirror then reported an enabled robot as
    // `enabled: false` — with `estopActive: false` alongside it. A latched
    // E-Stop would have read as clear. Route reads gate on isHydrated().
    const robotId = nextRobotId();
    expect(agentModeService.isHydrated(robotId)).toBe(false);

    agentModeService.ingest(event({ type: 'agent:plan:started', robotId, plan: makePlan(robotId) }));
    expect(agentModeService.getState(robotId)).not.toBeNull();
    expect(agentModeService.isHydrated(robotId)).toBe(false);

    agentModeService.ingest(
      event({
        type: 'agent:state:changed',
        robotId,
        state: {
          robotId,
          enabled: true,
          controlOwner: 'agent',
          plan: null,
          scene: null,
          estopActive: true,
        },
      })
    );
    expect(agentModeService.isHydrated(robotId)).toBe(true);

    // A later partial event must not un-hydrate what the robot already told us.
    agentModeService.ingest(event({ type: 'agent:plan:started', robotId, plan: makePlan(robotId) }));
    expect(agentModeService.isHydrated(robotId)).toBe(true);
  });

  it('does not hydrate from a shapeless snapshot', () => {
    // Anyone can POST { type: 'agent:state:changed', state: {} } to /events.
    // An invalid snapshot is treated as no snapshot at all: partial fields
    // still merge, but the entry must never count as the robot's own answer.
    const robotId = nextRobotId();

    const merged = agentModeService.ingest(
      event({ type: 'agent:state:changed', robotId, state: {} as AgentModeState })
    );

    expect(merged).toMatchObject({ robotId, enabled: false, estopActive: false });
    expect(agentModeService.isHydrated(robotId)).toBe(false);
  });

  it('merges partial fields of an event whose snapshot is invalid, without hydrating', () => {
    const robotId = nextRobotId();

    const merged = agentModeService.ingest(
      event({
        type: 'agent:state:changed',
        robotId,
        state: { enabled: true } as AgentModeState, // missing estopActive/controlOwner
        plan: makePlan(robotId),
      })
    );

    // The plan merges as for any partial event; the half-snapshot is ignored.
    expect(merged.plan?.id).toBe('plan-1');
    expect(merged.enabled).toBe(false);
    expect(agentModeService.isHydrated(robotId)).toBe(false);
  });

  it('keeps the hydrated state when an invalid snapshot arrives later', () => {
    const robotId = nextRobotId();
    agentModeService.ingest(
      event({
        type: 'agent:state:changed',
        robotId,
        state: {
          robotId,
          enabled: true,
          controlOwner: 'agent',
          plan: null,
          scene: null,
          estopActive: true,
        },
      })
    );

    const merged = agentModeService.ingest(
      event({ type: 'agent:state:changed', robotId, state: {} as AgentModeState })
    );

    // The robot's real answer survives; the shapeless snapshot changes nothing.
    expect(merged.enabled).toBe(true);
    expect(merged.estopActive).toBe(true);
    expect(agentModeService.isHydrated(robotId)).toBe(true);
  });

  it('treats a full state snapshot as authoritative', () => {
    const robotId = nextRobotId();
    agentModeService.ingest(event({ type: 'agent:plan:started', robotId, plan: makePlan(robotId) }));

    const state: AgentModeState = {
      robotId,
      enabled: true,
      controlOwner: 'agent',
      plan: null,
      scene: null,
      estopActive: true,
    };
    const merged = agentModeService.ingest(event({ type: 'agent:state:changed', robotId, state }));

    // An explicit null plan clears the stored plan instead of resurrecting it.
    expect(merged.plan).toBeNull();
    expect(merged.enabled).toBe(true);
    expect(merged.controlOwner).toBe('agent');
    expect(merged.estopActive).toBe(true);
  });

  it('keeps the stored plan and scene when a snapshot omits them', () => {
    // A robot's periodic liveness re-assertion (TASK-200) carries neither: it
    // exists to DATE the mirror, and it is delivered fire-and-forget, so it can
    // land after the events it was taken before. Absent must therefore mean "no
    // opinion" — reading it as "there is no plan" would blank the console's
    // timeline four times a minute for the whole life of every plan.
    const robotId = nextRobotId();
    agentModeService.ingest(event({ type: 'agent:plan:started', robotId, plan: makePlan(robotId) }));
    agentModeService.ingest(
      event({ type: 'agent:scene:updated', robotId, scene: makeScene(robotId) })
    );

    const merged = agentModeService.ingest(
      event({
        type: 'agent:state:changed',
        robotId,
        state: { robotId, enabled: true, controlOwner: 'agent', estopActive: false },
      })
    );

    expect(merged.plan?.id).toBe('plan-1');
    expect(merged.scene?.currentView).toBe('Ein Tisch mit einem Hut.');
    // …and it is still a real snapshot for every other purpose.
    expect(merged.enabled).toBe(true);
    expect(agentModeService.isHydrated(robotId)).toBe(true);
    expect(agentModeService.getState(robotId)?.plan?.id).toBe('plan-1');
  });

  it('reports no plan when a plan-less snapshot is the first thing it hears', () => {
    // Absent must not become `undefined` on the wire either — a client reading
    // `plan` off this response has to get an answer, and the honest one is null.
    const robotId = nextRobotId();

    const merged = agentModeService.ingest(
      event({
        type: 'agent:state:changed',
        robotId,
        state: { robotId, enabled: true, controlOwner: 'idle', estopActive: false },
      })
    );

    expect(merged.plan).toBeNull();
    expect(merged.scene).toBeNull();
  });

  it('keeps the previous plan when a scene-only event arrives', () => {
    const robotId = nextRobotId();
    agentModeService.ingest(event({ type: 'agent:plan:started', robotId, plan: makePlan(robotId) }));

    const merged = agentModeService.ingest(
      event({ type: 'agent:scene:updated', robotId, scene: makeScene(robotId) })
    );

    expect(merged.plan?.id).toBe('plan-1');
    expect(merged.scene?.entities[0].label).toBe('Tisch');
    expect(agentModeService.getScene(robotId)?.currentView).toBe('Ein Tisch mit einem Hut.');
  });

  it('splices a block-only event into the stored plan by id', () => {
    const robotId = nextRobotId();
    agentModeService.ingest(event({ type: 'agent:plan:started', robotId, plan: makePlan(robotId) }));

    const block: AgentBlock = {
      id: 'b1',
      kind: 'scan_room',
      params: {},
      status: 'done',
      result: '8 Aufnahmen',
    };
    const merged = agentModeService.ingest(event({ type: 'agent:block:finished', robotId, block }));

    expect(merged.plan?.blocks[0]).toEqual(block);
    expect(merged.plan?.blocks[1].status).toBe('pending');
  });

  it('ignores a block whose id is not in the stored plan', () => {
    const robotId = nextRobotId();
    agentModeService.ingest(event({ type: 'agent:plan:started', robotId, plan: makePlan(robotId) }));

    const merged = agentModeService.ingest(
      event({
        type: 'agent:block:started',
        robotId,
        block: { id: 'stale', kind: 'wait', params: { seconds: 1 }, status: 'running' },
      })
    );

    expect(merged.plan?.blocks.map((b) => b.id)).toEqual(['b1', 'b2']);
  });

  it('keeps state per robot', () => {
    const a = nextRobotId();
    const b = nextRobotId();
    agentModeService.ingest(event({ type: 'agent:plan:started', robotId: a, plan: makePlan(a) }));
    agentModeService.ingest(event({ type: 'agent:scene:updated', robotId: b, scene: makeScene(b) }));

    expect(agentModeService.getState(a)?.scene).toBeNull();
    expect(agentModeService.getState(b)?.plan).toBeNull();
  });

  it('notifies subscribers and stops after unsubscribe', () => {
    const robotId = nextRobotId();
    const seen: AgentModeEvent[] = [];
    const unsubscribe = agentModeService.onAgentModeEvent((e) => {
      if (e.robotId === robotId) seen.push(e);
    });

    agentModeService.ingest(event({ type: 'agent:plan:started', robotId, plan: makePlan(robotId) }));
    unsubscribe();
    agentModeService.ingest(event({ type: 'agent:plan:finished', robotId, plan: makePlan(robotId) }));

    expect(seen.map((e) => e.type)).toEqual(['agent:plan:started']);
  });

  it('keeps emitting when one subscriber throws', () => {
    const robotId = nextRobotId();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const good = vi.fn();
    const offBad = agentModeService.onAgentModeEvent(() => {
      throw new Error('subscriber blew up');
    });
    const offGood = agentModeService.onAgentModeEvent(good);

    agentModeService.ingest(event({ type: 'agent:state:changed', robotId }));

    expect(good).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalled();
    offBad();
    offGood();
  });

  it('returns recent events newest first, filtered by robot and limited', () => {
    const robotId = nextRobotId();
    const other = nextRobotId();
    agentModeService.ingest(event({ type: 'agent:plan:started', robotId }));
    agentModeService.ingest(event({ type: 'agent:block:started', robotId }));
    agentModeService.ingest(event({ type: 'agent:plan:started', robotId: other }));
    agentModeService.ingest(event({ type: 'agent:block:finished', robotId }));

    const events = agentModeService.getRecentEvents(robotId);
    expect(events.map((e) => e.type)).toEqual([
      'agent:block:finished',
      'agent:block:started',
      'agent:plan:started',
    ]);
    expect(agentModeService.getRecentEvents(robotId, 1)).toHaveLength(1);
  });

  it('caps the recent-event log at 200 entries', () => {
    const robotId = nextRobotId();
    for (let i = 0; i < 250; i++) {
      agentModeService.ingest(event({ type: 'agent:state:changed', robotId }));
    }
    expect(agentModeService.getRecentEvents(undefined, 1000)).toHaveLength(200);
  });
});

describe('isValidAgentModeSnapshot', () => {
  const valid: AgentModeState = {
    robotId: 'robot-x',
    enabled: true,
    controlOwner: 'agent',
    plan: null,
    scene: null,
    estopActive: false,
  };

  it('accepts a snapshot asserting enabled, estopActive and a known controlOwner', () => {
    expect(isValidAgentModeSnapshot(valid)).toBe(true);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a string', 'enabled'],
    ['an empty object', {}],
    ['a snapshot missing estopActive', { ...valid, estopActive: undefined }],
    ['a snapshot missing enabled', { ...valid, enabled: undefined }],
    ['a non-boolean enabled', { ...valid, enabled: 'true' }],
    ['an unknown controlOwner', { ...valid, controlOwner: 'hacker' }],
  ])('rejects %s', (_label, candidate) => {
    expect(isValidAgentModeSnapshot(candidate)).toBe(false);
  });
});
