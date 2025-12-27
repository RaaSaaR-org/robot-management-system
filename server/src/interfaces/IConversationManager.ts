/**
 * @file IConversationManager.ts
 * @description Interface for conversation management service
 * @feature conversations
 */

import type {
  A2AConversation,
  A2AMessage,
  A2ATask,
  A2ATaskStatus,
  A2AEvent,
  A2AAgentCard,
  A2ATaskEvent,
} from '../types/index.js';

/**
 * Callback type for task events
 */
export type TaskEventCallback = (event: A2ATaskEvent) => void;

/**
 * Result of processing a message
 */
export interface ProcessMessageResult {
  messageId: string;
  task?: A2ATask;
}

/**
 * Interface for conversation management operations
 * Enables dependency injection and testing
 */
export interface IConversationManager {
  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  /**
   * Initialize the manager and load agents from database
   */
  initialize(): Promise<void>;

  // ============================================================================
  // CONVERSATION METHODS
  // ============================================================================

  /**
   * Create a new conversation
   * @param robotId - Optional robot ID to associate
   * @param name - Optional conversation name
   */
  createConversation(robotId?: string, name?: string): Promise<A2AConversation>;

  /**
   * Get a conversation by ID
   * @param conversationId - The conversation's unique identifier
   */
  getConversation(conversationId: string): Promise<A2AConversation | undefined>;

  /**
   * List all conversations
   */
  listConversations(): Promise<A2AConversation[]>;

  /**
   * Delete a conversation
   * @param conversationId - The conversation's unique identifier
   * @returns True if successfully deleted
   */
  deleteConversation(conversationId: string): Promise<boolean>;

  // ============================================================================
  // MESSAGE METHODS
  // ============================================================================

  /**
   * Add a message to a conversation and process it
   * @param conversationId - The conversation's unique identifier
   * @param text - The message text
   * @param targetAgentUrl - Optional specific agent URL to send to
   */
  processMessage(
    conversationId: string,
    text: string,
    targetAgentUrl?: string
  ): Promise<ProcessMessageResult>;

  /**
   * Get messages for a conversation
   * @param conversationId - The conversation's unique identifier
   */
  getMessages(conversationId: string): Promise<A2AMessage[]>;

  /**
   * Get pending message statuses with progress text
   */
  getPendingMessages(): Array<[string, string]>;

  // ============================================================================
  // TASK METHODS
  // ============================================================================

  /**
   * Create a new task
   * @param contextId - Optional conversation context ID
   */
  createTask(contextId?: string): Promise<A2ATask>;

  /**
   * Update task status
   * @param taskId - The task's unique identifier
   * @param status - New status
   */
  updateTaskStatus(taskId: string, status: A2ATaskStatus): Promise<void>;

  /**
   * Get a task by ID
   * @param taskId - The task's unique identifier
   */
  getTask(taskId: string): Promise<A2ATask | undefined>;

  /**
   * List all tasks
   */
  listTasks(): Promise<A2ATask[]>;

  /**
   * Subscribe to task events
   * @param callback - Event handler function
   * @returns Unsubscribe function
   */
  onTaskEvent(callback: TaskEventCallback): () => void;

  // ============================================================================
  // AGENT METHODS
  // ============================================================================

  /**
   * Register an external agent
   * @param card - The agent's card metadata
   */
  registerAgent(card: A2AAgentCard): Promise<void>;

  /**
   * Unregister an agent
   * @param name - The agent's name
   * @returns True if successfully unregistered
   */
  unregisterAgent(name: string): Promise<boolean>;

  /**
   * Get a registered agent (sync from cache)
   * @param name - The agent's name
   */
  getAgent(name: string): A2AAgentCard | undefined;

  /**
   * Get a registered agent (async from database)
   * @param name - The agent's name
   */
  getAgentAsync(name: string): Promise<A2AAgentCard | undefined>;

  /**
   * List all registered agents (sync from cache)
   */
  listAgents(): A2AAgentCard[];

  /**
   * List all registered agents (async from database)
   */
  listAgentsAsync(): Promise<A2AAgentCard[]>;

  // ============================================================================
  // ORCHESTRATION METHODS
  // ============================================================================

  /**
   * Select the best agent for a given message
   * @param message - The message text
   * @param connectedAgents - Optional list of connected agents
   */
  selectAgentForMessage(message: string, connectedAgents?: A2AAgentCard[]): A2AAgentCard | null;

  /**
   * Process an orchestrated message - select agent and route
   * @param conversationId - The conversation's unique identifier
   * @param text - The message text
   */
  processOrchestratedMessage(
    conversationId: string,
    text: string
  ): Promise<ProcessMessageResult>;

  // ============================================================================
  // EVENT METHODS
  // ============================================================================

  /**
   * Add an event
   * @param event - The event to add
   */
  addEvent(event: A2AEvent): Promise<void>;

  /**
   * Get all events
   */
  getEvents(): Promise<A2AEvent[]>;

  /**
   * Get events since timestamp
   * @param timestamp - Unix timestamp in milliseconds
   */
  getEventsSince(timestamp: number): Promise<A2AEvent[]>;
}
