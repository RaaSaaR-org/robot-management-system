/**
 * @file a2aApi.ts
 * @description API client for A2A server communication
 * @feature a2a
 */

import { apiClient } from '@/api/client';
import type {
  A2AConversation,
  A2AMessage,
  A2ATask,
  A2AAgentCard,
  A2AEvent,
  A2ASendMessageRequest,
  A2ASendMessageResponse,
  A2ACreateConversationRequest,
} from '../types';

const A2A_BASE_URL = import.meta.env.VITE_A2A_SERVER_URL || 'http://localhost:3001';
// Only use mock data if explicitly disabled via env var
// When server is running, we want to use real API calls
const USE_MOCK = import.meta.env.VITE_A2A_USE_MOCK === 'true';

// ============================================================================
// MOCK DATA (for development without server)
// ============================================================================

const mockConversations: A2AConversation[] = [];
const mockTasks: A2ATask[] = [];
const mockAgents: A2AAgentCard[] = [
  {
    name: 'Demo Agent',
    description: 'A demo A2A agent for testing',
    url: 'http://localhost:3002',
    version: '1.0.0',
    capabilities: { streaming: true },
    skills: [
      {
        id: 'chat',
        name: 'Chat',
        description: 'General conversation',
        tags: ['chat', 'general'],
      },
    ],
  },
];

let mockMessageId = 0;
let mockConversationId = 0;
let mockTaskId = 0;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// API METHODS
// ============================================================================

/**
 * A2A API client
 */
export const a2aApi = {
  // ===========================================================================
  // CONVERSATIONS
  // ===========================================================================

  /**
   * Create a new conversation
   */
  async createConversation(
    request?: A2ACreateConversationRequest
  ): Promise<A2AConversation> {
    if (USE_MOCK) {
      await delay(200);
      const now = new Date().toISOString();
      const conversation: A2AConversation = {
        conversationId: `conv-${++mockConversationId}`,
        name: request?.name || `Conversation ${mockConversationId}`,
        isActive: true,
        taskIds: [],
        messages: [],
        robotId: request?.robotId,
        createdAt: now,
        updatedAt: now,
      };
      mockConversations.push(conversation);
      return conversation;
    }

    const response = await apiClient.post<{ conversation: A2AConversation }>(
      `${A2A_BASE_URL}/api/a2a/conversation/create`,
      request || {}
    );
    return response.data.conversation;
  },

  /**
   * List all conversations
   */
  async listConversations(): Promise<A2AConversation[]> {
    if (USE_MOCK) {
      await delay(100);
      return [...mockConversations];
    }

    const response = await apiClient.post<{ conversations: A2AConversation[] }>(
      `${A2A_BASE_URL}/api/a2a/conversation/list`
    );
    return response.data.conversations;
  },

  /**
   * Get a specific conversation
   */
  async getConversation(conversationId: string): Promise<A2AConversation | null> {
    if (USE_MOCK) {
      await delay(100);
      return mockConversations.find((c) => c.conversationId === conversationId) || null;
    }

    const response = await apiClient.get<{ conversation: A2AConversation }>(
      `${A2A_BASE_URL}/api/a2a/conversation/${conversationId}`
    );
    return response.data.conversation;
  },

  /**
   * Delete a conversation
   */
  async deleteConversation(conversationId: string): Promise<void> {
    if (USE_MOCK) {
      await delay(100);
      const index = mockConversations.findIndex((c) => c.conversationId === conversationId);
      if (index !== -1) {
        mockConversations.splice(index, 1);
      }
      return;
    }

    await apiClient.delete(`${A2A_BASE_URL}/api/a2a/conversation/${conversationId}`);
  },

  // ===========================================================================
  // MESSAGES
  // ===========================================================================

  /**
   * Send a message
   */
  async sendMessage(request: A2ASendMessageRequest): Promise<A2ASendMessageResponse> {
    if (USE_MOCK) {
      await delay(300);
      const conversation = mockConversations.find(
        (c) => c.conversationId === request.conversationId
      );

      if (!conversation) {
        throw new Error('Conversation not found');
      }

      // Create user message
      const userMessage: A2AMessage = {
        messageId: `msg-${++mockMessageId}`,
        role: 'user',
        parts: [{ kind: 'text', text: request.message }],
        contextId: request.conversationId,
        timestamp: new Date().toISOString(),
      };
      conversation.messages.push(userMessage);

      // Create mock task
      const task: A2ATask = {
        id: `task-${++mockTaskId}`,
        contextId: request.conversationId,
        status: { state: 'submitted', timestamp: new Date().toISOString() },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      mockTasks.push(task);
      conversation.taskIds.push(task.id);

      // Simulate agent response after delay
      setTimeout(() => {
        task.status = { state: 'working', timestamp: new Date().toISOString() };
        task.updatedAt = new Date().toISOString();

        setTimeout(() => {
          const agentMessage: A2AMessage = {
            messageId: `msg-${++mockMessageId}`,
            role: 'agent',
            parts: [
              {
                kind: 'text',
                text: `I received your message: "${request.message}". This is a simulated response.`,
              },
            ],
            contextId: request.conversationId,
            taskId: task.id,
            timestamp: new Date().toISOString(),
          };
          conversation.messages.push(agentMessage);

          task.status = {
            state: 'completed',
            message: agentMessage,
            timestamp: new Date().toISOString(),
          };
          task.updatedAt = new Date().toISOString();
        }, 500);
      }, 300);

      return {
        messageId: userMessage.messageId,
        contextId: request.conversationId,
      };
    }

    const response = await apiClient.post<A2ASendMessageResponse>(
      `${A2A_BASE_URL}/api/a2a/message/send`,
      request
    );
    return response.data;
  },

  /**
   * Send a message in orchestration mode (host agent routes to appropriate agents)
   */
  async sendOrchestrated(request: {
    conversationId: string;
    message: string;
  }): Promise<A2ASendMessageResponse> {
    if (USE_MOCK) {
      await delay(300);
      const conversation = mockConversations.find(
        (c) => c.conversationId === request.conversationId
      );

      if (!conversation) {
        throw new Error('Conversation not found');
      }

      // Create user message
      const userMessage: A2AMessage = {
        messageId: `msg-${++mockMessageId}`,
        role: 'user',
        parts: [{ kind: 'text', text: request.message }],
        contextId: request.conversationId,
        timestamp: new Date().toISOString(),
      };
      conversation.messages.push(userMessage);

      // Create mock task for orchestrated response
      const task: A2ATask = {
        id: `task-${++mockTaskId}`,
        contextId: request.conversationId,
        status: { state: 'submitted', timestamp: new Date().toISOString() },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      mockTasks.push(task);
      conversation.taskIds.push(task.id);

      // Simulate orchestrated response (multiple agents could respond)
      setTimeout(() => {
        task.status = { state: 'working', timestamp: new Date().toISOString() };
        task.updatedAt = new Date().toISOString();

        setTimeout(() => {
          const agentMessage: A2AMessage = {
            messageId: `msg-${++mockMessageId}`,
            role: 'agent',
            parts: [
              {
                kind: 'text',
                text: `[Orchestrated] Analyzing your request: "${request.message}". Routing to appropriate agents...`,
              },
            ],
            contextId: request.conversationId,
            taskId: task.id,
            timestamp: new Date().toISOString(),
            metadata: { agentName: 'Host Agent', orchestrated: true },
          };
          conversation.messages.push(agentMessage);

          task.status = {
            state: 'completed',
            message: agentMessage,
            timestamp: new Date().toISOString(),
          };
          task.updatedAt = new Date().toISOString();
        }, 500);
      }, 300);

      return {
        messageId: userMessage.messageId,
        contextId: request.conversationId,
      };
    }

    // In orchestration mode, don't specify a target agent - let the host agent decide
    const response = await apiClient.post<A2ASendMessageResponse>(
      `${A2A_BASE_URL}/api/a2a/message/orchestrate`,
      request
    );
    return response.data;
  },

  /**
   * List messages for a conversation
   */
  async listMessages(conversationId: string): Promise<A2AMessage[]> {
    if (USE_MOCK) {
      await delay(100);
      const conversation = mockConversations.find(
        (c) => c.conversationId === conversationId
      );
      return conversation?.messages || [];
    }

    const response = await apiClient.post<{ messages: A2AMessage[] }>(
      `${A2A_BASE_URL}/api/a2a/message/list`,
      { conversationId }
    );
    return response.data.messages;
  },

  // ===========================================================================
  // TASKS
  // ===========================================================================

  /**
   * List all tasks
   */
  async listTasks(): Promise<A2ATask[]> {
    if (USE_MOCK) {
      await delay(100);
      return [...mockTasks];
    }

    const response = await apiClient.post<{ tasks: A2ATask[] }>(
      `${A2A_BASE_URL}/api/a2a/task/list`
    );
    return response.data.tasks;
  },

  /**
   * Get a specific task
   */
  async getTask(taskId: string): Promise<A2ATask | null> {
    if (USE_MOCK) {
      await delay(100);
      return mockTasks.find((t) => t.id === taskId) || null;
    }

    const response = await apiClient.get<{ task: A2ATask }>(
      `${A2A_BASE_URL}/api/a2a/task/${taskId}`
    );
    return response.data.task;
  },

  // ===========================================================================
  // AGENTS
  // ===========================================================================

  /**
   * Register an external agent
   */
  async registerAgent(agentUrl: string): Promise<A2AAgentCard> {
    if (USE_MOCK) {
      await delay(500);
      // Simulate fetching agent card
      const card: A2AAgentCard = {
        name: `Agent from ${new URL(agentUrl).hostname}`,
        description: 'Registered external agent',
        url: agentUrl,
        version: '1.0.0',
        capabilities: { streaming: false },
        skills: [],
      };
      mockAgents.push(card);
      return card;
    }

    const response = await apiClient.post<{ agentCard: A2AAgentCard }>(
      `${A2A_BASE_URL}/api/a2a/agent/register`,
      { agentUrl }
    );
    return response.data.agentCard;
  },

  /**
   * List all registered agents
   */
  async listAgents(): Promise<A2AAgentCard[]> {
    if (USE_MOCK) {
      await delay(100);
      return [...mockAgents];
    }

    const response = await apiClient.post<{ agents: A2AAgentCard[] }>(
      `${A2A_BASE_URL}/api/a2a/agent/list`
    );
    return response.data.agents;
  },

  /**
   * Unregister an agent
   */
  async unregisterAgent(name: string): Promise<void> {
    if (USE_MOCK) {
      await delay(100);
      const index = mockAgents.findIndex((a) => a.name === name);
      if (index !== -1) {
        mockAgents.splice(index, 1);
      }
      return;
    }

    await apiClient.delete(`${A2A_BASE_URL}/api/a2a/agent/${encodeURIComponent(name)}`);
  },

  // ===========================================================================
  // EVENTS
  // ===========================================================================

  /**
   * Get events
   */
  async getEvents(): Promise<A2AEvent[]> {
    if (USE_MOCK) {
      await delay(100);
      return [];
    }

    const response = await apiClient.post<{ events: A2AEvent[] }>(
      `${A2A_BASE_URL}/api/a2a/events/get`
    );
    return response.data.events;
  },

  // ===========================================================================
  // AGENT CARD
  // ===========================================================================

  /**
   * Fetch fleet agent card
   */
  async getFleetAgentCard(): Promise<A2AAgentCard> {
    if (USE_MOCK) {
      await delay(100);
      return {
        name: 'RoboMindOS Fleet',
        description: 'Robot fleet management system',
        url: A2A_BASE_URL,
        version: '0.1.0',
        capabilities: { streaming: true },
        skills: [
          { id: 'robot-command', name: 'Robot Command', description: 'Control robots' },
          { id: 'fleet-status', name: 'Fleet Status', description: 'Get fleet status' },
        ],
      };
    }

    const response = await apiClient.get<A2AAgentCard>(
      `${A2A_BASE_URL}/.well-known/a2a/agent_card.json`
    );
    return response.data;
  },

  /**
   * Fetch robot-specific agent card
   */
  async getRobotAgentCard(robotId: string): Promise<A2AAgentCard> {
    if (USE_MOCK) {
      await delay(100);
      return {
        name: `Robot ${robotId}`,
        description: `Individual robot agent`,
        url: `${A2A_BASE_URL}/robots/${robotId}`,
        version: '0.1.0',
        capabilities: { streaming: true },
        skills: [
          { id: 'move', name: 'Movement', description: 'Move to location' },
          { id: 'pickup', name: 'Pick Up', description: 'Pick up objects' },
        ],
      };
    }

    const response = await apiClient.get<A2AAgentCard>(
      `${A2A_BASE_URL}/.well-known/a2a/robots/${robotId}/agent_card.json`
    );
    return response.data;
  },
};
