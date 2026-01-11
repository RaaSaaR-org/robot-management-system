/**
 * @file complianceTrackerApi.ts
 * @description API calls for compliance monitoring dashboard
 * @feature compliance
 */

import { apiClient } from '@/api/client';
import type {
  ComplianceDashboardStats,
  RegulatoryDeadline,
  ComplianceGap,
  DocumentExpiry,
  TrainingRecord,
  InspectionSchedule,
  RiskAssessmentTracking,
  ComplianceActivity,
  RegulatoryFramework,
  GapSeverity,
  TrainingType,
  InspectionType,
  RiskAssessmentType,
  GapAnalysisQuery,
  TrainingRecordQuery,
  InspectionScheduleQuery,
  RiskAssessmentQuery,
} from '../types';

const ENDPOINTS = {
  dashboard: '/compliance/tracker/dashboard',
  deadlines: '/compliance/tracker/deadlines',
  gaps: '/compliance/tracker/gaps',
  gapsSummary: '/compliance/tracker/gaps/summary',
  documentsExpiring: '/compliance/tracker/documents/expiring',
  training: '/compliance/tracker/training',
  trainingSummary: '/compliance/tracker/training/summary',
  inspections: '/compliance/tracker/inspections',
  inspectionsSummary: '/compliance/tracker/inspections/summary',
  riskAssessments: '/compliance/tracker/risk-assessments',
  activity: '/compliance/tracker/activity',
  initialize: '/compliance/tracker/initialize',
} as const;

// ============================================================================
// TYPES
// ============================================================================

interface RegulatoryDeadlineWithStatus extends RegulatoryDeadline {
  daysUntilDeadline: number;
}

interface ComplianceGapWithDays extends ComplianceGap {
  daysUntilDue: number | null;
  status: 'open' | 'in_progress' | 'closed';
}

interface DocumentExpiryWithDays extends Omit<DocumentExpiry, 'daysUntilExpiry'> {
  daysUntilExpiry: number | null;
}

interface TrainingRecordWithDays extends TrainingRecord {
  daysUntilExpiry: number;
}

interface InspectionScheduleWithDays extends InspectionSchedule {
  daysUntilDue: number;
}

interface RiskAssessmentWithDays extends RiskAssessmentTracking {
  daysUntilReview: number;
}

interface GapSummary {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
}

interface TrainingSummary {
  totalRecords: number;
  totalEmployees: number;
  valid: number;
  expiringSoon: number;
  expired: number;
}

interface InspectionSummary {
  totalScheduled: number;
  current: number;
  dueSoon: number;
  overdue: number;
  nextInspection: InspectionScheduleWithDays | null;
}

// ============================================================================
// API
// ============================================================================

export const complianceTrackerApi = {
  // ==========================================================================
  // DASHBOARD
  // ==========================================================================

  /**
   * Get overall dashboard statistics
   */
  async getDashboardStats(): Promise<ComplianceDashboardStats> {
    const response = await apiClient.get<ComplianceDashboardStats>(ENDPOINTS.dashboard);
    return response.data;
  },

  // ==========================================================================
  // REGULATORY DEADLINES
  // ==========================================================================

  /**
   * Get all regulatory deadlines
   */
  async getRegulatoryDeadlines(): Promise<RegulatoryDeadlineWithStatus[]> {
    const response = await apiClient.get<{ deadlines: RegulatoryDeadlineWithStatus[] }>(
      ENDPOINTS.deadlines
    );
    return response.data.deadlines;
  },

  /**
   * Create a new regulatory deadline
   */
  async createRegulatoryDeadline(input: {
    framework: RegulatoryFramework;
    name: string;
    deadline: string;
    description: string;
    requirements: string[];
    priority?: 'critical' | 'high' | 'medium' | 'low';
    notes?: string;
  }): Promise<RegulatoryDeadline> {
    const response = await apiClient.post<RegulatoryDeadline>(ENDPOINTS.deadlines, input);
    return response.data;
  },

  /**
   * Update deadline progress
   */
  async updateDeadlineProgress(
    id: string,
    completedRequirements: string[]
  ): Promise<RegulatoryDeadline> {
    const response = await apiClient.put<RegulatoryDeadline>(
      `${ENDPOINTS.deadlines}/${id}/progress`,
      { completedRequirements }
    );
    return response.data;
  },

  // ==========================================================================
  // GAP ANALYSIS
  // ==========================================================================

  /**
   * Get compliance gaps
   */
  async getGaps(query?: GapAnalysisQuery): Promise<ComplianceGapWithDays[]> {
    const response = await apiClient.get<{ gaps: ComplianceGapWithDays[] }>(ENDPOINTS.gaps, {
      params: query,
    });
    return response.data.gaps;
  },

  /**
   * Get gap summary by framework
   */
  async getGapSummary(): Promise<Record<RegulatoryFramework, GapSummary>> {
    const response = await apiClient.get<{ summary: Record<RegulatoryFramework, GapSummary> }>(
      ENDPOINTS.gapsSummary
    );
    return response.data.summary;
  },

  /**
   * Create a compliance gap
   */
  async createGap(input: {
    framework: RegulatoryFramework;
    requirement: string;
    articleReference: string;
    severity: GapSeverity;
    description: string;
    currentState: string;
    targetState: string;
    remediation: string;
    estimatedEffort?: 'low' | 'medium' | 'high';
    dueDate?: string;
    assignedTo?: string;
  }): Promise<ComplianceGap> {
    const response = await apiClient.post<ComplianceGap>(ENDPOINTS.gaps, input);
    return response.data;
  },

  /**
   * Close a compliance gap
   */
  async closeGap(id: string, closedBy: string): Promise<ComplianceGap> {
    const response = await apiClient.put<ComplianceGap>(`${ENDPOINTS.gaps}/${id}/close`, {
      closedBy,
    });
    return response.data;
  },

  // ==========================================================================
  // DOCUMENT EXPIRY
  // ==========================================================================

  /**
   * Get expiring documents
   */
  async getExpiringDocuments(withinDays: number = 30): Promise<DocumentExpiryWithDays[]> {
    const response = await apiClient.get<{ documents: DocumentExpiryWithDays[] }>(
      ENDPOINTS.documentsExpiring,
      { params: { withinDays } }
    );
    return response.data.documents;
  },

  // ==========================================================================
  // TRAINING RECORDS
  // ==========================================================================

  /**
   * Get training records
   */
  async getTrainingRecords(query?: TrainingRecordQuery): Promise<TrainingRecordWithDays[]> {
    const response = await apiClient.get<{ records: TrainingRecordWithDays[] }>(
      ENDPOINTS.training,
      { params: query }
    );
    return response.data.records;
  },

  /**
   * Get training summary
   */
  async getTrainingSummary(): Promise<TrainingSummary> {
    const response = await apiClient.get<TrainingSummary>(ENDPOINTS.trainingSummary);
    return response.data;
  },

  /**
   * Create a training record
   */
  async createTrainingRecord(input: {
    userId: string;
    userName: string;
    userEmail?: string;
    trainingType: TrainingType;
    completedAt: string;
    expiresAt: string;
    certificateUrl?: string;
    trainingProvider?: string;
    notes?: string;
  }): Promise<TrainingRecord> {
    const response = await apiClient.post<TrainingRecord>(ENDPOINTS.training, input);
    return response.data;
  },

  // ==========================================================================
  // INSPECTION SCHEDULES
  // ==========================================================================

  /**
   * Get inspection schedules
   */
  async getInspectionSchedules(
    query?: InspectionScheduleQuery
  ): Promise<InspectionScheduleWithDays[]> {
    const response = await apiClient.get<{ schedules: InspectionScheduleWithDays[] }>(
      ENDPOINTS.inspections,
      { params: query }
    );
    return response.data.schedules;
  },

  /**
   * Get inspection summary
   */
  async getInspectionSummary(): Promise<InspectionSummary> {
    const response = await apiClient.get<InspectionSummary>(ENDPOINTS.inspectionsSummary);
    return response.data;
  },

  /**
   * Create an inspection schedule
   */
  async createInspectionSchedule(input: {
    inspectionType: InspectionType;
    robotId?: string;
    robotName?: string;
    lastInspectionDate: string;
    nextDueDate: string;
    intervalYears: number;
    inspectorName?: string;
    inspectorCompany?: string;
    reportUrl?: string;
    notes?: string;
  }): Promise<InspectionSchedule> {
    const response = await apiClient.post<InspectionSchedule>(ENDPOINTS.inspections, input);
    return response.data;
  },

  /**
   * Record inspection completion
   */
  async completeInspection(
    id: string,
    reportUrl?: string,
    inspectorName?: string
  ): Promise<InspectionSchedule> {
    const response = await apiClient.put<InspectionSchedule>(
      `${ENDPOINTS.inspections}/${id}/complete`,
      { reportUrl, inspectorName }
    );
    return response.data;
  },

  // ==========================================================================
  // RISK ASSESSMENTS
  // ==========================================================================

  /**
   * Get risk assessments
   */
  async getRiskAssessments(query?: RiskAssessmentQuery): Promise<RiskAssessmentWithDays[]> {
    const response = await apiClient.get<{ assessments: RiskAssessmentWithDays[] }>(
      ENDPOINTS.riskAssessments,
      { params: query }
    );
    return response.data.assessments;
  },

  /**
   * Create a risk assessment
   */
  async createRiskAssessment(input: {
    assessmentType: RiskAssessmentType;
    name: string;
    version: string;
    description?: string;
    lastUpdated: string;
    nextReviewDate: string;
    triggerConditions?: string[];
    documentUrl?: string;
    responsiblePerson?: string;
  }): Promise<RiskAssessmentTracking> {
    const response = await apiClient.post<RiskAssessmentTracking>(
      ENDPOINTS.riskAssessments,
      input
    );
    return response.data;
  },

  /**
   * Update a risk assessment
   */
  async updateRiskAssessment(
    id: string,
    newVersion: string,
    nextReviewDate: string,
    documentUrl?: string
  ): Promise<RiskAssessmentTracking> {
    const response = await apiClient.put<RiskAssessmentTracking>(
      `${ENDPOINTS.riskAssessments}/${id}/update`,
      { newVersion, nextReviewDate, documentUrl }
    );
    return response.data;
  },

  // ==========================================================================
  // ACTIVITY
  // ==========================================================================

  /**
   * Get recent compliance activity
   */
  async getRecentActivity(limit: number = 20): Promise<ComplianceActivity[]> {
    const response = await apiClient.get<{ activity: ComplianceActivity[] }>(ENDPOINTS.activity, {
      params: { limit },
    });
    return response.data.activity;
  },

  // ==========================================================================
  // INITIALIZATION
  // ==========================================================================

  /**
   * Initialize default regulatory deadlines
   */
  async initializeDefaults(): Promise<void> {
    await apiClient.post(ENDPOINTS.initialize);
  },
};
