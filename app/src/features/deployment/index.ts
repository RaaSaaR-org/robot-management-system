/**
 * @file index.ts
 * @description Public exports for the deployment feature module
 * @feature deployment
 */

// Types - selectively export to avoid naming conflicts with components
export type {
  DeploymentStatus,
  DeploymentStrategy,
  SkillStatus,
  SkillChainStatus,
  SkillExecutionStatus,
  FailureStrategy,
  ConditionType,
  CanaryStage,
  CanaryConfig,
  RollbackThresholds,
  RobotMetricsSummary,
  AggregatedDeploymentMetrics,
  ThresholdViolation,
  TrainingMetrics,
  ModelVersionMetrics,
  ModelVersion,
  Deployment,
  DeploymentResponse,
  CreateDeploymentInput,
  RollbackRequest,
  DeploymentQueryParams,
  Condition,
  SkillParameter,
  SkillDefinition,
  CreateSkillInput,
  UpdateSkillInput,
  SkillQueryParams,
  SkillChainStep,
  SkillChain,
  CreateSkillChainInput,
  UpdateSkillChainInput,
  SkillChainQueryParams,
  ConditionCheckResult,
  SkillExecutionResult,
  ChainExecutionResult,
  ExecuteSkillRequest,
  ExecuteChainRequest,
  ValidationError,
  ParameterValidationResult,
  RobotType,
  RobotCompatibility,
  CompatibilityCheckResult,
  DeploymentEventType,
  DeploymentEvent,
  SkillEventType,
  SkillEvent,
  PaginationInfo,
  DeploymentsListResponse,
  SkillsListResponse,
  SkillChainsListResponse,
  DeploymentFilters,
  SkillFilters,
  DeploymentState,
  DeploymentActions,
  DeploymentStore,
} from './types';

// Export constants from types
export {
  DeploymentStatuses,
  DeploymentStrategies,
  SkillStatuses,
  SkillChainStatuses,
  SkillExecutionStatuses,
  FailureStrategies,
  ConditionTypes,
  DEPLOYMENT_STATUS_LABELS,
  DEPLOYMENT_STATUS_COLORS,
  SKILL_STATUS_LABELS,
  SKILL_STATUS_COLORS,
  DEFAULT_CANARY_STAGES,
  DEFAULT_ROLLBACK_THRESHOLDS,
  DEFAULT_CANARY_CONFIG,
  CANARY_PRESETS,
  DeploymentEventTypes,
  SkillEventTypes,
} from './types';

// API
export * from './api';

// Store
export { useDeploymentStore } from './store';

// Hooks
export * from './hooks';

// Components - renamed exports to avoid conflicts with types
export {
  CanaryConfig as CanaryConfigWizard,
  DeploymentCard,
  DeploymentProgress,
  DeploymentStatus as DeploymentStatusPanel,
  DeploymentStatusBadge,
  ModelBrowser,
  ModelVersionCard,
  RobotSelector,
  RollbackConfirmation,
  SkillBrowser,
  SkillCard,
  SkillEditor,
  SkillStatusBadge,
} from './components';

// Pages
export { DeploymentsPage, DeploymentDetailPage, SkillsPage } from './pages';
