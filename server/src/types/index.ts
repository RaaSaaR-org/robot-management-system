/**
 * @file index.ts
 * @description Shared type definitions for A2A server
 */

// ============================================================================
// A2A PROTOCOL CORE TYPES
// ============================================================================

export type A2ATaskState =
  | 'submitted'
  | 'working'
  | 'input_required'
  | 'completed'
  | 'canceled'
  | 'failed'
  | 'unknown';

export type A2ARole = 'user' | 'agent';

// ============================================================================
// AGENT CARD
// ============================================================================

export interface A2ASkill {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  examples?: string[];
  inputModes?: string[];
  outputModes?: string[];
}

export interface A2AAgentCard {
  name: string;
  description: string;
  url: string;
  version?: string;
  documentationUrl?: string;
  provider?: {
    organization: string;
    url?: string;
  };
  capabilities?: {
    streaming?: boolean;
    pushNotifications?: boolean;
    stateTransitionHistory?: boolean;
  };
  authentication?: {
    schemes: string[];
    credentials?: string;
  };
  defaultInputModes?: string[];
  defaultOutputModes?: string[];
  skills?: A2ASkill[];
}

// ============================================================================
// MESSAGE PARTS
// ============================================================================

export interface A2ATextPart {
  kind: 'text';
  text: string;
}

export interface A2AFileWithBytes {
  bytes: string;
  mimeType: string;
  name?: string;
}

export interface A2AFileWithUri {
  uri: string;
  mimeType: string;
  name?: string;
}

export interface A2AFilePart {
  kind: 'file';
  file: A2AFileWithBytes | A2AFileWithUri;
}

export interface A2ADataPart {
  kind: 'data';
  data: Record<string, unknown>;
}

export type A2APart = A2ATextPart | A2AFilePart | A2ADataPart;

// ============================================================================
// MESSAGE
// ============================================================================

export interface A2AMessage {
  messageId: string;
  role: A2ARole;
  parts: A2APart[];
  contextId?: string;
  taskId?: string;
  metadata?: Record<string, unknown>;
  timestamp?: string;
}

// ============================================================================
// TASK
// ============================================================================

export interface A2ATaskStatus {
  state: A2ATaskState;
  message?: A2AMessage;
  timestamp?: string;
}

export interface A2AArtifact {
  artifactId: string;
  name?: string;
  description?: string;
  parts: A2APart[];
  index?: number;
  append?: boolean;
  lastChunk?: boolean;
}

export interface A2ATask {
  id: string;
  contextId?: string;
  status: A2ATaskStatus;
  artifacts?: A2AArtifact[];
  history?: A2AMessage[];
  createdAt?: string;
  updatedAt?: string;
}

// ============================================================================
// TASK EVENTS
// ============================================================================

export interface A2ATaskStatusUpdateEvent {
  type: 'status_update';
  taskId: string;
  contextId?: string;
  status: A2ATaskStatus;
}

export interface A2ATaskArtifactUpdateEvent {
  type: 'artifact_update';
  taskId: string;
  contextId?: string;
  artifact: A2AArtifact;
  append?: boolean;
  lastChunk?: boolean;
}

export type A2ATaskEvent = A2ATaskStatusUpdateEvent | A2ATaskArtifactUpdateEvent;

// ============================================================================
// CONVERSATION
// ============================================================================

export interface A2AConversation {
  conversationId: string;
  name: string;
  isActive: boolean;
  taskIds: string[];
  messages: A2AMessage[];
  robotId?: string;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// EVENT
// ============================================================================

export interface A2AEvent {
  id: string;
  actor: string;
  content: A2AMessage;
  timestamp: number;
}

// ============================================================================
// ROBOT AGENT
// ============================================================================

export interface RobotAgentConfig {
  robotId: string;
  agentCard: A2AAgentCard;
  isEnabled: boolean;
  connectedAgents: string[];
}

// ============================================================================
// JSON-RPC
// ============================================================================

export interface JSONRPCRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: unknown;
}

export interface JSONRPCError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JSONRPCResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: JSONRPCError;
}
