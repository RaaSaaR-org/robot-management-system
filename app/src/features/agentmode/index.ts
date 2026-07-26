/**
 * @file index.ts
 * @description Barrel export for the agentmode feature (TASK-194)
 * @feature agentmode
 */

// Types
export * from './types/agentmode.types';

// Store
export {
  useAgentModeStore,
  selectRobotId,
  selectEnabled,
  selectControlOwner,
  selectEstopActive,
  selectPlan,
  selectPlanHistory,
  selectScene,
  selectSceneEntities,
  selectMessages,
  selectPendingCommand,
  selectConnectionStatus,
  selectIsLoading,
  selectIsSending,
  selectError,
  selectCurrentBlock,
  selectUpcomingBlocks,
  selectPlanById,
} from './store/agentmodeStore';

// API
export { agentmodeApi } from './api/agentmodeApi';

// Hooks
export { useAgentModeSocket } from './hooks/useAgentModeSocket';
export type { UseAgentModeSocketReturn } from './hooks/useAgentModeSocket';

// Components
export {
  BlockCard,
  BlockTimeline,
  AgentChat,
  ScenePanel,
  AgentModeToggle,
} from './components';

// Pages
export { AgentModePage } from './pages/AgentModePage';
