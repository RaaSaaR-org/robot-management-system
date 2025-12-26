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
  // Message-to-task mapping for tracking which message belongs to which task
  private messageToTaskMap: Map<string, string> = new Map();

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
  // TASK CONTINUATION HELPERS
  // ============================================================================

  /**
   * Check if a task is still open (can receive more messages)
   */
  private isTaskOpen(task: A2ATask): boolean {
    return ['submitted', 'working', 'input_required'].includes(task.status.state);
  }

  /**
   * Find an open task for a conversation that can be continued
   */
  private getOpenTaskForConversation(conversationId: string): A2ATask | undefined {
    const conversation = this.activeConversations.get(conversationId);
    if (!conversation?.messages.length) return undefined;

    // Find last message with a task
    for (let i = conversation.messages.length - 1; i >= 0; i--) {
      const msg = conversation.messages[i];
      if (msg.taskId) {
        const task = this.activeTasks.get(msg.taskId);
        if (task && this.isTaskOpen(task)) {
          return task;
        }
        // If task exists but is closed, stop looking (most recent task is done)
        break;
      }
    }
    return undefined;
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

    // Check for open task to continue (A2A protocol: link follow-up messages to open tasks)
    const openTask = this.getOpenTaskForConversation(conversationId);

    // Create user message with task linkage
    const userMessage: A2AMessage = {
      messageId: uuidv4(),
      role: 'user',
      parts: [{ kind: 'text', text }],
      contextId: conversationId,
      taskId: openTask?.id, // Link to open task if exists
      timestamp: new Date().toISOString(),
    };

    // Save to database
    await conversationRepository.addMessage(conversationId, userMessage);

    // Update cached conversation
    conversation.messages.push(userMessage);
    conversation.updatedAt = new Date().toISOString();

    // Mark as pending
    this.pendingMessages.set(userMessage.messageId, 'pending');

    // Use existing open task or create a new one
    const task = openTask || (await this.createTask(conversationId));
    userMessage.taskId = task.id;

    // Track message-to-task mapping
    this.messageToTaskMap.set(userMessage.messageId, task.id);

    // Add message to task history
    if (!task.history) task.history = [];
    task.history.push(userMessage);

    // Only add taskId to conversation if it's a new task
    if (!openTask) {
      conversation.taskIds.push(task.id);
    }

    // Add event
    await this.addEvent({
      id: uuidv4(),
      actor: 'user',
      content: userMessage,
      timestamp: Date.now(),
    });

    // If target agent specified, send to it via JSON-RPC
    if (targetAgentUrl) {
      this.sendToRemoteAgent(conversationId, task.id, userMessage, targetAgentUrl).catch((err) => {
        console.error('[ConversationManager] Remote agent error:', err);
      });
    } else {
      // Simulate local processing
      this.simulateAgentResponse(conversationId, task.id, text).catch((err) => {
        console.error('[ConversationManager] Simulation error:', err);
      });
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
      // Prepare message for remote agent - don't include server's taskId
      // The remote agent will create its own task
      const messageForAgent: A2AMessage = {
        ...userMessage,
        taskId: undefined, // Remove server's taskId - agent creates its own
      };

      // Prepare JSON-RPC request
      const request: JSONRPCRequest = {
        jsonrpc: '2.0',
        id: uuidv4(),
        method: 'message/send',
        params: {
          message: messageForAgent,
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
   * Get pending message statuses with meaningful progress text (A2A protocol)
   */
  getPendingMessages(): Array<[string, string]> {
    const result: Array<[string, string]> = [];

    for (const [messageId, _status] of this.pendingMessages) {
      const taskId = this.messageToTaskMap.get(messageId);

      if (taskId) {
        const task = this.activeTasks.get(taskId);

        if (task?.history?.length) {
          // Get status from last message in task history (from agent updates)
          const lastMsg = task.history[task.history.length - 1];
          // Only use agent messages for status text
          if (lastMsg.role === 'agent') {
            const textPart = lastMsg.parts.find((p) => p.kind === 'text');
            if (textPart && 'text' in textPart) {
              // Truncate long messages for status display
              const statusText =
                textPart.text.length > 100
                  ? textPart.text.slice(0, 100) + '...'
                  : textPart.text;
              result.push([messageId, statusText]);
              continue;
            }
          }
        }

        // Default based on task state
        const stateText =
          task?.status.state === 'working'
            ? 'Working...'
            : task?.status.state === 'input_required'
              ? 'Waiting for input...'
              : 'Processing...';
        result.push([messageId, stateText]);
      } else {
        result.push([messageId, 'Processing...']);
      }
    }

    return result;
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

    // Add status message to task history if present (A2A protocol)
    if (status.message) {
      if (!task.history) task.history = [];
      // Avoid duplicates - check if message already in history
      const alreadyInHistory = task.history.some(
        (m) => m.messageId === status.message?.messageId
      );
      if (!alreadyInHistory) {
        task.history.push(status.message);
      }
    }

    // Update cache
    this.activeTasks.set(taskId, task);

    // Clean up when task reaches terminal state
    if (['completed', 'failed', 'canceled'].includes(status.state)) {
      // Find and remove all pending messages and message-to-task mappings for this task
      const messagesToClean: string[] = [];
      for (const [messageId, linkedTaskId] of this.messageToTaskMap) {
        if (linkedTaskId === taskId) {
          this.pendingMessages.delete(messageId);
          messagesToClean.push(messageId);
        }
      }
      // Remove the message-to-task mappings (done separately to avoid iterator issues)
      for (const messageId of messagesToClean) {
        this.messageToTaskMap.delete(messageId);
      }
      // Remove task from active cache after a short delay to allow final queries
      setTimeout(() => {
        this.activeTasks.delete(taskId);
      }, 60000); // Keep in cache for 1 minute after completion
    }

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
   * Notify all task event subscribers with error isolation
   */
  private notifyTaskEvent(event: A2ATaskEvent): void {
    this.taskCallbacks.forEach((cb) => {
      try {
        cb(event);
      } catch (error) {
        console.error('[ConversationManager] Task event callback error:', error);
      }
    });
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
   * Detect if a message is a system-level question that should be answered
   * by the orchestrator rather than routed to a robot agent.
   */
  private isSystemQuestion(message: string): boolean {
    const lowerMessage = message.toLowerCase();

    const systemPatterns = [
      /what robots?/,
      /which robots?/,
      /list.*robots?/,
      /show.*robots?/,
      /how many robots?/,
      /fleet status/,
      /robots?.*(online|available|connected)/,
      /available robots?/,
      /connected robots?/,
    ];

    return systemPatterns.some((pattern) => pattern.test(lowerMessage));
  }

  /**
   * Handle system-level questions directly without routing to a robot.
   */
  private async handleSystemQuestion(
    conversationId: string,
    text: string,
    userMessage: A2AMessage
  ): Promise<{ messageId: string; task?: A2ATask }> {
    const conversation = await this.getConversation(conversationId);
    if (!conversation) {
      throw new Error(`Conversation ${conversationId} not found`);
    }

    const { robotManager } = await import('./RobotManager.js');
    const robots = await robotManager.listRobots();
    const connectedCount = robotManager.getConnectedAgents().length;

    // Generate response based on question
    let responseText: string;
    const lowerText = text.toLowerCase();

    if (lowerText.includes('how many')) {
      responseText = `There are ${robots.length} robot(s) registered, ${connectedCount} currently online.`;
    } else {
      // List robots
      if (robots.length === 0) {
        responseText = 'No robots are currently registered in the system.';
      } else {
        const robotList = robots
          .map((r) => `- **${r.name}** (${r.model}): ${r.status} - Battery: ${r.batteryLevel}%`)
          .join('\n');
        responseText = `**Fleet Status** (${connectedCount}/${robots.length} online):\n\n${robotList}`;
      }
    }

    // Create agent response message from orchestrator
    const agentMessage: A2AMessage = {
      messageId: uuidv4(),
      role: 'agent',
      parts: [{ kind: 'text', text: responseText }],
      contextId: conversationId,
      timestamp: new Date().toISOString(),
      metadata: { orchestrator: true },
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

    return { messageId: agentMessage.messageId };
  }

  /**
   * Select the best agent for a given message based on capabilities
   * Only considers connected robots (not stale registrations)
   */
  selectAgentForMessage(message: string, connectedAgents?: A2AAgentCard[]): A2AAgentCard | null {
    // Use provided connected agents, or fall back to registered agents
    const agents = connectedAgents && connectedAgents.length > 0
      ? connectedAgents
      : this.listAgents();

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

    // First, save the user message
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

    // Add event
    await this.addEvent({
      id: uuidv4(),
      actor: 'user',
      content: userMessage,
      timestamp: Date.now(),
    });

    // Check if this is a system question (handled by orchestrator, not robot)
    if (this.isSystemQuestion(text)) {
      console.log(`[Orchestrator] Handling system question: "${text}"`);
      return this.handleSystemQuestion(conversationId, text, userMessage);
    }

    // Get connected agents from RobotManager (dynamic import to avoid circular dependency)
    const { robotManager } = await import('./RobotManager.js');
    const connectedAgents = robotManager.getConnectedAgents();

    // Select best agent for this message (only from connected robots)
    const selectedAgent = this.selectAgentForMessage(text, connectedAgents);

    if (!selectedAgent) {
      throw new Error('No connected robots available. Please ensure a robot agent is running.');
    }

    console.log(`[Orchestrator] Selected agent: ${selectedAgent.name} for message: "${text}"`);

    // Check for open task to continue (A2A protocol)
    const openTask = this.getOpenTaskForConversation(conversationId);

    // Mark as pending
    this.pendingMessages.set(userMessage.messageId, 'pending');

    // Use existing open task or create a new one
    const task = openTask || (await this.createTask(conversationId));
    userMessage.taskId = task.id;

    // Track message-to-task mapping
    this.messageToTaskMap.set(userMessage.messageId, task.id);

    // Add message to task history
    if (!task.history) task.history = [];
    task.history.push(userMessage);

    // Only add taskId to conversation if it's a new task
    if (!openTask) {
      conversation.taskIds.push(task.id);
    }

    // Send to selected agent with metadata (fire-and-forget with error handling)
    this.sendToRemoteAgentOrchestrated(conversationId, task.id, userMessage, selectedAgent).catch(
      (err) => {
        console.error('[ConversationManager] Orchestrated agent error:', err);
      }
    );

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
      // Prepare message for remote agent - don't include server's taskId
      // The remote agent will create its own task
      const messageForAgent: A2AMessage = {
        ...userMessage,
        taskId: undefined, // Remove server's taskId - agent creates its own
      };

      // Prepare JSON-RPC request
      const request: JSONRPCRequest = {
        jsonrpc: '2.0',
        id: uuidv4(),
        method: 'message/send',
        params: { message: messageForAgent },
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
