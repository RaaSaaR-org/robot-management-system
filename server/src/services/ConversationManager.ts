/**
 * @file ConversationManager.ts
 * @description Core service for managing conversations, messages, and tasks
 */

import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import type {
  A2AConversation,
  A2AMessage,
  A2ATask,
  A2ATaskStatus,
  A2AEvent,
  A2AAgentCard,
  A2ATaskEvent,
  A2APart,
  JSONRPCRequest,
  JSONRPCResponse,
} from '../types/index.js';
import {
  conversationRepository,
  taskRepository,
  agentRepository,
  eventRepository,
} from '../repositories/index.js';

type TaskEventCallback = (event: A2ATaskEvent) => void;

/**
 * ConversationManager - manages all A2A state with database persistence
 */
export class ConversationManager {
  // In-memory caches for active sessions and transient data
  private activeConversations: Map<string, A2AConversation> = new Map();
  private activeTasks: Map<string, A2ATask> = new Map();
  private pendingMessages: Map<string, string> = new Map();
  private taskCallbacks: Set<TaskEventCallback> = new Set();
  // In-memory agent cache for quick lookups
  private agentCache: Map<string, A2AAgentCard> = new Map();

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  /**
   * Load agents from database into cache on startup
   */
  async initialize(): Promise<void> {
    const agents = await agentRepository.findAll();
    for (const agent of agents) {
      this.agentCache.set(agent.name, agent);
    }
    console.log(`[ConversationManager] Loaded ${agents.length} agents from database`);
  }

  // ============================================================================
  // CONVERSATION METHODS
  // ============================================================================

  /**
   * Create a new conversation
   */
  async createConversation(robotId?: string, name?: string): Promise<A2AConversation> {
    const count = await conversationRepository.count();
    const conversationName = name || `Conversation ${count + 1}`;

    const conversation = await conversationRepository.create({
      robotId,
      name: conversationName,
    });

    // Cache for active use
    this.activeConversations.set(conversation.conversationId, conversation);

    return conversation;
  }

  /**
   * Get a conversation by ID
   */
  async getConversation(conversationId: string): Promise<A2AConversation | undefined> {
    // Check cache first
    if (this.activeConversations.has(conversationId)) {
      return this.activeConversations.get(conversationId);
    }

    // Load from database
    const conversation = await conversationRepository.findById(conversationId);
    if (conversation) {
      this.activeConversations.set(conversationId, conversation);
    }
    return conversation ?? undefined;
  }

  /**
   * List all conversations
   */
  async listConversations(): Promise<A2AConversation[]> {
    return conversationRepository.findAll();
  }

  /**
   * Delete a conversation
   */
  async deleteConversation(conversationId: string): Promise<boolean> {
    this.activeConversations.delete(conversationId);
    return conversationRepository.delete(conversationId);
  }

  // ============================================================================
  // MESSAGE METHODS
  // ============================================================================

  /**
   * Add a message to a conversation and process it
   */
  async processMessage(
    conversationId: string,
    text: string,
    targetAgentUrl?: string
  ): Promise<{ messageId: string; task?: A2ATask }> {
    const conversation = await this.getConversation(conversationId);
    if (!conversation) {
      throw new Error(`Conversation ${conversationId} not found`);
    }

    // Create user message
    const userMessage: A2AMessage = {
      messageId: uuidv4(),
      role: 'user',
      parts: [{ kind: 'text', text }],
      contextId: conversationId,
      timestamp: new Date().toISOString(),
    };

    // Save to database
    await conversationRepository.addMessage(conversationId, userMessage);

    // Update cached conversation
    conversation.messages.push(userMessage);
    conversation.updatedAt = new Date().toISOString();

    // Mark as pending
    this.pendingMessages.set(userMessage.messageId, 'pending');

    // Create a task for this message
    const task = await this.createTask(conversationId);
    conversation.taskIds.push(task.id);

    // Add event
    await this.addEvent({
      id: uuidv4(),
      actor: 'user',
      content: userMessage,
      timestamp: Date.now(),
    });

    // If target agent specified, send to it via JSON-RPC
    if (targetAgentUrl) {
      this.sendToRemoteAgent(conversationId, task.id, userMessage, targetAgentUrl);
    } else {
      // Simulate local processing
      this.simulateAgentResponse(conversationId, task.id, text);
    }

    this.pendingMessages.set(userMessage.messageId, 'sent');

    return { messageId: userMessage.messageId, task };
  }

  /**
   * Send message to a remote A2A agent via JSON-RPC
   */
  private async sendToRemoteAgent(
    conversationId: string,
    taskId: string,
    userMessage: A2AMessage,
    agentUrl: string
  ): Promise<void> {
    const conversation = await this.getConversation(conversationId);
    const task = await this.getTask(taskId);
    if (!conversation || !task) return;

    // Update task to working
    await this.updateTaskStatus(taskId, { state: 'working', timestamp: new Date().toISOString() });

    try {
      // Prepare JSON-RPC request
      const request: JSONRPCRequest = {
        jsonrpc: '2.0',
        id: uuidv4(),
        method: 'message/send',
        params: {
          message: userMessage,
        },
      };

      console.log(`Sending A2A message to ${agentUrl}:`, JSON.stringify(request, null, 2));

      // Send to remote agent
      const response = await axios.post<JSONRPCResponse>(agentUrl, request, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 60000, // 60 second timeout for AI processing
      });

      console.log(`A2A response from ${agentUrl}:`, JSON.stringify(response.data, null, 2));

      if (response.data.error) {
        throw new Error(`Agent error: ${response.data.error.message}`);
      }

      // Extract the response - could be a task or message
      const result = response.data.result;

      // Create agent response message from the result
      let responseText = 'Agent processed your request.';
      let agentMessage: A2AMessage;

      if (result && typeof result === 'object') {
        // Cast to access properties safely
        const resultObj = result as Record<string, unknown>;
        const statusObj = resultObj.status as Record<string, unknown> | undefined;
        const statusMessage = statusObj?.message as A2AMessage | undefined;

        // Check if it's a task with status message
        if (statusMessage?.parts) {
          const parts = statusMessage.parts;
          const textPart = parts.find((p: A2APart) => p.kind === 'text');
          if (textPart && 'text' in textPart) {
            responseText = textPart.text;
          }
          agentMessage = statusMessage;
          agentMessage.contextId = conversationId;
          agentMessage.taskId = taskId;
        } else if ('parts' in resultObj) {
          // It's a direct message
          agentMessage = result as A2AMessage;
          agentMessage.contextId = conversationId;
          agentMessage.taskId = taskId;
        } else {
          // Unknown format, create a message from it
          agentMessage = {
            messageId: uuidv4(),
            role: 'agent',
            parts: [{ kind: 'text', text: JSON.stringify(result) }],
            contextId: conversationId,
            taskId,
            timestamp: new Date().toISOString(),
          };
        }
      } else {
        agentMessage = {
          messageId: uuidv4(),
          role: 'agent',
          parts: [{ kind: 'text', text: responseText }],
          contextId: conversationId,
          taskId,
          timestamp: new Date().toISOString(),
        };
      }

      // Save to database
      await conversationRepository.addMessage(conversationId, agentMessage);

      // Update cached conversation
      conversation.messages.push(agentMessage);
      conversation.updatedAt = new Date().toISOString();

      // Add event
      await this.addEvent({
        id: uuidv4(),
        actor: 'agent',
        content: agentMessage,
        timestamp: Date.now(),
      });

      // Update task to completed
      await this.updateTaskStatus(taskId, {
        state: 'completed',
        message: agentMessage,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error(`Error sending to remote agent ${agentUrl}:`, error);

      // Create error message
      const errorText = error instanceof Error ? error.message : 'Unknown error';
      const errorMessage: A2AMessage = {
        messageId: uuidv4(),
        role: 'agent',
        parts: [{ kind: 'text', text: `Error communicating with agent: ${errorText}` }],
        contextId: conversationId,
        taskId,
        timestamp: new Date().toISOString(),
      };

      // Save to database
      await conversationRepository.addMessage(conversationId, errorMessage);

      conversation.messages.push(errorMessage);
      conversation.updatedAt = new Date().toISOString();

      // Update task to failed
      await this.updateTaskStatus(taskId, {
        state: 'failed',
        message: errorMessage,
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Simulate an agent response (for development)
   */
  private async simulateAgentResponse(
    conversationId: string,
    taskId: string,
    userText: string
  ): Promise<void> {
    const conversation = await this.getConversation(conversationId);
    const task = await this.getTask(taskId);
    if (!conversation || !task) return;

    // Update task to working
    await this.updateTaskStatus(taskId, { state: 'working', timestamp: new Date().toISOString() });

    // Simulate processing delay
    await this.delay(500);

    // Create agent response
    const agentMessage: A2AMessage = {
      messageId: uuidv4(),
      role: 'agent',
      parts: [
        {
          kind: 'text',
          text: `I received your message: "${userText}". This is a simulated response from the A2A agent.`,
        },
      ],
      contextId: conversationId,
      taskId,
      timestamp: new Date().toISOString(),
    };

    // Save to database
    await conversationRepository.addMessage(conversationId, agentMessage);

    // Update cached conversation
    conversation.messages.push(agentMessage);
    conversation.updatedAt = new Date().toISOString();

    // Add event
    await this.addEvent({
      id: uuidv4(),
      actor: 'agent',
      content: agentMessage,
      timestamp: Date.now(),
    });

    // Update task to completed
    await this.updateTaskStatus(taskId, {
      state: 'completed',
      message: agentMessage,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Get messages for a conversation
   */
  async getMessages(conversationId: string): Promise<A2AMessage[]> {
    // Check cache first
    const cached = this.activeConversations.get(conversationId);
    if (cached) {
      return cached.messages;
    }

    return conversationRepository.getMessages(conversationId);
  }

  /**
   * Get pending message statuses
   */
  getPendingMessages(): Array<[string, string]> {
    return Array.from(this.pendingMessages.entries());
  }

  // ============================================================================
  // TASK METHODS
  // ============================================================================

  /**
   * Create a new task
   */
  async createTask(contextId?: string): Promise<A2ATask> {
    const task = await taskRepository.create(contextId);

    // Cache for active use
    this.activeTasks.set(task.id, task);

    // Notify callbacks
    this.notifyTaskEvent({
      type: 'status_update',
      taskId: task.id,
      contextId,
      status: task.status,
    });

    return task;
  }

  /**
   * Update task status
   */
  async updateTaskStatus(taskId: string, status: A2ATaskStatus): Promise<void> {
    const task = await taskRepository.updateStatus(taskId, status);
    if (!task) return;

    // Update cache
    this.activeTasks.set(taskId, task);

    // Notify callbacks
    this.notifyTaskEvent({
      type: 'status_update',
      taskId: task.id,
      contextId: task.contextId,
      status: task.status,
    });
  }

  /**
   * Get a task by ID
   */
  async getTask(taskId: string): Promise<A2ATask | undefined> {
    // Check cache first
    if (this.activeTasks.has(taskId)) {
      return this.activeTasks.get(taskId);
    }

    const task = await taskRepository.findById(taskId);
    if (task) {
      this.activeTasks.set(taskId, task);
    }
    return task ?? undefined;
  }

  /**
   * List all tasks
   */
  async listTasks(): Promise<A2ATask[]> {
    return taskRepository.findAll();
  }

  /**
   * Subscribe to task events
   */
  onTaskEvent(callback: TaskEventCallback): () => void {
    this.taskCallbacks.add(callback);
    return () => this.taskCallbacks.delete(callback);
  }

  /**
   * Notify all task event subscribers
   */
  private notifyTaskEvent(event: A2ATaskEvent): void {
    this.taskCallbacks.forEach((cb) => cb(event));
  }

  // ============================================================================
  // AGENT METHODS
  // ============================================================================

  /**
   * Register an external agent
   */
  async registerAgent(card: A2AAgentCard): Promise<void> {
    await agentRepository.upsert(card);
    this.agentCache.set(card.name, card);
  }

  /**
   * Unregister an agent
   */
  async unregisterAgent(name: string): Promise<boolean> {
    this.agentCache.delete(name);
    return agentRepository.delete(name);
  }

  /**
   * Get a registered agent
   */
  getAgent(name: string): A2AAgentCard | undefined {
    return this.agentCache.get(name);
  }

  /**
   * Get a registered agent (async from database)
   */
  async getAgentAsync(name: string): Promise<A2AAgentCard | undefined> {
    // Check cache first
    if (this.agentCache.has(name)) {
      return this.agentCache.get(name);
    }

    const agent = await agentRepository.findByName(name);
    if (agent) {
      this.agentCache.set(name, agent);
    }
    return agent ?? undefined;
  }

  /**
   * List all registered agents
   */
  listAgents(): A2AAgentCard[] {
    return Array.from(this.agentCache.values());
  }

  /**
   * List all registered agents (async from database)
   */
  async listAgentsAsync(): Promise<A2AAgentCard[]> {
    return agentRepository.findAll();
  }

  // ============================================================================
  // ORCHESTRATION METHODS
  // ============================================================================

  /**
   * Select the best agent for a given message based on capabilities
   */
  selectAgentForMessage(message: string): A2AAgentCard | null {
    const agents = this.listAgents();
    if (agents.length === 0) return null;

    const lowerMessage = message.toLowerCase();

    // Parse weight requirements from message
    const weightMatch = lowerMessage.match(/(\d+)\s*kg/);
    const requiredWeight = weightMatch ? parseInt(weightMatch[1]) : 0;

    // Keywords for heavy tasks
    const heavyKeywords = ['heavy', 'large', 'big', 'industrial', 'warehouse', 'pallet', 'crate'];
    const lightKeywords = ['light', 'small', 'quick', 'nimble', 'delicate', 'precise'];

    const isHeavyTask = heavyKeywords.some((k) => lowerMessage.includes(k)) || requiredWeight > 10;
    const isLightTask = lightKeywords.some((k) => lowerMessage.includes(k));

    // Score agents based on task requirements
    let bestAgent: A2AAgentCard | null = null;
    let bestScore = -1;

    for (const agent of agents) {
      const desc = (agent.description || '').toLowerCase();
      let score = 0;

      // Extract max payload from description
      const payloadMatch = desc.match(/max payload[:\s]*(\d+)\s*kg/i);
      const maxPayload = payloadMatch ? parseInt(payloadMatch[1]) : 10;

      // Check if agent can handle the weight
      if (requiredWeight > 0 && maxPayload < requiredWeight) {
        continue; // Skip agents that can't handle the weight
      }

      // Score based on task type matching
      if (isHeavyTask) {
        if (desc.includes('heavy') || desc.includes('industrial')) score += 10;
        if (maxPayload >= 30) score += 5;
      }
      if (isLightTask) {
        if (desc.includes('light') || desc.includes('nimble')) score += 10;
      }

      // Default score for matching agent
      score += 1;

      if (score > bestScore) {
        bestScore = score;
        bestAgent = agent;
      }
    }

    return bestAgent;
  }

  /**
   * Process an orchestrated message - select agent and route
   */
  async processOrchestratedMessage(
    conversationId: string,
    text: string
  ): Promise<{ messageId: string; task?: A2ATask }> {
    const conversation = await this.getConversation(conversationId);
    if (!conversation) {
      throw new Error(`Conversation ${conversationId} not found`);
    }

    // Select best agent for this message
    const selectedAgent = this.selectAgentForMessage(text);

    if (!selectedAgent) {
      throw new Error('No suitable agent found for this request. Please register agents first.');
    }

    console.log(`[Orchestrator] Selected agent: ${selectedAgent.name} for message: "${text}"`);

    // Create user message with orchestration metadata
    const userMessage: A2AMessage = {
      messageId: uuidv4(),
      role: 'user',
      parts: [{ kind: 'text', text }],
      contextId: conversationId,
      timestamp: new Date().toISOString(),
      metadata: { orchestrated: true },
    };

    // Save to database
    await conversationRepository.addMessage(conversationId, userMessage);

    // Update cached conversation
    conversation.messages.push(userMessage);
    conversation.updatedAt = new Date().toISOString();

    // Mark as pending
    this.pendingMessages.set(userMessage.messageId, 'pending');

    // Create task
    const task = await this.createTask(conversationId);
    conversation.taskIds.push(task.id);

    // Add event
    await this.addEvent({
      id: uuidv4(),
      actor: 'user',
      content: userMessage,
      timestamp: Date.now(),
    });

    // Send to selected agent with metadata
    await this.sendToRemoteAgentOrchestrated(conversationId, task.id, userMessage, selectedAgent);

    this.pendingMessages.set(userMessage.messageId, 'sent');

    return { messageId: userMessage.messageId, task };
  }

  /**
   * Send to remote agent with orchestration metadata
   */
  private async sendToRemoteAgentOrchestrated(
    conversationId: string,
    taskId: string,
    userMessage: A2AMessage,
    agent: A2AAgentCard
  ): Promise<void> {
    const conversation = await this.getConversation(conversationId);
    const task = await this.getTask(taskId);
    if (!conversation || !task) return;

    // Update task to working
    await this.updateTaskStatus(taskId, { state: 'working', timestamp: new Date().toISOString() });

    try {
      // Prepare JSON-RPC request
      const request: JSONRPCRequest = {
        jsonrpc: '2.0',
        id: uuidv4(),
        method: 'message/send',
        params: { message: userMessage },
      };

      console.log(`[Orchestrator] Sending to ${agent.name} at ${agent.url}`);

      // Send to agent
      const response = await axios.post<JSONRPCResponse>(agent.url, request, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 60000,
      });

      if (response.data.error) {
        throw new Error(`Agent error: ${response.data.error.message}`);
      }

      // Process response
      const result = response.data.result;
      let agentMessage: A2AMessage;

      if (result && typeof result === 'object') {
        // Cast to access properties safely
        const resultObj = result as Record<string, unknown>;
        const statusObj = resultObj.status as Record<string, unknown> | undefined;
        const statusMessage = statusObj?.message as A2AMessage | undefined;

        if (statusMessage?.parts) {
          agentMessage = statusMessage;
          agentMessage.contextId = conversationId;
          agentMessage.taskId = taskId;
        } else if ('parts' in resultObj) {
          agentMessage = result as A2AMessage;
          agentMessage.contextId = conversationId;
          agentMessage.taskId = taskId;
        } else {
          agentMessage = {
            messageId: uuidv4(),
            role: 'agent',
            parts: [{ kind: 'text', text: JSON.stringify(result) }],
            contextId: conversationId,
            taskId,
            timestamp: new Date().toISOString(),
          };
        }
      } else {
        agentMessage = {
          messageId: uuidv4(),
          role: 'agent',
          parts: [{ kind: 'text', text: 'Agent processed your request.' }],
          contextId: conversationId,
          taskId,
          timestamp: new Date().toISOString(),
        };
      }

      // Add orchestration metadata to response
      agentMessage.metadata = {
        ...agentMessage.metadata,
        agentName: agent.name,
        orchestrated: true,
      };

      // Save to database
      await conversationRepository.addMessage(conversationId, agentMessage);

      // Update cached conversation
      conversation.messages.push(agentMessage);
      conversation.updatedAt = new Date().toISOString();

      // Add event
      await this.addEvent({
        id: uuidv4(),
        actor: 'agent',
        content: agentMessage,
        timestamp: Date.now(),
      });

      // Update task to completed
      await this.updateTaskStatus(taskId, {
        state: 'completed',
        message: agentMessage,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error(`[Orchestrator] Error sending to ${agent.name}:`, error);

      const errorText = error instanceof Error ? error.message : 'Unknown error';
      const errorMessage: A2AMessage = {
        messageId: uuidv4(),
        role: 'agent',
        parts: [{ kind: 'text', text: `Error: ${errorText}` }],
        contextId: conversationId,
        taskId,
        timestamp: new Date().toISOString(),
        metadata: { agentName: agent.name, orchestrated: true, error: true },
      };

      // Save to database
      await conversationRepository.addMessage(conversationId, errorMessage);

      conversation.messages.push(errorMessage);
      conversation.updatedAt = new Date().toISOString();

      await this.updateTaskStatus(taskId, {
        state: 'failed',
        message: errorMessage,
        timestamp: new Date().toISOString(),
      });
    }
  }

  // ============================================================================
  // EVENT METHODS
  // ============================================================================

  /**
   * Add an event
   */
  async addEvent(event: A2AEvent): Promise<void> {
    await eventRepository.create(event);
  }

  /**
   * Get all events
   */
  async getEvents(): Promise<A2AEvent[]> {
    return eventRepository.findAll();
  }

  /**
   * Get events since timestamp
   */
  async getEventsSince(timestamp: number): Promise<A2AEvent[]> {
    return eventRepository.findSince(timestamp);
  }

  // ============================================================================
  // UTILITY METHODS
  // ============================================================================

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Singleton instance
export const conversationManager = new ConversationManager();
