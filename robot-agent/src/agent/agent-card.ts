/**
 * @file agent-card.ts
 * @description A2A AgentCard definition for the simulated robot
 */

import type { AgentCard } from '@a2a-js/sdk';
import type { RobotClass } from '../robot/types.js';

interface AgentCardOptions {
  robotId: string;
  robotName: string;
  port: number;
  robotClass: RobotClass;
  maxPayloadKg: number;
  robotDescription: string;
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

export function createRobotAgentCard(options: AgentCardOptions): AgentCard {
  const { robotId, robotName, port, robotClass, maxPayloadKg, robotDescription } = options;
  const classDescription = getClassDescription(robotClass, maxPayloadKg);

  // Public URL for agent card discovery (configurable for K8s/Docker deployments)
  const publicUrl = process.env.PUBLIC_URL || `http://localhost:${port}`;

  return {
    protocolVersion: '0.2.1',
    name: `Simulated Robot: ${robotName}`,
    description: `${classDescription}. ${robotDescription}. Can execute natural language commands for movement, picking up objects, and placing items. This robot can be controlled via A2A protocol or REST API.`,
    url: `${publicUrl}/`,
    provider: {
      organization: 'RoboMindOS',
      url: 'https://robomind.io',
    },
    version: '1.0.0',
    capabilities: {
      streaming: true,
      pushNotifications: false,
      stateTransitionHistory: true,
    },
    defaultInputModes: ['text'],
    defaultOutputModes: ['text', 'task-status'],
    skills: [
      {
        id: 'navigation',
        name: 'Navigation',
        description:
          'Move the robot to specific locations, zones, or coordinates within the facility',
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
      },
      {
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
      },
      {
        id: 'status_control',
        name: 'Status & Control',
        description:
          'Query robot status, stop operations, check battery level, emergency controls',
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
      },
    ],
    supportsAuthenticatedExtendedCard: false,
  };
}
