/**
 * @file agentModeDemoData.ts
 * @description Agent Mode fixtures served by MSW and replayed by the demo plan
 *              driver in demo mode (VITE_DEMO_MODE=true). TASK-194.
 * @feature mocks
 */

import type {
  AgentBlock,
  AgentModeState,
  AgentPlan,
  SceneMemory,
} from '@/features/agentmode/types/agentmode.types';

/** The G1 the demo binds to — matches `DEMO_ROBOTS` in `demoData.ts`. */
export const DEMO_AGENT_ROBOT_ID = 'demo-g1-001';

/** The scripted acceptance command (TASK-194 test strategy §4). */
export const DEMO_AGENT_COMMAND = 'geh zum Tisch mit dem Hut';

// ============================================================================
// SCENE MEMORY
// ============================================================================

/**
 * What the robot remembers before the plan runs — a `scan_room` from an
 * earlier session. The hat is not in here yet; the `look` block finds it.
 */
export function createDemoScene(robotId: string = DEMO_AGENT_ROBOT_ID): SceneMemory {
  const now = new Date().toISOString();
  return {
    robotId,
    currentView:
      'A bright lab room. A wooden table stands ahead and slightly to the left, ' +
      'with a chair beside it and a shelf against the far wall.',
    personVisible: true,
    updatedAt: now,
    entities: [
      {
        label: 'Tisch',
        bearingDeg: -34,
        distanceEstM: 3.4,
        confidence: 0.91,
        lastSeen: now,
        note: 'Wooden work table, waist height',
      },
      {
        label: 'Stuhl',
        bearingDeg: -12,
        distanceEstM: 2.8,
        confidence: 0.84,
        lastSeen: now,
      },
      {
        label: 'Regal',
        bearingDeg: 61,
        distanceEstM: 5.1,
        confidence: 0.77,
        lastSeen: now,
        note: 'Shelf against the far wall',
      },
      {
        label: 'Person',
        bearingDeg: 118,
        distanceEstM: 2.2,
        confidence: 0.88,
        lastSeen: now,
      },
    ],
  };
}

/** Scene memory after the plan's `look` block resolved the hat on the table. */
export function createDemoSceneAfterLook(robotId: string = DEMO_AGENT_ROBOT_ID): SceneMemory {
  const base = createDemoScene(robotId);
  const now = new Date().toISOString();
  return {
    ...base,
    currentView:
      'The table fills the centre of the frame. A dark felt hat lies on the ' +
      'left half of the table top, next to the chair.',
    updatedAt: now,
    entities: [
      {
        label: 'Tisch',
        bearingDeg: -6,
        distanceEstM: 1.4,
        confidence: 0.96,
        lastSeen: now,
        note: 'Wooden work table, waist height',
      },
      {
        label: 'Hut',
        bearingDeg: -9,
        distanceEstM: 1.3,
        confidence: 0.89,
        lastSeen: now,
        note: 'Dark felt hat on the table top',
      },
      ...base.entities.filter((e) => e.label !== 'Tisch'),
    ],
  };
}

// ============================================================================
// AGENT MODE STATE
// ============================================================================

/** Last known state the server would hold for a robot. */
export function createDemoAgentState(robotId: string = DEMO_AGENT_ROBOT_ID): AgentModeState {
  return {
    robotId,
    enabled: true,
    controlOwner: 'idle',
    plan: null,
    scene: createDemoScene(robotId),
    estopActive: false,
  };
}

// ============================================================================
// PLAN SCRIPT
// ============================================================================

interface DemoBlockSpec {
  kind: AgentBlock['kind'];
  params: Record<string, unknown>;
  reasoning: string;
  result: string;
  /** How long the block "runs" in the demo, in ms. */
  durationMs: number;
}

/**
 * The plan the local planner produces for "geh zum Tisch mit dem Hut":
 * scan_room → turn → walk → look → walk → speak. Kept short so the timeline
 * animates within a Playwright run.
 */
const DEMO_BLOCK_SPECS: DemoBlockSpec[] = [
  {
    kind: 'scan_room',
    params: { steps: 8 },
    reasoning: 'I do not know where the table is yet — sweep the room first.',
    result: 'Found 4 entities: Tisch, Stuhl, Regal, Person.',
    durationMs: 800,
  },
  {
    kind: 'turn',
    params: { angleDeg: -34 },
    reasoning: 'The table sits at bearing -34°, so turn onto it before walking.',
    result: 'Yaw now within 2° of the table bearing.',
    durationMs: 500,
  },
  {
    kind: 'walk',
    params: { distanceM: 2.0, direction: 'forward' },
    reasoning: 'Close most of the 3.4 m gap in one stage, then re-check.',
    result: 'Advanced 2.0 m; 1.4 m remaining by odometry.',
    durationMs: 800,
  },
  {
    kind: 'look',
    params: {},
    reasoning: 'Re-check the bearing and confirm the hat is really on this table.',
    result: 'Hat confirmed on the table top at bearing -9°.',
    durationMs: 600,
  },
  {
    kind: 'walk',
    params: { distanceM: 1.1, direction: 'forward' },
    reasoning: 'Final approach to standing distance in front of the table.',
    result: 'Stopped 0.3 m in front of the table.',
    durationMs: 600,
  },
  {
    kind: 'speak',
    params: { text: 'Ich stehe am Tisch mit dem Hut.' },
    reasoning: 'Report arrival so the operator knows the goal was reached.',
    result: 'I am standing at the table with the hat.',
    durationMs: 500,
  },
];

/** Short greet plan, so a "begrüße …" command does not replay the table run. */
const DEMO_GREET_SPECS: DemoBlockSpec[] = [
  {
    kind: 'look',
    params: {},
    reasoning: 'Check whether the person is still where scene memory says.',
    result: 'Person confirmed at bearing +118°.',
    durationMs: 600,
  },
  {
    kind: 'turn',
    params: { angleDeg: 118 },
    reasoning: 'Face the person before greeting — a greeting to a wall is useless.',
    result: 'Facing the person.',
    durationMs: 700,
  },
  {
    kind: 'greet',
    params: { text: 'Hallo!' },
    reasoning: 'Greet = speak plus a wave with the right hand.',
    result: 'Waved and said hello.',
    durationMs: 800,
  },
];

/** Turn-and-look plan for "dreh dich …" style commands. */
const DEMO_LOOK_AROUND_SPECS: DemoBlockSpec[] = [
  {
    kind: 'turn',
    params: { angleDeg: 90 },
    reasoning: 'Left is +90° in the world frame.',
    result: 'Turned 90° left.',
    durationMs: 700,
  },
  {
    kind: 'look',
    params: {},
    reasoning: 'Snapshot the new view and fold it into scene memory.',
    result: 'Scene memory refreshed.',
    durationMs: 600,
  },
  {
    kind: 'speak',
    params: { text: 'Ich sehe den Tisch und den Hut.' },
    reasoning: 'Report what is now in view.',
    result: 'I can see the table and the hat.',
    durationMs: 500,
  },
];

/** Pick the block script that matches the utterance. */
function specsForCommand(command: string): DemoBlockSpec[] {
  const text = command.toLowerCase();
  if (/begrüß|begruess|gruß|gruess|greet|hallo|wink|wave/.test(text)) return DEMO_GREET_SPECS;
  if (/dreh|turn|schau|umsehen|umschau|look around/.test(text)) return DEMO_LOOK_AROUND_SPECS;
  return DEMO_BLOCK_SPECS;
}

/** A plan plus the per-block timings the demo driver replays. */
export interface DemoPlanScript {
  plan: AgentPlan;
  /** Block-aligned durations in ms. */
  timings: number[];
  /** Per-block result strings reported on `agent:block:finished`. */
  results: string[];
  /** Index of the `look` block, after which the scene memory updates. */
  lookIndex: number;
}

/**
 * Build the demo plan for a command. Every block starts `pending`; the driver
 * flips them through running → done on the returned timings.
 *
 * @param robotId - Robot the plan belongs to
 * @param command - The original utterance
 * @param planId - Plan id handed out by the (mocked) command endpoint
 */
export function buildDemoPlan(robotId: string, command: string, planId: string): DemoPlanScript {
  const now = new Date().toISOString();
  const specs = specsForCommand(command);
  const blocks: AgentBlock[] = specs.map((spec, index) => ({
    id: `${planId}-b${index + 1}`,
    kind: spec.kind,
    params: spec.params,
    status: 'pending',
    reasoning: spec.reasoning,
  }));

  return {
    plan: {
      id: planId,
      robotId,
      command,
      blocks,
      cursor: -1,
      status: 'running',
      createdAt: now,
      updatedAt: now,
    },
    timings: specs.map((s) => s.durationMs),
    results: specs.map((s) => s.result),
    lookIndex: specs.findIndex((s) => s.kind === 'look'),
  };
}
