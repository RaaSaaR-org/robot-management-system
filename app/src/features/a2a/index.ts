/**
 * @file index.ts
 * @description Barrel exports for A2A feature
 * @feature a2a
 */

// Types
export * from './types';

// Store
export {
  useA2AStore,
  selectConversations,
  selectCurrentConversationId,
  selectCurrentConversation,
  selectTasks,
  selectRegisteredAgents,
  selectRobotAgentConfigs,
  selectIsLoading,
  selectError,
  selectWsConnected,
  selectConversationById,
  selectTaskById,
  selectRobotAgentConfig,
  selectActiveTasks,
  selectCompletedForms,
  selectFormResponses,
  selectPendingMessages,
  selectTasksAwaitingInput,
} from './store';

// API
export { a2aApi } from './api';

// Hooks
export { useA2A } from './hooks/useA2A';
export { useConversation, useNewConversation } from './hooks/useConversation';
export { useA2AStream, useA2AHeartbeat } from './hooks/useA2AStream';

// Components
export {
  MessageBubble,
  ConversationPanel,
  ConversationList,
  TaskStatusCard,
  TaskStatusBadge,
  AgentCard,
  AgentListItem,
  AgentList,
  RegisterAgentDialog,
  FormRenderer,
  CompletedFormCard,
  EventList,
} from './components';

// Pages
export {
  A2APage,
  EventsPage,
  ChatPage,
  OrchestratorChatPage,
  AgentListPage,
  AgentDetailPage,
  TaskListPage,
} from './pages';
