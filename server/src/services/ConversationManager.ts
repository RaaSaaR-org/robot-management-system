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
  // AGENT-RESULT FAILURE DETECTION
  // ============================================================================

  /**
   * Extract the plain text from an A2A message's parts.
   */
  private extractMessageText(message: A2AMessage): string {
    const textPart = message.parts?.find((p: A2APart) => p.kind === 'text');
    return textPart && 'text' in textPart ? textPart.text : '';
  }

  /**
   * Decide whether an agent's result is a failure, and if so return a clean,
   * human-readable error message. Returns null for successful results.
   *
   * Failures are recognized two ways:
   *  - the remote task's status.state is a terminal failure state, or
   *  - the result text is a recognizable raw error payload (e.g. a
   *    GoogleGenerativeAI error JSON dumped verbatim into the response).
   */
  private detectAgentFailure(remoteState: string | undefined, text: string): string | null {
    const isFailedState = remoteState === 'failed' || remoteState === 'rejected';

    if (isFailedState) {
      const message = this.cleanErrorText(text) ?? (text.trim() || 'Agent reported task failure.');
      // The agent-executor already emits "Task failed: <msg>" and both callers
      // re-add that prefix — strip a leading one so it isn't doubled.
      return message.replace(/^Task failed:\s*/i, '').trim() || 'Agent reported task failure.';
    }

    // The remote reported a NON-failure terminal state (e.g. 'completed') — trust
    // it, even if the result text happens to mention an error. Only sniff the
    // text for a raw error payload when the remote gave us no state at all
    // (legacy agents that dumped an error JSON into an otherwise-200 result).
    if (remoteState === undefined) {
      return this.cleanErrorText(text);
    }
    return null;
  }

  /**
   * If `text` looks like a raw error payload, return a concise human-readable
   * message extracted from it; otherwise return null.
   */
  private cleanErrorText(text: string): string | null {
    const t = text.trim();
    const errorMarkers = [
      /^\{\s*"error"/, // raw {"error": {...}} JSON dumps
      /^\s*\[?\s*GoogleGenerativeAI(?:Fetch)?Error/i, // anchored: the thrown error class at payload start, not a passing mention
      /^\s*\[GoogleGenerativeAI Error\]/i,
      /^Error(?: communicating with agent)?:/i,
    ];
    if (!errorMarkers.some((m) => m.test(t))) return null;

    // Try to pull the message out of a JSON error payload
    try {
      const parsed = JSON.parse(t) as { error?: { message?: string }; message?: string };
      const msg = parsed.error?.message ?? parsed.message;
      if (typeof msg === 'string' && msg.trim()) return msg.trim();
    } catch {
      // not JSON — fall through to string cleanup
    }

    // "[GoogleGenerativeAI Error]: <message>" style strings — keep the message
    const bracketMatch = t.match(/\[GoogleGenerativeAI Error\]:?\s*(.+)/is);
    const candidate = bracketMatch ? bracketMatch[1].trim() : t;

    return candidate.length > 300 ? `${candidate.slice(0, 300)}…` : candidate;
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
      let remoteState: string | undefined;

      if (result && typeof result === 'object') {
        // Cast to access properties safely
        const resultObj = result as Record<string, unknown>;
        const statusObj = resultObj.status as Record<string, unknown> | undefined;
        const statusMessage = statusObj?.message as A2AMessage | undefined;
        remoteState = typeof statusObj?.state === 'string' ? statusObj.state : undefined;

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

      // Detect failed results (agent reported failed state, or a raw error
      // payload came back as the result text) and persist them as 'failed'
      // with a clean message instead of 'completed' with raw error JSON.
      const failureMessage = this.detectAgentFailure(
        remoteState,
        this.extractMessageText(agentMessage)
      );
      if (failureMessage) {
        agentMessage.parts = [{ kind: 'text', text: `Task failed: ${failureMessage}` }];
        agentMessage.metadata = { ...agentMessage.metadata, error: true };
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

      // Update task to its true terminal state
      await this.updateTaskStatus(taskId, {
        state: failureMessage ? 'failed' : 'completed',
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
   * Select the best agent for a given message based on capabilities.
   * Uses LLM (OpenRouter) if OPENROUTER_API_KEY is set, otherwise falls back to keyword matching.
   * Only considers connected robots (not stale registrations).
   */
  async selectAgentForMessage(message: string, connectedAgents?: A2AAgentCard[]): Promise<A2AAgentCard | null> {
    // Use provided connected agents, or fall back to registered agents
    const agents = connectedAgents && connectedAgents.length > 0
      ? connectedAgents
      : this.listAgents();

    if (agents.length === 0) return null;
    if (agents.length === 1) return agents[0];

    // Step 1: Check if user explicitly names a robot (direct match before LLM)
    const namedAgent = this.matchAgentByName(message, agents);
    if (namedAgent) {
      console.log(`[Orchestrator] Direct name match: "${namedAgent.name}"`);
      return namedAgent;
    }

    // Step 2: Try LLM-based selection (if OpenRouter key is configured)
    const openrouterKey = process.env.OPENROUTER_API_KEY;
    if (openrouterKey) {
      try {
        const llmResult = await this.selectAgentWithLLM(message, agents, openrouterKey);
        if (llmResult) return llmResult;
      } catch (err) {
        console.warn('[Orchestrator] LLM agent selection failed, using keyword fallback:', err);
      }
    }

    // Step 3: Fallback — keyword-based matching
    return this.selectAgentByKeywords(message, agents);
  }

  /**
   * Match an agent by explicit name reference in the user's message.
   * Checks robot names, short names, and common abbreviations.
   */
  private matchAgentByName(message: string, agents: A2AAgentCard[]): A2AAgentCard | null {
    const lower = message.toLowerCase();

    for (const agent of agents) {
      // Extract meaningful name parts from agent name like "Simulated Robot: Atlas-G1"
      const fullName = agent.name.toLowerCase();
      const nameParts = fullName
        .replace(/simulated robot:\s*/i, '')
        .split(/[\s\-_:]+/)
        .filter((p) => p.length > 2); // ignore tiny fragments

      // Check if any name part appears in the message
      for (const part of nameParts) {
        if (lower.includes(part)) {
          return agent;
        }
      }
    }

    return null;
  }

  /**
   * LLM-powered agent selection via OpenRouter
   */
  private async selectAgentWithLLM(
    message: string,
    agents: A2AAgentCard[],
    apiKey: string
  ): Promise<A2AAgentCard | null> {
    const model = process.env.ORCHESTRATOR_MODEL || 'stepfun/step-3.5-flash:free';

    const agentDescriptions = agents
      .map((a, i) => `${i + 1}. ${a.name}: ${a.description}`)
      .join('\n');

    const systemPrompt = `You are an intelligent task router for a robot fleet management system. Given the user's request and available robot agents, select the BEST agent to handle the task.

Available Agents:
${agentDescriptions}

Instructions:
- If the user mentions a specific robot by name (even partial name, nickname, or abbreviation), ALWAYS select that robot. Examples: "atlas" matches "Atlas-G1", "simbot" matches "SimBot-01".
- If no specific robot is mentioned, select the best agent based on capabilities.
- For heavy-duty tasks or heavy payloads, prefer agents described as heavy-duty or with higher payload capacity.
- For delicate or precise tasks, prefer nimble or lightweight agents.
- The selected agent will receive the command and execute it on itself — you are just routing.

Respond with ONLY the exact agent name as shown above (nothing else).`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      console.log(`[Orchestrator] LLM selecting agent for: "${message}"`);

      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: message },
          ],
          max_tokens: 50,
          temperature: 0.1,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`OpenRouter ${response.status}: ${await response.text()}`);
      }

      const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      const selectedName = (data.choices?.[0]?.message?.content ?? '').trim();

      console.log(`[Orchestrator] LLM selected: "${selectedName}"`);

      // Exact match
      const exact = agents.find((a) => a.name.toLowerCase() === selectedName.toLowerCase());
      if (exact) return exact;

      // Partial match
      const partial = agents.find(
        (a) => a.name.toLowerCase().includes(selectedName.toLowerCase()) ||
               selectedName.toLowerCase().includes(a.name.toLowerCase())
      );
      if (partial) return partial;

      console.warn(`[Orchestrator] LLM selected unknown agent "${selectedName}", falling back`);
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Keyword-based agent selection (fallback when no LLM is available)
   */
  private selectAgentByKeywords(message: string, agents: A2AAgentCard[]): A2AAgentCard | null {
    const lowerMessage = message.toLowerCase();

    const weightMatch = lowerMessage.match(/(\d+)\s*kg/);
    const requiredWeight = weightMatch ? parseInt(weightMatch[1]) : 0;

    const heavyKeywords = ['heavy', 'large', 'big', 'industrial', 'warehouse', 'pallet', 'crate'];
    const lightKeywords = ['light', 'small', 'quick', 'nimble', 'delicate', 'precise'];

    const isHeavyTask = heavyKeywords.some((k) => lowerMessage.includes(k)) || requiredWeight > 10;
    const isLightTask = lightKeywords.some((k) => lowerMessage.includes(k));

    let bestAgent: A2AAgentCard | null = null;
    let bestScore = -1;

    for (const agent of agents) {
      const desc = (agent.description || '').toLowerCase();
      let score = 0;

      const payloadMatch = desc.match(/max payload[:\s]*(\d+)\s*kg/i);
      const maxPayload = payloadMatch ? parseInt(payloadMatch[1]) : 10;

      if (requiredWeight > 0 && maxPayload < requiredWeight) continue;

      if (isHeavyTask) {
        if (desc.includes('heavy') || desc.includes('industrial')) score += 10;
        if (maxPayload >= 30) score += 5;
      }
      if (isLightTask) {
        if (desc.includes('light') || desc.includes('nimble')) score += 10;
      }

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

    // Check for open task to continue (A2A protocol)
    const openTask = this.getOpenTaskForConversation(conversationId);

    // Use existing open task or create a new one
    const task = openTask || (await this.createTask(conversationId));
    userMessage.taskId = task.id;

    // Track message-to-task mapping
    this.messageToTaskMap.set(userMessage.messageId, task.id);
    this.pendingMessages.set(userMessage.messageId, 'pending');

    // Add message to task history
    if (!task.history) task.history = [];
    task.history.push(userMessage);

    // Only add taskId to conversation if it's a new task
    if (!openTask) {
      conversation.taskIds.push(task.id);
    }

    // --- Orchestration with timing ---
    const orchStart = Date.now();
    const agentNames = connectedAgents.map((a) => a.name);

    // Step 1: Analyzing
    this.notifyTaskEvent({
      type: 'status_update',
      taskId: task.id,
      contextId: conversationId,
      status: {
        state: 'working',
        message: {
          messageId: uuidv4(),
          role: 'agent',
          parts: [{ kind: 'text', text: '' }],
          contextId: conversationId,
          metadata: {
            orchestrationStep: 'analyzing',
            agentCount: connectedAgents.length,
            agentNames,
          },
        },
        timestamp: new Date().toISOString(),
      },
    });

    // Step 2: Select agent (with timing + method tracking)
    let selectionMethod: 'llm' | 'keyword' = 'keyword';
    const selectionStart = Date.now();

    // Track which method was used — LLM if key is present, keyword otherwise
    if (process.env.OPENROUTER_API_KEY) {
      selectionMethod = 'llm';
    }

    const selectedAgent = await this.selectAgentForMessage(text, connectedAgents);
    const selectionMs = Date.now() - selectionStart;

    if (!selectedAgent) {
      throw new Error('No connected robots available. Please ensure a robot agent is running.');
    }

    console.log(`[Orchestrator] Selected agent: ${selectedAgent.name} (${selectionMethod}, ${selectionMs}ms) for: "${text}"`);

    const consideredAgents = connectedAgents.map((a) => ({
      name: a.name,
      selected: a.name === selectedAgent.name,
    }));

    this.notifyTaskEvent({
      type: 'status_update',
      taskId: task.id,
      contextId: conversationId,
      status: {
        state: 'working',
        message: {
          messageId: uuidv4(),
          role: 'agent',
          parts: [{ kind: 'text', text: '' }],
          contextId: conversationId,
          metadata: {
            orchestrationStep: 'agent_selected',
            selectedAgent: selectedAgent.name,
            consideredAgents,
            selectionMethod,
            selectionMs,
          },
        },
        timestamp: new Date().toISOString(),
      },
    });

    // Step 3: Forwarding
    const forwardStart = Date.now();

    this.notifyTaskEvent({
      type: 'status_update',
      taskId: task.id,
      contextId: conversationId,
      status: {
        state: 'working',
        message: {
          messageId: uuidv4(),
          role: 'agent',
          parts: [{ kind: 'text', text: '' }],
          contextId: conversationId,
          metadata: {
            orchestrationStep: 'forwarding',
            selectedAgent: selectedAgent.name,
          },
        },
        timestamp: new Date().toISOString(),
      },
    });

    // Build orchestration chain metadata for the response
    const orchChainForResponse = {
      selectionMethod,
      consideredAgents,
      timings: { selectionMs, orchStartTs: orchStart, forwardStartTs: forwardStart },
    };

    // Record this NL interpretation/routing decision for explainability
    // (EU AI Act Art. 13) — fire-and-forget, never fails the message flow.
    this.recordOrchestrationDecision({
      taskId: task.id,
      text,
      selectedAgent,
      consideredAgents,
      selectionMethod,
      selectionMs,
    }).catch((err) =>
      console.warn('[Orchestrator] Failed to record explainability decision:', err)
    );

    this.sendToRemoteAgentOrchestrated(
      conversationId, task.id, userMessage, selectedAgent, orchChainForResponse
    ).catch(
      (err) => {
        console.error('[ConversationManager] Orchestrated agent error:', err);
      }
    );

    this.pendingMessages.set(userMessage.messageId, 'sent');

    return { messageId: userMessage.messageId, task };
  }

  /**
   * Persist an orchestrated NL command as a decision in the explainability
   * store so the Explainability page reflects the server's actual NL work
   * (agent selection/routing), not only /api/command/interpret calls.
   */
  private async recordOrchestrationDecision(params: {
    taskId: string;
    text: string;
    selectedAgent: A2AAgentCard;
    consideredAgents: Array<{ name: string; selected: boolean }>;
    selectionMethod: 'llm' | 'keyword';
    selectionMs: number;
  }): Promise<void> {
    // Dynamic imports to avoid circular dependencies (same pattern as robotManager use above)
    const { explainabilityService } = await import('./ExplainabilityService.js');
    const { robotManager } = await import('./RobotManager.js');

    // Map the selected agent card back to a robot record
    const robots = await robotManager.listRobots();
    const robot =
      robots.find(
        (r) => r.a2aAgentUrl && params.selectedAgent.url.startsWith(r.a2aAgentUrl)
      ) ??
      robots.find((r) =>
        params.selectedAgent.name.toLowerCase().includes(r.name.toLowerCase())
      );

    await explainabilityService.storeDecision({
      decisionType: 'command_interpretation',
      entityId: params.taskId,
      robotId: robot?.id ?? params.selectedAgent.name,
      inputFactors: {
        userCommand: params.text,
        robotState: robot
          ? {
              status: robot.status,
              batteryLevel: robot.batteryLevel ?? undefined,
              location: { x: robot.location.x, y: robot.location.y, z: robot.location.z },
            }
          : {},
      },
      reasoning: [
        `Interpreted natural-language command and routed it to agent "${params.selectedAgent.name}"`,
        `Selection method: ${
          params.selectionMethod === 'llm' ? 'LLM-based routing' : 'keyword matching'
        } (${params.selectionMs}ms)`,
        `Considered ${params.consideredAgents.length} connected agent(s)`,
      ],
      modelUsed:
        params.selectionMethod === 'llm'
          ? process.env.ORCHESTRATOR_MODEL || 'openrouter-llm'
          : 'keyword-matcher',
      confidence: params.selectionMethod === 'llm' ? 0.9 : 0.7,
      alternatives: params.consideredAgents
        .filter((a) => !a.selected)
        .map((a) => ({
          action: `Route to ${a.name}`,
          reason: 'Connected agent considered by the orchestrator',
          rejectionReason: 'Lower routing score than the selected agent',
        })),
      safetyFactors: {
        classification: 'safe',
        warnings: [],
        constraints: [],
      },
    });
  }

  /**
   * Send to remote agent with orchestration metadata
   */
  private async sendToRemoteAgentOrchestrated(
    conversationId: string,
    taskId: string,
    userMessage: A2AMessage,
    agent: A2AAgentCard,
    orchChain?: {
      selectionMethod: 'llm' | 'keyword';
      consideredAgents: Array<{ name: string; selected: boolean }>;
      timings: { selectionMs: number; orchStartTs: number; forwardStartTs: number };
    }
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
      let remoteState: string | undefined;

      if (result && typeof result === 'object') {
        // Cast to access properties safely
        const resultObj = result as Record<string, unknown>;
        const statusObj = resultObj.status as Record<string, unknown> | undefined;
        const statusMessage = statusObj?.message as A2AMessage | undefined;
        remoteState = typeof statusObj?.state === 'string' ? statusObj.state : undefined;

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

      // Detect failed results (agent reported failed state, or a raw error
      // payload came back as the result text) — persist as 'failed' with a
      // clean message instead of 'completed' with raw error JSON.
      const failureMessage = this.detectAgentFailure(
        remoteState,
        this.extractMessageText(agentMessage)
      );
      if (failureMessage) {
        agentMessage.parts = [{ kind: 'text', text: `Task failed: ${failureMessage}` }];
      }

      // Add orchestration metadata + chain to response
      const now = Date.now();
      agentMessage.metadata = {
        ...agentMessage.metadata,
        agentName: agent.name,
        orchestrated: true,
        ...(failureMessage && { error: true }),
        ...(orchChain && {
          orchestrationChain: {
            selectionMethod: orchChain.selectionMethod,
            consideredAgents: orchChain.consideredAgents,
            timings: {
              selectionMs: orchChain.timings.selectionMs,
              forwardingMs: now - orchChain.timings.forwardStartTs,
              totalMs: now - orchChain.timings.orchStartTs,
            },
          },
        }),
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

      // Update task to its true terminal state
      await this.updateTaskStatus(taskId, {
        state: failureMessage ? 'failed' : 'completed',
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
