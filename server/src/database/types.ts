/**
 * @file types.ts
 * @description Type utilities for database <-> domain conversion
 */

import type {
  Robot as DbRobot,
  Message as DbMessage,
  Task as DbTask,
  Conversation as DbConversation,
  AgentCard as DbAgentCard,
  Event as DbEvent,
  RobotEndpoints as DbRobotEndpoints,
} from '@prisma/client';
import type {
  A2AMessage,
  A2ATask,
  A2AConversation,
  A2AAgentCard,
  A2ATaskStatus,
  A2AEvent,
  A2APart,
  A2AArtifact,
  A2ARole,
  A2ATaskState,
} from '../types/index.js';
import type {
  Robot,
  RobotLocation,
  RobotStatus,
  RobotEndpoints,
} from '../services/RobotManager.js';

// ============================================================================
// ROBOT CONVERSIONS
// ============================================================================

/**
 * Convert Prisma Robot to domain Robot
 */
export function dbRobotToDomain(db: DbRobot): Robot {
  return {
    id: db.id,
    name: db.name,
    model: db.model,
    serialNumber: db.serialNumber ?? undefined,
    status: db.status as RobotStatus,
    batteryLevel: db.batteryLevel,
    location: JSON.parse(db.location) as RobotLocation,
    lastSeen: db.lastSeen.toISOString(),
    currentTaskId: db.currentTaskId ?? undefined,
    currentTaskName: db.currentTaskName ?? undefined,
    capabilities: JSON.parse(db.capabilities) as string[],
    firmware: db.firmware ?? undefined,
    ipAddress: db.ipAddress ?? undefined,
    metadata: db.metadata ? (JSON.parse(db.metadata) as Record<string, unknown>) : undefined,
    createdAt: db.createdAt.toISOString(),
    updatedAt: db.updatedAt.toISOString(),
    a2aEnabled: db.a2aEnabled,
    a2aAgentUrl: db.a2aAgentUrl ?? undefined,
  };
}

/**
 * Convert domain Robot to Prisma create input
 */
export function domainRobotToDb(robot: Robot): {
  id: string;
  name: string;
  model: string;
  serialNumber?: string;
  status: string;
  batteryLevel: number;
  location: string;
  lastSeen: Date;
  currentTaskId?: string;
  currentTaskName?: string;
  capabilities: string;
  firmware?: string;
  ipAddress?: string;
  metadata?: string;
  a2aEnabled: boolean;
  a2aAgentUrl?: string;
} {
  return {
    id: robot.id,
    name: robot.name,
    model: robot.model,
    serialNumber: robot.serialNumber,
    status: robot.status,
    batteryLevel: robot.batteryLevel,
    location: JSON.stringify(robot.location),
    lastSeen: new Date(robot.lastSeen),
    currentTaskId: robot.currentTaskId,
    currentTaskName: robot.currentTaskName,
    capabilities: JSON.stringify(robot.capabilities),
    firmware: robot.firmware,
    ipAddress: robot.ipAddress,
    metadata: robot.metadata ? JSON.stringify(robot.metadata) : undefined,
    a2aEnabled: robot.a2aEnabled ?? false,
    a2aAgentUrl: robot.a2aAgentUrl,
  };
}

/**
 * Convert Prisma RobotEndpoints to domain RobotEndpoints
 */
export function dbEndpointsToDomain(db: DbRobotEndpoints): RobotEndpoints {
  return {
    robot: db.robot,
    command: db.command,
    telemetry: db.telemetry,
    telemetryWs: db.telemetryWs,
  };
}

// ============================================================================
// MESSAGE CONVERSIONS
// ============================================================================

/**
 * Convert Prisma Message to domain A2AMessage
 */
export function dbMessageToDomain(db: DbMessage): A2AMessage {
  return {
    messageId: db.id,
    role: db.role as A2ARole,
    parts: JSON.parse(db.parts) as A2APart[],
    contextId: db.conversationId ?? undefined,
    taskId: db.taskId ?? undefined,
    metadata: db.metadata ? (JSON.parse(db.metadata) as Record<string, unknown>) : undefined,
    timestamp: db.timestamp.toISOString(),
  };
}

/**
 * Convert domain A2AMessage to Prisma create input
 */
export function domainMessageToDb(
  message: A2AMessage,
  conversationId?: string
): {
  id: string;
  role: string;
  parts: string;
  conversationId?: string;
  taskId?: string;
  metadata?: string;
  timestamp: Date;
} {
  return {
    id: message.messageId,
    role: message.role,
    parts: JSON.stringify(message.parts),
    conversationId: conversationId ?? message.contextId,
    taskId: message.taskId,
    metadata: message.metadata ? JSON.stringify(message.metadata) : undefined,
    timestamp: message.timestamp ? new Date(message.timestamp) : new Date(),
  };
}

// ============================================================================
// TASK CONVERSIONS
// ============================================================================

/**
 * Convert Prisma Task to domain A2ATask
 */
export function dbTaskToDomain(db: DbTask): A2ATask {
  const status: A2ATaskStatus = {
    state: db.state as A2ATaskState,
    message: db.statusMessage ? (JSON.parse(db.statusMessage) as A2AMessage) : undefined,
    timestamp: db.statusTimestamp.toISOString(),
  };

  return {
    id: db.id,
    contextId: db.conversationId ?? undefined,
    status,
    artifacts: JSON.parse(db.artifacts) as A2AArtifact[],
    history: JSON.parse(db.history) as A2AMessage[],
    createdAt: db.createdAt.toISOString(),
    updatedAt: db.updatedAt.toISOString(),
  };
}

/**
 * Convert domain A2ATask to Prisma create input
 */
export function domainTaskToDb(task: A2ATask): {
  id: string;
  conversationId?: string;
  state: string;
  statusMessage?: string;
  statusTimestamp: Date;
  artifacts: string;
  history: string;
} {
  return {
    id: task.id,
    conversationId: task.contextId,
    state: task.status.state,
    statusMessage: task.status.message ? JSON.stringify(task.status.message) : undefined,
    statusTimestamp: task.status.timestamp ? new Date(task.status.timestamp) : new Date(),
    artifacts: JSON.stringify(task.artifacts ?? []),
    history: JSON.stringify(task.history ?? []),
  };
}

// ============================================================================
// CONVERSATION CONVERSIONS
// ============================================================================

/**
 * Convert Prisma Conversation to domain A2AConversation
 */
export function dbConversationToDomain(
  db: DbConversation & { messages?: DbMessage[]; tasks?: DbTask[] }
): A2AConversation {
  return {
    conversationId: db.id,
    name: db.name,
    isActive: db.isActive,
    taskIds: db.tasks?.map((t) => t.id) ?? [],
    messages: db.messages?.map(dbMessageToDomain) ?? [],
    robotId: db.robotId ?? undefined,
    createdAt: db.createdAt.toISOString(),
    updatedAt: db.updatedAt.toISOString(),
  };
}

// ============================================================================
// AGENT CARD CONVERSIONS
// ============================================================================

/**
 * Convert Prisma AgentCard to domain A2AAgentCard
 */
export function dbAgentCardToDomain(db: DbAgentCard): A2AAgentCard {
  return {
    name: db.name,
    description: db.description,
    url: db.url,
    version: db.version ?? undefined,
    documentationUrl: db.documentationUrl ?? undefined,
    provider: db.provider ? (JSON.parse(db.provider) as A2AAgentCard['provider']) : undefined,
    capabilities: db.capabilities
      ? (JSON.parse(db.capabilities) as A2AAgentCard['capabilities'])
      : undefined,
    authentication: db.authentication
      ? (JSON.parse(db.authentication) as A2AAgentCard['authentication'])
      : undefined,
    defaultInputModes: JSON.parse(db.defaultInputModes) as string[],
    defaultOutputModes: JSON.parse(db.defaultOutputModes) as string[],
    skills: JSON.parse(db.skills) as A2AAgentCard['skills'],
  };
}

/**
 * Convert domain A2AAgentCard to Prisma create input
 */
export function domainAgentCardToDb(
  card: A2AAgentCard,
  robotId?: string
): {
  name: string;
  description: string;
  url: string;
  version?: string;
  documentationUrl?: string;
  provider?: string;
  capabilities?: string;
  authentication?: string;
  defaultInputModes: string;
  defaultOutputModes: string;
  skills: string;
  robotId?: string;
} {
  return {
    name: card.name,
    description: card.description,
    url: card.url,
    version: card.version,
    documentationUrl: card.documentationUrl,
    provider: card.provider ? JSON.stringify(card.provider) : undefined,
    capabilities: card.capabilities ? JSON.stringify(card.capabilities) : undefined,
    authentication: card.authentication ? JSON.stringify(card.authentication) : undefined,
    defaultInputModes: JSON.stringify(card.defaultInputModes ?? []),
    defaultOutputModes: JSON.stringify(card.defaultOutputModes ?? []),
    skills: JSON.stringify(card.skills ?? []),
    robotId,
  };
}

// ============================================================================
// EVENT CONVERSIONS
// ============================================================================

/**
 * Convert Prisma Event to domain A2AEvent
 */
export function dbEventToDomain(db: DbEvent): A2AEvent {
  return {
    id: db.id,
    actor: db.actor,
    content: JSON.parse(db.content) as A2AMessage,
    timestamp: db.timestamp.getTime(),
  };
}

/**
 * Convert domain A2AEvent to Prisma create input
 */
export function domainEventToDb(event: A2AEvent): {
  id: string;
  actor: string;
  content: string;
  timestamp: Date;
} {
  return {
    id: event.id,
    actor: event.actor,
    content: JSON.stringify(event.content),
    timestamp: new Date(event.timestamp),
  };
}
