/**
 * @file agent-card.ts
 * @description A2A AgentCard definition for the simulated robot
 * @status live
 */

import type { AgentCard, AgentSkill } from '@a2a-js/sdk';
import { AgentBlockKinds } from '../agent-mode/types.js';
import type { EmbodimentConfig } from '../embodiment/types.js';
import type { RobotClass } from '../robot/types.js';

export interface AgentCardOptions {
  robotId: string;
  robotName: string;
  port: number;
  robotClass: RobotClass;
  maxPayloadKg: number;
  robotDescription: string;
  /** True while the hardware sidecar reports a connected physical robot. */
  hardwareConnected?: boolean;
  /**
   * The loaded embodiment config (TASK-198). Skills are derived from it rather
   * than hardcoded, so the card stops advertising things the robot cannot do —
   * an arm with no hand joints must not offer manipulation, and a robot with no
   * enabled camera must not offer perception.
   */
  embodiment?: EmbodimentConfig | undefined;
}

/**
 * Honest naming: the "Simulated Robot:" prefix is only truthful while no real
 * hardware fronts this agent — with the sidecar connected, the card carries
 * the plain robot name.
 */
function cardName(robotName: string, hardwareConnected: boolean): string {
  return hardwareConnected ? robotName : `Simulated Robot: ${robotName}`;
}

function cardDescription(options: AgentCardOptions, hardwareConnected: boolean): string {
  const classDescription = getClassDescription(options.robotClass, options.maxPayloadKg);
  const mode = hardwareConnected
    ? 'This agent fronts a physical robot (real sensor data via the hardware sidecar)'
    : 'This agent currently runs in simulation mode';
  return `${classDescription}. ${options.robotDescription}. ${mode}. Can execute natural language commands for movement, picking up objects, and placing items. This robot can be controlled via A2A protocol or REST API.`;
}

/**
 * Update the served card's identity in place when hardware attaches/detaches.
 * The A2A request handler holds a reference to the card object, so mutating it
 * is how the discovery document follows a sim↔hardware transition at runtime.
 */
export function updateAgentCardIdentity(
  card: AgentCard,
  options: AgentCardOptions,
  hardwareConnected: boolean
): void {
  card.name = cardName(options.robotName, hardwareConnected);
  card.description = cardDescription(options, hardwareConnected);
}

function getClassDescription(robotClass: RobotClass, maxPayloadKg: number): string {
  switch (robotClass) {
    case 'lightweight':
      return `A lightweight humanoid robot designed for quick, nimble movements (max payload: ${maxPayloadKg}kg)`;
    case 'heavy-duty':
      return `An industrial-strength robot built for heavy lifting operations (max payload: ${maxPayloadKg}kg)`;
    default:
      return `A versatile humanoid robot for general tasks (max payload: ${maxPayloadKg}kg)`;
  }
}

/** Joint names that mean this robot can actually grasp something. */
const MANIPULATOR_JOINT = /hand|thumb|finger|index|middle|gripper|jaw/i;

const NAVIGATION_SKILL: AgentSkill = {
  id: 'navigation',
  name: 'Navigation',
  description: 'Move the robot to specific locations, zones, or coordinates within the facility',
  tags: ['move', 'navigate', 'go', 'travel', 'location'],
  examples: [
    'Move to Warehouse A',
    'Go to coordinates (25.5, 14.2)',
    'Navigate to the loading dock',
    'Return to home position',
    'Go to the charging station',
    'Move to the entrance',
  ],
  inputModes: ['text'],
  outputModes: ['text', 'task-status'],
};

const MANIPULATION_SKILL: AgentSkill = {
  id: 'manipulation',
  name: 'Object Manipulation',
  description: 'Pick up, carry, and place/drop objects',
  tags: ['pickup', 'drop', 'place', 'grab', 'carry', 'hold'],
  examples: [
    'Pick up the box',
    'Grab package-123',
    'Drop the item here',
    'Put down what you are holding',
    'Pick up the pallet',
  ],
  inputModes: ['text'],
  outputModes: ['text', 'task-status'],
};

const STATUS_SKILL: AgentSkill = {
  id: 'status_control',
  name: 'Status & Control',
  description: 'Query robot status, stop operations, check battery level, emergency controls',
  tags: ['status', 'stop', 'battery', 'location', 'emergency', 'halt'],
  examples: [
    'What is your current location?',
    'Stop moving',
    'Emergency stop',
    'What is your battery level?',
    'Are you carrying anything?',
    'What is your status?',
    'Stop all operations',
  ],
  inputModes: ['text'],
  outputModes: ['text', 'task-status'],
};

/**
 * The card's skill list, derived from what this body actually has (TASK-198).
 *
 * With no embodiment config the previous hardcoded set is kept: an unknown body
 * is not evidence that the robot lost a capability, and quietly narrowing the
 * card on a config that failed to load would be its own kind of lie. With one,
 * manipulation and perception are advertised only when the config carries the
 * joints and sensors they need.
 */
export function deriveAgentSkills(embodiment?: EmbodimentConfig): AgentSkill[] {
  if (!embodiment) return [NAVIGATION_SKILL, MANIPULATION_SKILL, STATUS_SKILL];

  const skills: AgentSkill[] = [NAVIGATION_SKILL];

  if (embodiment.proprioception.joint_names.some((j) => MANIPULATOR_JOINT.test(j))) {
    skills.push(MANIPULATION_SKILL);
  }

  const cameras = (embodiment.cameras ?? []).filter((c) => c.enabled);
  const depth = (embodiment.depth_sensors ?? []).filter((s) => s.enabled);
  if (cameras.length > 0 || depth.length > 0) {
    skills.push({
      id: 'perception',
      name: 'Perception',
      description:
        `Look around and report what is visible. Sensors: ` +
        [
          ...cameras.map((c) => `${c.name} (camera)`),
          ...depth.map((s) => `${s.name} (${s.type})`),
        ].join(', '),
      tags: ['look', 'see', 'scan', 'camera', ...depth.map((s) => s.type)],
      examples: ['What do you see?', 'Look around the room', 'Is anyone there?'],
      inputModes: ['text'],
      outputModes: ['text', 'task-status'],
    });
  }

  skills.push(STATUS_SKILL);
  return skills;
}

/**
 * Agent Mode's actual block vocabulary as one skill. Derived from
 * `AgentBlockKinds` so a block added to the planner cannot leave the card
 * advertising the old list.
 */
export function agentModeSkill(): AgentSkill {
  return {
    id: 'agent_mode',
    name: 'Agent Mode',
    description:
      'Plain-language commands are planned into executable blocks and run on the robot. ' +
      `Block vocabulary: ${AgentBlockKinds.join(', ')}.`,
    tags: ['agent', 'plan', 'blocks', ...AgentBlockKinds],
    examples: ['Walk two metres forward', 'Look around and go to the table', 'Remember that the pallet blocks the turn'],
    inputModes: ['text'],
    outputModes: ['text', 'task-status'],
  };
}

export function createRobotAgentCard(options: AgentCardOptions): AgentCard {
  const { port } = options;
  const hardwareConnected = options.hardwareConnected ?? false;

  // Public URL for agent card discovery (configurable for K8s/Docker deployments)
  const publicUrl = process.env.PUBLIC_URL || `http://localhost:${port}`;

  return {
    protocolVersion: '0.2.1',
    name: cardName(options.robotName, hardwareConnected),
    description: cardDescription(options, hardwareConnected),
    url: `${publicUrl}/`,
    provider: {
      organization: 'NeoDEM',
      url: 'https://neodem.io',
    },
    version: '1.0.0',
    capabilities: {
      streaming: true,
      pushNotifications: false,
      stateTransitionHistory: true,
    },
    defaultInputModes: ['text'],
    defaultOutputModes: ['text', 'task-status'],
    skills: [...deriveAgentSkills(options.embodiment), agentModeSkill()],
    supportsAuthenticatedExtendedCard: false,
  };
}
