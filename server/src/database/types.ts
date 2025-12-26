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
  ProcessDefinition as DbProcessDefinition,
  ProcessInstance as DbProcessInstance,
  StepInstance as DbStepInstance,
  RobotTask as DbRobotTask,
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
import type {
  ProcessDefinition,
  ProcessDefinitionStatus,
  ProcessInstance,
  ProcessInstanceStatus,
  StepInstance,
  StepInstanceStatus,
  StepTemplate,
  StepActionType,
  StepResult,
  Priority,
} from '../types/process.types.js';
import type {
  RobotTask,
  RobotTaskStatus,
  RobotTaskSource,
  RobotTaskResult,
} from '../types/robotTask.types.js';
import {
  RobotLocationSchema,
  safeParseJson,
  safeParseJsonUntyped,
} from './schemas.js';

// ============================================================================
// ROBOT CONVERSIONS
// ============================================================================

// Default location for fallback
const DEFAULT_LOCATION: RobotLocation = { x: 0, y: 0, floor: '1' };

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
    location: safeParseJson(db.location, RobotLocationSchema, DEFAULT_LOCATION, `robot ${db.id} location`),
    lastSeen: db.lastSeen.toISOString(),
    currentTaskId: db.currentTaskId ?? undefined,
    currentTaskName: db.currentTaskName ?? undefined,
    capabilities: safeParseJsonUntyped<string[]>(db.capabilities, [], `robot ${db.id} capabilities`),
    firmware: db.firmware ?? undefined,
    ipAddress: db.ipAddress ?? undefined,
    metadata: db.metadata
      ? safeParseJsonUntyped<Record<string, unknown>>(db.metadata, {}, `robot ${db.id} metadata`)
      : undefined,
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
    parts: safeParseJsonUntyped<A2APart[]>(db.parts, [], `message ${db.id} parts`),
    contextId: db.conversationId ?? undefined,
    taskId: db.taskId ?? undefined,
    metadata: db.metadata
      ? safeParseJsonUntyped<Record<string, unknown>>(db.metadata, {}, `message ${db.id} metadata`)
      : undefined,
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
    message: db.statusMessage
      ? safeParseJsonUntyped<A2AMessage | undefined>(db.statusMessage, undefined, `task ${db.id} statusMessage`)
      : undefined,
    timestamp: db.statusTimestamp.toISOString(),
  };

  return {
    id: db.id,
    contextId: db.conversationId ?? undefined,
    status,
    artifacts: safeParseJsonUntyped<A2AArtifact[]>(db.artifacts, [], `task ${db.id} artifacts`),
    history: safeParseJsonUntyped<A2AMessage[]>(db.history, [], `task ${db.id} history`),
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
    provider: db.provider
      ? safeParseJsonUntyped<A2AAgentCard['provider']>(db.provider, undefined, `agent ${db.name} provider`)
      : undefined,
    capabilities: db.capabilities
      ? safeParseJsonUntyped<A2AAgentCard['capabilities']>(db.capabilities, undefined, `agent ${db.name} capabilities`)
      : undefined,
    authentication: db.authentication
      ? safeParseJsonUntyped<A2AAgentCard['authentication']>(db.authentication, undefined, `agent ${db.name} authentication`)
      : undefined,
    defaultInputModes: safeParseJsonUntyped<string[]>(db.defaultInputModes, [], `agent ${db.name} inputModes`),
    defaultOutputModes: safeParseJsonUntyped<string[]>(db.defaultOutputModes, [], `agent ${db.name} outputModes`),
    skills: safeParseJsonUntyped<A2AAgentCard['skills']>(db.skills, [], `agent ${db.name} skills`),
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

// Default message for fallback
const DEFAULT_MESSAGE: A2AMessage = {
  messageId: 'unknown',
  role: 'agent',
  parts: [],
};

/**
 * Convert Prisma Event to domain A2AEvent
 */
export function dbEventToDomain(db: DbEvent): A2AEvent {
  return {
    id: db.id,
    actor: db.actor,
    content: safeParseJsonUntyped<A2AMessage>(db.content, DEFAULT_MESSAGE, `event ${db.id} content`),
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

// ============================================================================
// PROCESS DEFINITION CONVERSIONS
// ============================================================================

/**
 * Convert Prisma ProcessDefinition to domain ProcessDefinition
 */
export function dbProcessDefinitionToDomain(db: DbProcessDefinition): ProcessDefinition {
  return {
    id: db.id,
    name: db.name,
    description: db.description ?? undefined,
    version: db.version,
    status: db.status as ProcessDefinitionStatus,
    stepTemplates: safeParseJsonUntyped<StepTemplate[]>(db.stepTemplates, [], `process ${db.id} stepTemplates`),
    requiredCapabilities: safeParseJsonUntyped<string[]>(db.requiredCapabilities, [], `process ${db.id} capabilities`),
    estimatedDurationMinutes: db.estimatedDurationMinutes ?? undefined,
    maxConcurrentInstances: db.maxConcurrentInstances ?? undefined,
    tags: safeParseJsonUntyped<string[]>(db.tags, [], `process ${db.id} tags`),
    createdBy: db.createdBy,
    createdAt: db.createdAt.toISOString(),
    updatedAt: db.updatedAt.toISOString(),
  };
}

/**
 * Convert domain ProcessDefinition to Prisma create input
 */
export function domainProcessDefinitionToDb(process: ProcessDefinition): {
  id: string;
  name: string;
  description?: string;
  version: number;
  status: string;
  stepTemplates: string;
  requiredCapabilities: string;
  estimatedDurationMinutes?: number;
  maxConcurrentInstances?: number;
  tags: string;
  createdBy: string;
} {
  return {
    id: process.id,
    name: process.name,
    description: process.description,
    version: process.version,
    status: process.status,
    stepTemplates: JSON.stringify(process.stepTemplates),
    requiredCapabilities: JSON.stringify(process.requiredCapabilities ?? []),
    estimatedDurationMinutes: process.estimatedDurationMinutes,
    maxConcurrentInstances: process.maxConcurrentInstances,
    tags: JSON.stringify(process.tags ?? []),
    createdBy: process.createdBy,
  };
}

// ============================================================================
// PROCESS INSTANCE CONVERSIONS
// ============================================================================

/**
 * Convert Prisma ProcessInstance to domain ProcessInstance
 */
export function dbProcessInstanceToDomain(
  db: DbProcessInstance & { steps?: DbStepInstance[] }
): ProcessInstance {
  return {
    id: db.id,
    processDefinitionId: db.processDefinitionId,
    processName: db.processName,
    description: db.description ?? undefined,
    status: db.status as ProcessInstanceStatus,
    priority: db.priority as Priority,
    steps: db.steps?.map(dbStepInstanceToDomain) ?? [],
    currentStepIndex: db.currentStepIndex,
    progress: db.progress,
    preferredRobotIds: safeParseJsonUntyped<string[]>(db.preferredRobotIds, [], `instance ${db.id} preferredRobots`),
    assignedRobotIds: safeParseJsonUntyped<string[]>(db.assignedRobotIds, [], `instance ${db.id} assignedRobots`),
    scheduledAt: db.scheduledAt?.toISOString(),
    startedAt: db.startedAt?.toISOString(),
    completedAt: db.completedAt?.toISOString(),
    estimatedCompletionAt: db.estimatedCompletionAt?.toISOString(),
    inputData: db.inputData
      ? safeParseJsonUntyped<Record<string, unknown>>(db.inputData, {}, `instance ${db.id} inputData`)
      : undefined,
    outputData: db.outputData
      ? safeParseJsonUntyped<Record<string, unknown>>(db.outputData, {}, `instance ${db.id} outputData`)
      : undefined,
    errorMessage: db.errorMessage ?? undefined,
    createdBy: db.createdBy,
    createdAt: db.createdAt.toISOString(),
    updatedAt: db.updatedAt.toISOString(),
  };
}

/**
 * Convert domain ProcessInstance to Prisma create input
 */
export function domainProcessInstanceToDb(instance: ProcessInstance): {
  id: string;
  processDefinitionId: string;
  processName: string;
  description?: string;
  status: string;
  priority: string;
  currentStepIndex: number;
  progress: number;
  preferredRobotIds: string;
  assignedRobotIds: string;
  scheduledAt?: Date;
  startedAt?: Date;
  completedAt?: Date;
  estimatedCompletionAt?: Date;
  inputData?: string;
  outputData?: string;
  errorMessage?: string;
  createdBy: string;
} {
  return {
    id: instance.id,
    processDefinitionId: instance.processDefinitionId,
    processName: instance.processName,
    description: instance.description,
    status: instance.status,
    priority: instance.priority,
    currentStepIndex: instance.currentStepIndex,
    progress: instance.progress,
    preferredRobotIds: JSON.stringify(instance.preferredRobotIds ?? []),
    assignedRobotIds: JSON.stringify(instance.assignedRobotIds ?? []),
    scheduledAt: instance.scheduledAt ? new Date(instance.scheduledAt) : undefined,
    startedAt: instance.startedAt ? new Date(instance.startedAt) : undefined,
    completedAt: instance.completedAt ? new Date(instance.completedAt) : undefined,
    estimatedCompletionAt: instance.estimatedCompletionAt ? new Date(instance.estimatedCompletionAt) : undefined,
    inputData: instance.inputData ? JSON.stringify(instance.inputData) : undefined,
    outputData: instance.outputData ? JSON.stringify(instance.outputData) : undefined,
    errorMessage: instance.errorMessage,
    createdBy: instance.createdBy,
  };
}

// ============================================================================
// STEP INSTANCE CONVERSIONS
// ============================================================================

/**
 * Convert Prisma StepInstance to domain StepInstance
 */
export function dbStepInstanceToDomain(db: DbStepInstance): StepInstance {
  return {
    id: db.id,
    processInstanceId: db.processInstanceId,
    stepTemplateId: db.stepTemplateId,
    order: db.order,
    name: db.name,
    description: db.description ?? undefined,
    actionType: db.actionType as StepActionType,
    actionConfig: safeParseJsonUntyped<Record<string, unknown>>(db.actionConfig, {}, `step ${db.id} actionConfig`),
    status: db.status as StepInstanceStatus,
    robotTaskId: undefined, // Will be populated from relation if needed
    assignedRobotId: db.assignedRobotId ?? undefined,
    startedAt: db.startedAt?.toISOString(),
    completedAt: db.completedAt?.toISOString(),
    result: db.result
      ? safeParseJsonUntyped<StepResult>(db.result, { success: false }, `step ${db.id} result`)
      : undefined,
    error: db.error ?? undefined,
    retryCount: db.retryCount,
    maxRetries: db.maxRetries,
  };
}

/**
 * Convert domain StepInstance to Prisma create input
 */
export function domainStepInstanceToDb(step: StepInstance): {
  id: string;
  processInstanceId: string;
  stepTemplateId: string;
  order: number;
  name: string;
  description?: string;
  actionType: string;
  actionConfig: string;
  status: string;
  assignedRobotId?: string;
  startedAt?: Date;
  completedAt?: Date;
  result?: string;
  error?: string;
  retryCount: number;
  maxRetries: number;
} {
  return {
    id: step.id,
    processInstanceId: step.processInstanceId,
    stepTemplateId: step.stepTemplateId,
    order: step.order,
    name: step.name,
    description: step.description,
    actionType: step.actionType,
    actionConfig: JSON.stringify(step.actionConfig),
    status: step.status,
    assignedRobotId: step.assignedRobotId,
    startedAt: step.startedAt ? new Date(step.startedAt) : undefined,
    completedAt: step.completedAt ? new Date(step.completedAt) : undefined,
    result: step.result ? JSON.stringify(step.result) : undefined,
    error: step.error,
    retryCount: step.retryCount,
    maxRetries: step.maxRetries,
  };
}

// ============================================================================
// ROBOT TASK CONVERSIONS
// ============================================================================

/**
 * Convert Prisma RobotTask to domain RobotTask
 */
export function dbRobotTaskToDomain(db: DbRobotTask): RobotTask {
  return {
    id: db.id,
    processInstanceId: db.processInstanceId ?? undefined,
    stepInstanceId: db.stepInstanceId ?? undefined,
    source: db.source as RobotTaskSource,
    robotId: db.robotId,
    priority: db.priority as Priority,
    status: db.status as RobotTaskStatus,
    actionType: db.actionType as StepActionType,
    actionConfig: safeParseJsonUntyped<Record<string, unknown>>(db.actionConfig, {}, `robotTask ${db.id} actionConfig`),
    instruction: db.instruction,
    a2aTaskId: db.a2aTaskId ?? undefined,
    a2aContextId: db.a2aContextId ?? undefined,
    createdAt: db.createdAt.toISOString(),
    assignedAt: db.assignedAt?.toISOString(),
    startedAt: db.startedAt?.toISOString(),
    completedAt: db.completedAt?.toISOString(),
    timeoutMs: db.timeoutMs ?? undefined,
    result: db.result
      ? safeParseJsonUntyped<RobotTaskResult>(db.result, { success: false, durationMs: 0 }, `robotTask ${db.id} result`)
      : undefined,
    error: db.error ?? undefined,
    retryCount: db.retryCount,
    maxRetries: db.maxRetries,
  };
}

/**
 * Convert domain RobotTask to Prisma create input
 */
export function domainRobotTaskToDb(task: RobotTask): {
  id: string;
  processInstanceId?: string;
  stepInstanceId?: string;
  source: string;
  robotId: string;
  priority: string;
  status: string;
  actionType: string;
  actionConfig: string;
  instruction: string;
  a2aTaskId?: string;
  a2aContextId?: string;
  assignedAt?: Date;
  startedAt?: Date;
  completedAt?: Date;
  timeoutMs?: number;
  result?: string;
  error?: string;
  retryCount: number;
  maxRetries: number;
} {
  return {
    id: task.id,
    processInstanceId: task.processInstanceId,
    stepInstanceId: task.stepInstanceId,
    source: task.source,
    robotId: task.robotId,
    priority: task.priority,
    status: task.status,
    actionType: task.actionType,
    actionConfig: JSON.stringify(task.actionConfig),
    instruction: task.instruction,
    a2aTaskId: task.a2aTaskId,
    a2aContextId: task.a2aContextId,
    assignedAt: task.assignedAt ? new Date(task.assignedAt) : undefined,
    startedAt: task.startedAt ? new Date(task.startedAt) : undefined,
    completedAt: task.completedAt ? new Date(task.completedAt) : undefined,
    timeoutMs: task.timeoutMs,
    result: task.result ? JSON.stringify(task.result) : undefined,
    error: task.error,
    retryCount: task.retryCount,
    maxRetries: task.maxRetries,
  };
}
