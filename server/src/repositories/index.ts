/**
 * @file index.ts
 * @description Barrel export for all repositories
 */

export { robotRepository, RobotRepository } from './RobotRepository.js';
export {
  sensorScanRepository,
  SensorScanRepository,
  type SensorScanRecord,
  type CreateSensorScanInput,
  type ScanPose,
} from './SensorScanRepository.js';
// Digital Twin (TASK-170)
export { digitalTwinRepository, DigitalTwinRepository } from './DigitalTwinRepository.js';
export { scanSessionRepository, ScanSessionRepository } from './ScanSessionRepository.js';
export { twinZoneRepository, TwinZoneRepository } from './TwinZoneRepository.js';
// Real-to-Sim / Sim-to-Real (TASK-171)
export {
  simSceneRepository,
  SimSceneRepository,
  type SimSceneRecord,
  type SimSceneBounds,
  type SimSceneSource,
  type SimSceneBackend,
  type UpsertBuiltinSceneInput,
  type UpsertTwinSceneInput,
} from './SimSceneRepository.js';
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
// Skill & Data Marketplace (TASK-156)
export {
  marketplaceRepository,
  MarketplaceRepository,
  type MarketplaceListingRecord,
  type ListingLicenseRecord,
  type ListingReviewRecord,
  type ListingVersionRecord,
  type ListingPurchaseRecord,
  type SellerStats,
  type ListingFilter,
} from './MarketplaceRepository.js';

// LeRobot 0.6.0 adoption (TASK-179)
export {
  episodeRewardRepository,
  EpisodeRewardRepository,
  type EpisodeReward,
  type UpsertEpisodeRewardInput,
} from './EpisodeRewardRepository.js';
export {
  interventionEpisodeRepository,
  InterventionEpisodeRepository,
  type InterventionEpisode,
  type InterventionStep,
  type CreateInterventionEpisodeInput,
} from './InterventionEpisodeRepository.js';

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
  modelCheckpointRepository,
  ModelCheckpointRepository,
  deploymentRepository,
  DeploymentRepository,
  skillChainRepository,
  SkillChainRepository,
} from './VLARepository.js';
export { patrolRepository, PatrolRepository } from './PatrolRepository.js';
export type {
  PatrolRouteRecord,
  PatrolRunRecord,
  PatrolFindingRecord,
  CreatePatrolRouteInput,
  UpdatePatrolRouteInput,
} from './PatrolRepository.js';
export { tourRepository, TourRepository } from './TourRepository.js';
export type {
  TourRouteRecord,
  TourRunRecord,
  CreateTourRouteInput,
  UpdateTourRouteInput,
} from './TourRepository.js';
