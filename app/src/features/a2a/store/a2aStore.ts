/**
 * @file a2aStore.ts
 * @description Zustand store for A2A state management
 * @feature a2a
 */

import { createStore } from '@/store/createStore';
import { a2aApi } from '../api';
import { orchestrator } from '../services';
import type {
  A2AStore,
  A2ATask,
  A2AEvent,
  A2AAgentCard,
  A2ASendMessageRequest,
  A2ASendMessageResponse,
  A2ATaskEvent,
  RobotAgentConfig,
  A2AChatMode,
} from '../types';

// ============================================================================
// INITIAL STATE
// ============================================================================

const initialState: Omit<A2AStore, keyof import('../types').A2AActions> = {
  conversations: [],
  currentConversationId: null,
  tasks: [],
  events: [],
  registeredAgents: [],
  robotAgentConfigs: {},
  pendingMessages: {},
  completedForms: {},
  formResponses: {},
  isLoading: false,
  error: null,
  wsConnected: false,
  chatMode: 'direct' as A2AChatMode,
  geminiApiKey: null,
};

// ============================================================================
// STORE
// ============================================================================

export const useA2AStore = createStore<A2AStore>(
  (set, get) => ({
    ...initialState,

    // =========================================================================
    // CONVERSATIONS
    // =========================================================================

    createConversation: async (robotId?: string, name?: string) => {
      set((state) => {
        state.isLoading = true;
        state.error = null;
      });

      try {
        const conversation = await a2aApi.createConversation({ robotId, name });
        set((state) => {
          state.conversations.unshift(conversation);
          state.currentConversationId = conversation.conversationId;
          state.isLoading = false;
        });
        return conversation;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to create conversation';
        set((state) => {
          state.error = message;
          state.isLoading = false;
        });
        throw error;
      }
    },

    fetchConversations: async () => {
      set((state) => {
        state.isLoading = true;
        state.error = null;
      });

      try {
        const conversations = await a2aApi.listConversations();
        set((state) => {
          state.conversations = conversations;
          state.isLoading = false;
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to fetch conversations';
        set((state) => {
          state.error = message;
          state.isLoading = false;
        });
      }
    },

    selectConversation: (id: string | null) => {
      set((state) => {
        state.currentConversationId = id;
      });
    },

    deleteConversation: async (id: string) => {
      try {
        await a2aApi.deleteConversation(id);
        set((state) => {
          state.conversations = state.conversations.filter(
            (c) => c.conversationId !== id
          );
          if (state.currentConversationId === id) {
            state.currentConversationId = null;
          }
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to delete conversation';
        set((state) => {
          state.error = message;
        });
        throw error;
      }
    },

    // =========================================================================
    // MESSAGES
    // =========================================================================

    sendMessage: async (request: A2ASendMessageRequest): Promise<A2ASendMessageResponse> => {
      set((state) => {
        state.error = null;
      });

      try {
        // Use LLM-powered orchestration when in orchestration mode with no target agent
        const { chatMode, registeredAgents, geminiApiKey } = get();
        const isOrchestrationMode = chatMode === 'orchestration' && !request.targetAgentUrl;

        let targetAgentUrl = request.targetAgentUrl;

        // In orchestration mode, use LLM to select the best agent
        if (isOrchestrationMode && registeredAgents.length > 0) {
          // Initialize orchestrator if API key is set but not initialized
          if (geminiApiKey && !orchestrator.isReady()) {
            orchestrator.initialize(geminiApiKey);
          }

          if (orchestrator.isReady()) {
            // Use LLM to select the best agent
            console.log('[A2AStore] Using LLM orchestrator to select agent');
            const selectedAgent = await orchestrator.selectAgent(request.message, registeredAgents);
            if (selectedAgent) {
              console.log('[A2AStore] LLM selected agent:', selectedAgent.name);
              targetAgentUrl = selectedAgent.url;
            }
          } else {
            // Fallback: use backend keyword-based orchestration
            console.log('[A2AStore] No LLM available, using backend orchestration');
          }
        }

        // Use orchestration API (backend) when no target agent selected and in orchestration mode
        // Use direct message API when we have a target agent
        const useBackendOrchestration = isOrchestrationMode && !targetAgentUrl;

        const response = useBackendOrchestration
          ? await a2aApi.sendOrchestrated({
              conversationId: request.conversationId,
              message: request.message,
            })
          : await a2aApi.sendMessage({
              ...request,
              targetAgentUrl,
            });

        set((state) => {
          state.pendingMessages[response.messageId] = 'pending';
        });

        // Refresh messages for this conversation
        const messages = await a2aApi.listMessages(request.conversationId);
        set((state) => {
          const conversation = state.conversations.find(
            (c) => c.conversationId === request.conversationId
          );
          if (conversation) {
            conversation.messages = messages;
            conversation.updatedAt = new Date().toISOString();
          }
          state.pendingMessages[response.messageId] = 'sent';
        });

        return response;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to send message';
        set((state) => {
          state.error = message;
        });
        throw error;
      }
    },

    fetchMessages: async (conversationId: string) => {
      try {
        const messages = await a2aApi.listMessages(conversationId);
        set((state) => {
          const conversation = state.conversations.find(
            (c) => c.conversationId === conversationId
          );
          if (conversation) {
            conversation.messages = messages;
          }
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to fetch messages';
        set((state) => {
          state.error = message;
        });
      }
    },

    // =========================================================================
    // TASKS
    // =========================================================================

    fetchTasks: async () => {
      try {
        const tasks = await a2aApi.listTasks();
        set((state) => {
          state.tasks = tasks;
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to fetch tasks';
        set((state) => {
          state.error = message;
        });
      }
    },

    updateTask: (task: A2ATask) => {
      set((state) => {
        const index = state.tasks.findIndex((t) => t.id === task.id);
        if (index !== -1) {
          state.tasks[index] = task;
        } else {
          state.tasks.unshift(task);
        }
      });
    },

    getTask: (taskId: string) => {
      return get().tasks.find((t) => t.id === taskId);
    },

    // =========================================================================
    // AGENTS
    // =========================================================================

    registerAgent: async (url: string): Promise<A2AAgentCard> => {
      set((state) => {
        state.isLoading = true;
        state.error = null;
      });

      try {
        const agentCard = await a2aApi.registerAgent(url);
        set((state) => {
          // Replace if exists, otherwise add
          const existingIndex = state.registeredAgents.findIndex(
            (a) => a.name === agentCard.name
          );
          if (existingIndex !== -1) {
            state.registeredAgents[existingIndex] = agentCard;
          } else {
            state.registeredAgents.push(agentCard);
          }
          state.isLoading = false;
        });
        return agentCard;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to register agent';
        set((state) => {
          state.error = message;
          state.isLoading = false;
        });
        throw error;
      }
    },

    unregisterAgent: (name: string) => {
      set((state) => {
        state.registeredAgents = state.registeredAgents.filter((a) => a.name !== name);
      });
      // Fire and forget API call
      a2aApi.unregisterAgent(name).catch(console.error);
    },

    fetchAgents: async () => {
      try {
        const agents = await a2aApi.listAgents();
        set((state) => {
          state.registeredAgents = agents;
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to fetch agents';
        set((state) => {
          state.error = message;
        });
      }
    },

    // =========================================================================
    // ROBOT AGENT CONFIG
    // =========================================================================

    enableRobotAgent: async (robotId: string) => {
      try {
        const agentCard = await a2aApi.getRobotAgentCard(robotId);
        set((state) => {
          state.robotAgentConfigs[robotId] = {
            robotId,
            agentCard,
            isEnabled: true,
            connectedAgents: [],
          };
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to enable robot agent';
        set((state) => {
          state.error = message;
        });
        throw error;
      }
    },

    disableRobotAgent: async (robotId: string) => {
      set((state) => {
        if (state.robotAgentConfigs[robotId]) {
          state.robotAgentConfigs[robotId].isEnabled = false;
        }
      });
    },

    updateRobotAgentConfig: (config: Partial<RobotAgentConfig> & { robotId: string }) => {
      set((state) => {
        const existing = state.robotAgentConfigs[config.robotId];
        if (existing) {
          state.robotAgentConfigs[config.robotId] = { ...existing, ...config };
        }
      });
    },

    fetchRobotAgentConfig: async (robotId: string) => {
      const existing = get().robotAgentConfigs[robotId];
      if (existing) {
        return existing;
      }

      try {
        const agentCard = await a2aApi.getRobotAgentCard(robotId);
        const config: RobotAgentConfig = {
          robotId,
          agentCard,
          isEnabled: false,
          connectedAgents: [],
        };
        set((state) => {
          state.robotAgentConfigs[robotId] = config;
        });
        return config;
      } catch {
        return null;
      }
    },

    // =========================================================================
    // EVENTS
    // =========================================================================

    addEvent: (event: A2AEvent) => {
      set((state) => {
        state.events.unshift(event);
        // Keep only last 100 events
        if (state.events.length > 100) {
          state.events = state.events.slice(0, 100);
        }
      });
    },

    fetchEvents: async () => {
      try {
        const events = await a2aApi.getEvents();
        set((state) => {
          state.events = events;
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to fetch events';
        set((state) => {
          state.error = message;
        });
      }
    },

    // =========================================================================
    // WEBSOCKET
    // =========================================================================

    setWsConnected: (connected: boolean) => {
      set((state) => {
        state.wsConnected = connected;
      });
    },

    handleTaskEvent: (event: A2ATaskEvent) => {
      set((state) => {
        const task = state.tasks.find((t) => t.id === event.taskId);

        if (event.type === 'status_update') {
          if (task) {
            task.status = event.status;
            task.updatedAt = new Date().toISOString();
          }
        } else if (event.type === 'artifact_update') {
          if (task) {
            task.artifacts = task.artifacts || [];
            if (event.append) {
              // Append to existing artifact
              const existingIndex = task.artifacts.findIndex(
                (a) => a.artifactId === event.artifact.artifactId
              );
              if (existingIndex !== -1) {
                task.artifacts[existingIndex] = event.artifact;
              } else {
                task.artifacts.push(event.artifact);
              }
            } else {
              task.artifacts.push(event.artifact);
            }
            task.updatedAt = new Date().toISOString();
          }
        }
      });
    },

    // =========================================================================
    // FORMS
    // =========================================================================

    submitFormResponse: async (messageId: string, taskId: string, data: Record<string, string>) => {
      const { currentConversationId } = get();
      if (!currentConversationId) {
        throw new Error('No active conversation');
      }

      // Store form completion
      set((state) => {
        state.completedForms[messageId] = data;
      });

      // Send form data as a message with DataPart
      try {
        const responseMessageId = crypto.randomUUID();
        set((state) => {
          state.formResponses[responseMessageId] = messageId;
          state.pendingMessages[responseMessageId] = 'pending';
        });

        // Send the form data as a message
        await a2aApi.sendMessage({
          conversationId: currentConversationId,
          message: JSON.stringify({ type: 'form_response', taskId, data }),
        });

        set((state) => {
          state.pendingMessages[responseMessageId] = 'sent';
        });

        // Refresh messages
        const messages = await a2aApi.listMessages(currentConversationId);
        set((state) => {
          const conversation = state.conversations.find(
            (c) => c.conversationId === currentConversationId
          );
          if (conversation) {
            conversation.messages = messages;
            conversation.updatedAt = new Date().toISOString();
          }
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to submit form';
        set((state) => {
          state.error = message;
        });
        throw error;
      }
    },

    cancelForm: async (messageId: string, _taskId: string) => {
      const { currentConversationId } = get();
      if (!currentConversationId) {
        throw new Error('No active conversation');
      }

      // Mark form as canceled (null data means canceled)
      set((state) => {
        state.completedForms[messageId] = null;
      });

      // Send cancellation message
      try {
        const responseMessageId = crypto.randomUUID();
        set((state) => {
          state.formResponses[responseMessageId] = messageId;
          state.pendingMessages[responseMessageId] = 'pending';
        });

        await a2aApi.sendMessage({
          conversationId: currentConversationId,
          message: 'rejected form entry',
        });

        set((state) => {
          state.pendingMessages[responseMessageId] = 'sent';
        });

        // Refresh messages
        const messages = await a2aApi.listMessages(currentConversationId);
        set((state) => {
          const conversation = state.conversations.find(
            (c) => c.conversationId === currentConversationId
          );
          if (conversation) {
            conversation.messages = messages;
            conversation.updatedAt = new Date().toISOString();
          }
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to cancel form';
        set((state) => {
          state.error = message;
        });
        throw error;
      }
    },

    isFormCompleted: (messageId: string) => {
      return messageId in get().completedForms;
    },

    getFormData: (messageId: string) => {
      return get().completedForms[messageId];
    },

    // =========================================================================
    // CHAT MODE
    // =========================================================================

    setChatMode: (mode: A2AChatMode) => {
      set((state) => {
        state.chatMode = mode;
      });
    },

    // =========================================================================
    // ORCHESTRATION
    // =========================================================================

    setGeminiApiKey: (key: string | null) => {
      set((state) => {
        state.geminiApiKey = key;
      });
      // Initialize or reset orchestrator based on key
      if (key) {
        orchestrator.initialize(key);
      } else {
        orchestrator.reset();
      }
    },

    // =========================================================================
    // UTILITY
    // =========================================================================

    clearError: () => {
      set((state) => {
        state.error = null;
      });
    },

    reset: () => {
      set((state) => {
        Object.assign(state, initialState);
      });
    },
  }),
  { name: 'A2AStore', persist: false }
);

// ============================================================================
// SELECTORS
// ============================================================================

export const selectConversations = (state: A2AStore) => state.conversations;
export const selectCurrentConversationId = (state: A2AStore) => state.currentConversationId;
export const selectCurrentConversation = (state: A2AStore) =>
  state.conversations.find((c) => c.conversationId === state.currentConversationId);
export const selectTasks = (state: A2AStore) => state.tasks;
export const selectRegisteredAgents = (state: A2AStore) => state.registeredAgents;
export const selectRobotAgentConfigs = (state: A2AStore) => state.robotAgentConfigs;
export const selectIsLoading = (state: A2AStore) => state.isLoading;
export const selectError = (state: A2AStore) => state.error;
export const selectWsConnected = (state: A2AStore) => state.wsConnected;

export const selectConversationById = (conversationId: string) => (state: A2AStore) =>
  state.conversations.find((c) => c.conversationId === conversationId);

export const selectTaskById = (taskId: string) => (state: A2AStore) =>
  state.tasks.find((t) => t.id === taskId);

export const selectRobotAgentConfig = (robotId: string) => (state: A2AStore) =>
  state.robotAgentConfigs[robotId];

export const selectActiveTasks = (state: A2AStore) =>
  state.tasks.filter((t) => !['completed', 'failed', 'canceled'].includes(t.status.state));

export const selectCompletedForms = (state: A2AStore) => state.completedForms;
export const selectFormResponses = (state: A2AStore) => state.formResponses;
export const selectPendingMessages = (state: A2AStore) => state.pendingMessages;

export const selectTasksAwaitingInput = (state: A2AStore) =>
  state.tasks.filter((t) => t.status.state === 'input_required');

export const selectChatMode = (state: A2AStore) => state.chatMode;
export const selectGeminiApiKey = (state: A2AStore) => state.geminiApiKey;
