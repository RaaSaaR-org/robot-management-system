/**
 * @file a2a.types.ts
 * @description Type definitions for A2A (Agent-to-Agent) protocol entities
 * @feature a2a
 * @dependencies None
 */

// ============================================================================
// A2A PROTOCOL CORE TYPES
// ============================================================================

/** Chat mode for A2A conversations */
export type A2AChatMode = 'direct' | 'orchestration';

/** A2A Task States (from protocol spec) */
export type A2ATaskState =
  | 'submitted'
  | 'working'
  | 'input_required'
  | 'completed'
  | 'canceled'
  | 'failed'
  | 'unknown';

/** A2A Message Role */
export type A2ARole = 'user' | 'agent';

/** A2A Transport Protocol */
export type A2ATransportProtocol = 'jsonrpc' | 'http_json';

// ============================================================================
// AGENT CARD (Discovery)
// ============================================================================

/** Agent skill definition */
export interface A2ASkill {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  examples?: string[];
  inputModes?: string[];
  outputModes?: string[];
}

/** Agent authentication configuration */
export interface A2AAgentAuth {
  schemes: string[];
  credentials?: string;
}

/** Agent provider information */
export interface A2AAgentProvider {
  organization: string;
  url?: string;
}

/** Agent capabilities */
export interface A2AAgentCapabilities {
  streaming?: boolean;
  pushNotifications?: boolean;
  stateTransitionHistory?: boolean;
}

/** Agent card - the discoverable identity of an A2A agent */
export interface A2AAgentCard {
  name: string;
  description: string;
  url: string;
  version?: string;
  documentationUrl?: string;
  provider?: A2AAgentProvider;
  capabilities?: A2AAgentCapabilities;
  authentication?: A2AAgentAuth;
  defaultInputModes?: string[];
  defaultOutputModes?: string[];
  skills?: A2ASkill[];
}

// ============================================================================
// MESSAGE PARTS
// ============================================================================

/** Text content part */
export interface A2ATextPart {
  kind: 'text';
  text: string;
}

/** File content with bytes (base64 encoded) */
export interface A2AFileWithBytes {
  bytes: string;
  mimeType: string;
  name?: string;
}

/** File content with URI reference */
export interface A2AFileWithUri {
  uri: string;
  mimeType: string;
  name?: string;
}

/** File content part */
export interface A2AFilePart {
  kind: 'file';
  file: A2AFileWithBytes | A2AFileWithUri;
}

/** Structured data part */
export interface A2ADataPart {
  kind: 'data';
  data: Record<string, unknown>;
}

/** Union of all part types */
export type A2APart = A2ATextPart | A2AFilePart | A2ADataPart;

// ============================================================================
// MESSAGE
// ============================================================================

/** A2A Message */
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

/** Task status */
export interface A2ATaskStatus {
  state: A2ATaskState;
  message?: A2AMessage;
  timestamp?: string;
}

/** Task artifact */
export interface A2AArtifact {
  artifactId: string;
  name?: string;
  description?: string;
  parts: A2APart[];
  index?: number;
  append?: boolean;
  lastChunk?: boolean;
}

/** A2A Task */
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
// TASK EVENTS (for streaming)
// ============================================================================

/** Task status update event */
export interface A2ATaskStatusUpdateEvent {
  type: 'status_update';
  taskId: string;
  contextId?: string;
  status: A2ATaskStatus;
}

/** Task artifact update event */
export interface A2ATaskArtifactUpdateEvent {
  type: 'artifact_update';
  taskId: string;
  contextId?: string;
  artifact: A2AArtifact;
  append?: boolean;
  lastChunk?: boolean;
}

/** Union of task events */
export type A2ATaskEvent = A2ATaskStatusUpdateEvent | A2ATaskArtifactUpdateEvent;

// ============================================================================
// CONVERSATION
// ============================================================================

/** Conversation grouping related messages */
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

/** Event for tracking agent interactions */
export interface A2AEvent {
  id: string;
  actor: string;
  content: A2AMessage;
  timestamp: number;
}

// ============================================================================
// ROBOT AGENT EXTENSION
// ============================================================================

/** Extended robot with A2A agent capabilities */
export interface RobotAgentConfig {
  robotId: string;
  agentCard: A2AAgentCard;
  isEnabled: boolean;
  connectedAgents: string[];
}

// ============================================================================
// API REQUEST/RESPONSE TYPES
// ============================================================================

/** Create conversation request */
export interface A2ACreateConversationRequest {
  robotId?: string;
  name?: string;
}

/** Create conversation response */
export interface A2ACreateConversationResponse {
  conversation: A2AConversation;
}

/** Send message request */
export interface A2ASendMessageRequest {
  conversationId: string;
  message: string;
  robotId?: string;
  targetAgentUrl?: string;
}

/** Send message response */
export interface A2ASendMessageResponse {
  messageId: string;
  contextId: string;
}

/** Register agent request */
export interface A2ARegisterAgentRequest {
  agentUrl: string;
}

/** Register agent response */
export interface A2ARegisterAgentResponse {
  agentCard: A2AAgentCard;
}

/** List agents response */
export interface A2AListAgentsResponse {
  agents: A2AAgentCard[];
}

/** List conversations response */
export interface A2AListConversationsResponse {
  conversations: A2AConversation[];
}

/** List tasks response */
export interface A2AListTasksResponse {
  tasks: A2ATask[];
}

/** List messages response */
export interface A2AListMessagesResponse {
  messages: A2AMessage[];
}

/** Get events response */
export interface A2AGetEventsResponse {
  events: A2AEvent[];
}

// ============================================================================
// JSON-RPC TYPES
// ============================================================================

/** JSON-RPC request base */
export interface JSONRPCRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: unknown;
}

/** JSON-RPC error */
export interface JSONRPCError {
  code: number;
  message: string;
  data?: unknown;
}

/** JSON-RPC response */
export interface JSONRPCResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: JSONRPCError;
}

// ============================================================================
// STORE TYPES
// ============================================================================

/** A2A Feature state */
export interface A2AState {
  /** All conversations */
  conversations: A2AConversation[];
  /** Currently selected conversation ID */
  currentConversationId: string | null;
  /** All tasks */
  tasks: A2ATask[];
  /** All events */
  events: A2AEvent[];
  /** Registered external agents */
  registeredAgents: A2AAgentCard[];
  /** Robot agent configurations (robotId -> config) */
  robotAgentConfigs: Record<string, RobotAgentConfig>;
  /** Pending message statuses (messageId -> status) */
  pendingMessages: Record<string, 'pending' | 'sent' | 'failed'>;
  /** Completed forms (messageId -> form data) */
  completedForms: Record<string, Record<string, string> | null>;
  /** Form responses (responseMessageId -> formMessageId) */
  formResponses: Record<string, string>;
  /** Loading state */
  isLoading: boolean;
  /** Error message */
  error: string | null;
  /** WebSocket connection status */
  wsConnected: boolean;
  /** Current chat mode (direct = 1:1 with agent, orchestration = AI routes to all agents) */
  chatMode: A2AChatMode;
  /** Gemini API key for LLM-powered orchestration */
  geminiApiKey: string | null;
}

/** A2A Feature actions */
export interface A2AActions {
  // Conversations
  createConversation: (robotId?: string, name?: string) => Promise<A2AConversation>;
  fetchConversations: () => Promise<void>;
  selectConversation: (id: string | null) => void;
  deleteConversation: (id: string) => Promise<void>;

  // Messages
  sendMessage: (request: A2ASendMessageRequest) => Promise<A2ASendMessageResponse>;
  fetchMessages: (conversationId: string) => Promise<void>;

  // Tasks
  fetchTasks: () => Promise<void>;
  updateTask: (task: A2ATask) => void;
  getTask: (taskId: string) => A2ATask | undefined;

  // Agents
  registerAgent: (url: string) => Promise<A2AAgentCard>;
  unregisterAgent: (name: string) => void;
  fetchAgents: () => Promise<void>;

  // Robot Agent Config
  enableRobotAgent: (robotId: string) => Promise<void>;
  disableRobotAgent: (robotId: string) => Promise<void>;
  updateRobotAgentConfig: (config: Partial<RobotAgentConfig> & { robotId: string }) => void;
  fetchRobotAgentConfig: (robotId: string) => Promise<RobotAgentConfig | null>;

  // Events
  addEvent: (event: A2AEvent) => void;
  fetchEvents: () => Promise<void>;

  // WebSocket
  setWsConnected: (connected: boolean) => void;
  handleTaskEvent: (event: A2ATaskEvent) => void;

  // Forms
  submitFormResponse: (messageId: string, taskId: string, data: Record<string, string>) => Promise<void>;
  cancelForm: (messageId: string, taskId: string) => Promise<void>;
  isFormCompleted: (messageId: string) => boolean;
  getFormData: (messageId: string) => Record<string, string> | null | undefined;

  // Chat Mode
  setChatMode: (mode: A2AChatMode) => void;

  // Orchestration
  setGeminiApiKey: (key: string | null) => void;

  // Utility
  clearError: () => void;
  reset: () => void;
}

/** Combined A2A store type */
export type A2AStore = A2AState & A2AActions;

// ============================================================================
// ERROR TYPES
// ============================================================================

/** A2A-related error codes */
export type A2AErrorCode =
  | 'AGENT_NOT_FOUND'
  | 'AGENT_UNREACHABLE'
  | 'CONVERSATION_NOT_FOUND'
  | 'MESSAGE_SEND_FAILED'
  | 'TASK_NOT_FOUND'
  | 'INVALID_AGENT_CARD'
  | 'REGISTRATION_FAILED'
  | 'NETWORK_ERROR'
  | 'UNKNOWN_ERROR';

/** A2A error */
export interface A2AError {
  code: A2AErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

// ============================================================================
// FORM SCHEMA TYPES (for dynamic form rendering)
// ============================================================================

/** Supported form field input types */
export type FormFieldType =
  | 'text'
  | 'email'
  | 'number'
  | 'password'
  | 'tel'
  | 'url'
  | 'date'
  | 'datetime-local'
  | 'time'
  | 'month'
  | 'week'
  | 'color'
  | 'search'
  | 'radio'
  | 'checkbox';

/** Form field property definition (from JSON Schema) */
export interface FormFieldProperty {
  title?: string;
  description?: string;
  type?: string;
  format?: FormFieldType;
  default?: string | number | boolean;
  enum?: string[];
  required?: boolean;
}

/** Form schema structure (from agent DataPart) */
export interface FormSchema {
  form: {
    properties: Record<string, FormFieldProperty>;
    required?: string[];
  };
  instructions?: string;
  form_data?: Record<string, string | number | boolean>;
}

/** Parsed form element for rendering */
export interface FormElement {
  name: string;
  label: string;
  value: string;
  type: FormFieldType;
  required: boolean;
  description?: string;
  options?: string[];
}

/** Form state for tracking user input */
export interface FormState {
  messageId: string;
  taskId?: string;
  data: Record<string, string>;
  errors: Record<string, string>;
  elements: FormElement[];
  isSubmitting: boolean;
  isCompleted: boolean;
  isCanceled: boolean;
}

/**
 * Check if a DataPart contains a form schema
 */
export function isFormData(data: Record<string, unknown>): boolean {
  return (
    typeof data === 'object' &&
    data !== null &&
    'form' in data &&
    typeof data.form === 'object' &&
    data.form !== null &&
    'properties' in (data.form as Record<string, unknown>)
  );
}

/**
 * Parse form schema from DataPart into FormElements
 */
export function parseFormSchema(schema: FormSchema): FormElement[] {
  const { form, form_data } = schema;
  const { properties, required = [] } = form;

  return Object.entries(properties).map(([name, prop]) => ({
    name,
    label: prop.title || name,
    value: form_data?.[name]?.toString() || prop.default?.toString() || '',
    type: prop.format || 'text',
    required: required.includes(name) || prop.required === true,
    description: prop.description,
    options: prop.enum,
  }));
}

/**
 * Get form instructions from schema
 */
export function getFormInstructions(schema: FormSchema): string | undefined {
  return schema.instructions;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Task state display labels */
export const A2A_TASK_STATE_LABELS: Record<A2ATaskState, string> = {
  submitted: 'Submitted',
  working: 'Working',
  input_required: 'Input Required',
  completed: 'Completed',
  canceled: 'Canceled',
  failed: 'Failed',
  unknown: 'Unknown',
};

/** Task state colors for UI */
export const A2A_TASK_STATE_COLORS: Record<A2ATaskState, 'default' | 'info' | 'warning' | 'success' | 'error'> = {
  submitted: 'default',
  working: 'info',
  input_required: 'warning',
  completed: 'success',
  canceled: 'default',
  failed: 'error',
  unknown: 'default',
};

/** Role display labels */
export const A2A_ROLE_LABELS: Record<A2ARole, string> = {
  user: 'You',
  agent: 'Agent',
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Check if a part is a text part
 */
export function isTextPart(part: A2APart): part is A2ATextPart {
  return part.kind === 'text';
}

/**
 * Check if a part is a file part
 */
export function isFilePart(part: A2APart): part is A2AFilePart {
  return part.kind === 'file';
}

/**
 * Check if a part is a data part
 */
export function isDataPart(part: A2APart): part is A2ADataPart {
  return part.kind === 'data';
}

/**
 * Check if a file has bytes (vs URI)
 */
export function isFileWithBytes(file: A2AFileWithBytes | A2AFileWithUri): file is A2AFileWithBytes {
  return 'bytes' in file;
}

/**
 * Extract text content from message parts
 */
export function getMessageText(message: A2AMessage): string {
  return message.parts
    .filter(isTextPart)
    .map((part) => part.text)
    .join('\n');
}

/**
 * Create a text message
 */
export function createTextMessage(text: string, role: A2ARole = 'user'): Omit<A2AMessage, 'messageId'> {
  return {
    role,
    parts: [{ kind: 'text', text }],
  };
}

/**
 * Check if task is in a terminal state
 */
export function isTaskComplete(task: A2ATask): boolean {
  return ['completed', 'failed', 'canceled'].includes(task.status.state);
}

/**
 * Check if task requires user input
 */
export function isTaskAwaitingInput(task: A2ATask): boolean {
  return task.status.state === 'input_required';
}
