/**
 * @file training-docs.types.ts
 * @description Type definitions for EU AI Act Training Data Compliance Documentation
 * @feature compliance
 */

// ============================================================================
// PROVENANCE TYPES
// ============================================================================

/**
 * Source type for dataset provenance
 */
export type DatasetSourceType =
  | 'collected'    // Internally collected data
  | 'purchased'    // Commercially purchased data
  | 'synthetic'    // Synthetically generated data
  | 'open_source'  // Open source datasets
  | 'contributed'; // Customer/partner contributed data

/**
 * Dataset provenance record
 */
export interface DatasetProvenance {
  id: string;
  datasetId: string;
  sourceType: DatasetSourceType;
  sourceName: string | null;
  sourceUrl: string | null;
  collectionMethod: string | null;
  collectionPeriod: { start: Date; end: Date } | null;
  labelingProcedure: string | null;
  annotatorInfo: string | null;
  cleaningSteps: string[] | null;
  licenseType: string | null;
  copyrightCompliance: string | null;
  chainOfCustody: CustodyTransfer[] | null;
  recordedAt: Date;
  recordedBy: string;
  updatedAt: Date;
}

/**
 * Chain of custody transfer record
 */
export interface CustodyTransfer {
  from: string;
  to: string;
  date: Date;
  reason: string;
  verifiedBy?: string;
}

// ============================================================================
// TRAINING DATA SUMMARY TYPES (AI Act GPAI Template)
// ============================================================================

/**
 * Training data summary for EU AI Act compliance
 */
export interface TrainingDataSummary {
  id: string;
  modelVersionId: string;
  datasetIds: string[];
  totalTrajectories: number;
  publicDatasets: string[] | null;
  privateDatasets: string[] | null;
  webScrapingSources: string[] | null;
  copyrightMeasures: string;
  processingPurposes: string[];
  knownGaps: string[];
  limitations: string[] | null;
  generatedAt: Date;
  lastUpdated: Date;
  nextUpdateDue: Date;
  generatedBy: string;
}

/**
 * Summary with enriched dataset information
 */
export interface TrainingDataSummaryResponse extends TrainingDataSummary {
  datasets: Array<{
    id: string;
    name: string;
    sourceType: DatasetSourceType;
    trajectoryCount: number;
    isPublic: boolean;
  }>;
  modelVersion: {
    id: string;
    skillId: string;
    version: string;
    skillName?: string;
  };
  daysUntilUpdateDue: number;
  isUpdateOverdue: boolean;
}

// ============================================================================
// BIAS ASSESSMENT TYPES
// ============================================================================

/**
 * Bias assessment status
 */
export type BiasAssessmentStatus = 'draft' | 'reviewed' | 'approved';

/**
 * Bias assessment record
 */
export interface BiasAssessment {
  id: string;
  modelVersionId: string;
  assessmentVersion: number;
  demographicCoverage: Record<string, string>;
  geographicCoverage: Record<string, string> | null;
  taskCoverage: Record<string, string> | null;
  knownLimitations: string[];
  potentialBiasSources: string[];
  mitigationMeasures: string[];
  testingResults: BiasTestingResults | null;
  assessedBy: string;
  reviewedBy: string | null;
  assessmentDate: Date;
  reviewedDate: Date | null;
  status: BiasAssessmentStatus;
  notes: string | null;
}

/**
 * Bias testing results
 */
export interface BiasTestingResults {
  testDate: Date;
  testMethodology: string;
  metrics: Array<{
    name: string;
    value: number;
    threshold?: number;
    passed?: boolean;
  }>;
  demographicParityGap?: number;
  equalizedOddsGap?: number;
  calibrationGap?: number;
  overallAssessment: 'pass' | 'marginal' | 'fail';
  recommendations?: string[];
}

// ============================================================================
// DTO TYPES
// ============================================================================

/**
 * Create/update provenance request
 */
export interface UpsertProvenanceDto {
  sourceType: DatasetSourceType;
  sourceName?: string;
  sourceUrl?: string;
  collectionMethod?: string;
  collectionPeriod?: { start: string; end: string };
  labelingProcedure?: string;
  annotatorInfo?: string;
  cleaningSteps?: string[];
  licenseType?: string;
  copyrightCompliance?: string;
  chainOfCustody?: CustodyTransfer[];
}

/**
 * Generate summary request
 */
export interface GenerateSummaryDto {
  datasetIds: string[];
  copyrightMeasures: string;
  processingPurposes: string[];
  knownGaps?: string[];
  limitations?: string[];
  webScrapingSources?: string[];
}

/**
 * Update summary request
 */
export interface UpdateSummaryDto {
  copyrightMeasures?: string;
  processingPurposes?: string[];
  knownGaps?: string[];
  limitations?: string[];
}

/**
 * Create bias assessment request
 */
export interface CreateBiasAssessmentDto {
  demographicCoverage: Record<string, string>;
  geographicCoverage?: Record<string, string>;
  taskCoverage?: Record<string, string>;
  knownLimitations: string[];
  potentialBiasSources: string[];
  mitigationMeasures: string[];
  testingResults?: BiasTestingResults;
  notes?: string;
}

/**
 * Update bias assessment request
 */
export interface UpdateBiasAssessmentDto {
  demographicCoverage?: Record<string, string>;
  geographicCoverage?: Record<string, string>;
  taskCoverage?: Record<string, string>;
  knownLimitations?: string[];
  potentialBiasSources?: string[];
  mitigationMeasures?: string[];
  testingResults?: BiasTestingResults;
  status?: BiasAssessmentStatus;
  notes?: string;
}

// ============================================================================
// QUERY TYPES
// ============================================================================

/**
 * Query parameters for summaries needing updates
 */
export interface SummariesDueQuery {
  daysAhead?: number; // Default 30 days
  page?: number;
  limit?: number;
}

/**
 * Response for summaries due for update
 */
export interface SummariesDueResponse {
  summaries: Array<{
    modelVersionId: string;
    skillName: string;
    version: string;
    nextUpdateDue: Date;
    daysUntilDue: number;
    isOverdue: boolean;
  }>;
  total: number;
  overdueCount: number;
}

// ============================================================================
// EXPORT TYPES
// ============================================================================

/**
 * Export format options
 */
export type ExportFormat = 'json' | 'markdown' | 'pdf';

/**
 * Export request
 */
export interface ExportSummaryRequest {
  format?: ExportFormat;
  includeProvenance?: boolean;
  includeBiasAssessment?: boolean;
}

/**
 * Exported document metadata
 */
export interface ExportedDocument {
  modelVersionId: string;
  format: ExportFormat;
  content: string;
  filename: string;
  generatedAt: Date;
  sections: string[];
}

// ============================================================================
// EVENT TYPES
// ============================================================================

/**
 * Training docs event types
 */
export type TrainingDocsEventType =
  | 'provenance:recorded'
  | 'summary:generated'
  | 'summary:updated'
  | 'summary:update_due'
  | 'summary:overdue'
  | 'bias:assessed'
  | 'bias:reviewed'
  | 'bias:approved';

/**
 * Training docs event
 */
export interface TrainingDocsEvent {
  type: TrainingDocsEventType;
  entityId: string;
  entityType: 'provenance' | 'summary' | 'bias_assessment';
  modelVersionId?: string;
  datasetId?: string;
  timestamp: Date;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * AI Act required update interval (6 months)
 */
export const AI_ACT_UPDATE_INTERVAL_DAYS = 180;

/**
 * Default demographic categories to document
 */
export const DEFAULT_DEMOGRAPHIC_CATEGORIES = [
  'age_distribution',
  'geographic_regions',
  'task_types',
  'environmental_conditions',
  'robot_embodiments',
  'operator_experience_levels',
] as const;

/**
 * Standard bias sources to consider
 */
export const STANDARD_BIAS_SOURCES = [
  'Selection bias in data collection',
  'Labeling inconsistencies',
  'Underrepresentation of edge cases',
  'Environmental condition bias',
  'Operator skill level bias',
  'Robot hardware variations',
  'Temporal distribution bias',
] as const;

/**
 * Standard processing purposes for robot training data
 */
export const STANDARD_PROCESSING_PURPOSES = [
  'Training vision-language-action models',
  'Skill learning and generalization',
  'Motion planning optimization',
  'Safety behavior validation',
  'Performance benchmarking',
] as const;
