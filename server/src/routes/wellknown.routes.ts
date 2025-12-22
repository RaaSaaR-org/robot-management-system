/**
 * @file wellknown.routes.ts
 * @description Routes for A2A agent discovery (well-known endpoints)
 */

import { Router, type Request, type Response } from 'express';
import type { A2AAgentCard } from '../types/index.js';

export const wellKnownRoutes = Router();

/**
 * Fleet-level agent card
 * This represents the RoboMindOS fleet as an A2A agent
 */
const FLEET_AGENT_CARD: A2AAgentCard = {
  name: 'RoboMindOS Fleet',
  description: 'Robot fleet management system with natural language control. Manages humanoid robots for various tasks including logistics, inspection, and assistance.',
  url: 'http://localhost:3001',
  version: '0.1.0',
  provider: {
    organization: 'RoboMindOS',
    url: 'https://robomind.io',
  },
  capabilities: {
    streaming: true,
    pushNotifications: false,
    stateTransitionHistory: true,
  },
  defaultInputModes: ['text'],
  defaultOutputModes: ['text'],
  skills: [
    {
      id: 'robot-command',
      name: 'Robot Command',
      description: 'Send natural language commands to robots in the fleet',
      tags: ['robotics', 'control', 'automation'],
      examples: [
        'Move robot Alpha to warehouse zone B',
        'Pick up the box near the door',
        'Return all robots to charging stations',
      ],
    },
    {
      id: 'fleet-status',
      name: 'Fleet Status',
      description: 'Get status information about robots in the fleet',
      tags: ['robotics', 'monitoring', 'status'],
      examples: [
        'What is the status of robot Alpha?',
        'How many robots are online?',
        'Which robots need charging?',
      ],
    },
    {
      id: 'task-management',
      name: 'Task Management',
      description: 'Create, monitor, and manage tasks for robots',
      tags: ['robotics', 'tasks', 'workflow'],
      examples: [
        'Create a task for robot Alpha to patrol zone A',
        'What tasks are currently running?',
        'Cancel all pending tasks',
      ],
    },
  ],
};

/**
 * GET /agent_card.json - Fleet-level agent card
 */
wellKnownRoutes.get('/agent_card.json', (_req: Request, res: Response) => {
  res.json(FLEET_AGENT_CARD);
});

/**
 * GET /robots/:robotId/agent_card.json - Robot-specific agent card
 * In a full implementation, this would generate a card based on the robot's capabilities
 */
wellKnownRoutes.get('/robots/:robotId/agent_card.json', (req: Request, res: Response) => {
  const { robotId } = req.params;

  // Generate robot-specific agent card
  const robotAgentCard: A2AAgentCard = {
    name: `Robot ${robotId}`,
    description: `Individual robot agent for robot ${robotId}. Can execute physical tasks and respond to natural language commands.`,
    url: `http://localhost:3001/robots/${robotId}`,
    version: '0.1.0',
    provider: {
      organization: 'RoboMindOS',
      url: 'https://robomind.io',
    },
    capabilities: {
      streaming: true,
      pushNotifications: false,
      stateTransitionHistory: true,
    },
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
    skills: [
      {
        id: 'move',
        name: 'Movement',
        description: 'Move to a specified location',
        tags: ['movement', 'navigation'],
        examples: ['Go to zone A', 'Move to coordinates (10, 20)'],
      },
      {
        id: 'pickup',
        name: 'Pick Up Object',
        description: 'Pick up an object at the current location',
        tags: ['manipulation', 'gripper'],
        examples: ['Pick up the box', 'Grab the package'],
      },
      {
        id: 'drop',
        name: 'Drop Object',
        description: 'Drop the currently held object',
        tags: ['manipulation', 'gripper'],
        examples: ['Drop the box', 'Place the package here'],
      },
      {
        id: 'status',
        name: 'Status Report',
        description: 'Report current status including battery, location, and sensors',
        tags: ['status', 'monitoring'],
        examples: ['What is your status?', 'Report battery level'],
      },
    ],
  };

  res.json(robotAgentCard);
});

/**
 * GET / - Discovery endpoint (returns available endpoints)
 */
wellKnownRoutes.get('/', (_req: Request, res: Response) => {
  res.json({
    endpoints: {
      fleet_agent_card: '/.well-known/a2a/agent_card.json',
      robot_agent_card: '/.well-known/a2a/robots/:robotId/agent_card.json',
    },
  });
});
