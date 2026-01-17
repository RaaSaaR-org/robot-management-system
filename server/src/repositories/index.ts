/**
 * @file index.ts
 * @description Barrel export for all repositories
 */

export { robotRepository, RobotRepository } from './RobotRepository.js';
export { conversationRepository, ConversationRepository } from './ConversationRepository.js';
export { taskRepository, TaskRepository } from './TaskRepository.js';
export { agentRepository, AgentRepository } from './AgentRepository.js';
export { eventRepository, EventRepository } from './EventRepository.js';
export { userRepository, UserRepository } from './UserRepository.js';
export type { User, UserWithPassword, CreateUserInput, UpdateUserInput } from './UserRepository.js';
export { refreshTokenRepository, RefreshTokenRepository } from './RefreshTokenRepository.js';
export type { RefreshToken } from './RefreshTokenRepository.js';
export { alertRepository, AlertRepository } from './AlertRepository.js';
export type {
  Alert,
  AlertSeverity,
  AlertSource,
  CreateAlertInput,
  AlertFilters,
  PaginationParams,
  PaginatedResult,
} from './AlertRepository.js';
export { zoneRepository, ZoneRepository } from './ZoneRepository.js';
export type {
  Zone,
  ZoneType,
  ZoneBounds,
  CreateZoneInput,
  UpdateZoneInput,
  ZoneFilters,
} from './ZoneRepository.js';
export { commandRepository, CommandRepository } from './CommandRepository.js';
export type {
  CommandInterpretation,
  CommandParameters,
  CommandType,
  SafetyClassification,
  CommandHistoryStatus,
  CreateCommandInterpretationInput,
  CommandHistoryResponse,
} from './CommandRepository.js';
export { decisionRepository, DecisionRepository } from './DecisionRepository.js';
export type {
  DecisionExplanation,
  DecisionInputFactors,
  AlternativeConsidered,
  DecisionSafetyFactors,
  CreateDecisionInput,
  DecisionListResponse,
  DecisionQueryParams,
  AIPerformanceMetrics,
  AIDocumentation,
  DecisionType,
} from './DecisionRepository.js';
export { complianceLogRepository, ComplianceLogRepository } from './ComplianceLogRepository.js';

// VLA (Vision-Language-Action) Training Management
export {
  robotTypeRepository,
  RobotTypeRepository,
  skillDefinitionRepository,
  SkillDefinitionRepository,
  datasetRepository,
  DatasetRepository,
  trainingJobRepository,
  TrainingJobRepository,
  modelVersionRepository,
  ModelVersionRepository,
  deploymentRepository,
  DeploymentRepository,
  skillChainRepository,
  SkillChainRepository,
} from './VLARepository.js';
