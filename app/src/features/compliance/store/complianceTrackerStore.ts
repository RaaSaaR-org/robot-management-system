/**
 * @file complianceTrackerStore.ts
 * @description Zustand store for compliance monitoring dashboard state
 * @feature compliance
 */

import { create } from 'zustand';
import { complianceTrackerApi } from '../api';
import type {
  ComplianceDashboardStats,
  RegulatoryDeadline,
  ComplianceGap,
  TrainingRecord,
  InspectionSchedule,
  RiskAssessmentTracking,
  ComplianceActivity,
  RegulatoryFramework,
  GapSeverity,
} from '../types';

// Extended types with computed fields
interface RegulatoryDeadlineWithStatus extends RegulatoryDeadline {
  daysUntilDeadline: number;
}

interface ComplianceGapWithDays extends ComplianceGap {
  daysUntilDue: number | null;
  status: 'open' | 'in_progress' | 'closed';
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

interface DocumentExpiry {
  id: string;
  providerName: string;
  modelVersion: string;
  documentType: string;
  validTo: string | null;
  daysUntilExpiry: number | null;
  status: 'valid' | 'expiring_soon' | 'expired';
}

interface ComplianceTrackerState {
  // Dashboard
  dashboardStats: ComplianceDashboardStats | null;
  isLoadingDashboard: boolean;

  // Regulatory Deadlines
  deadlines: RegulatoryDeadlineWithStatus[];
  isLoadingDeadlines: boolean;

  // Gaps
  gaps: ComplianceGapWithDays[];
  gapSummary: Record<RegulatoryFramework, GapSummary> | null;
  isLoadingGaps: boolean;
  gapFilters: {
    framework?: RegulatoryFramework;
    severity?: GapSeverity;
    status?: 'open' | 'closed' | 'all';
  };

  // Documents
  expiringDocuments: DocumentExpiry[];
  isLoadingDocuments: boolean;

  // Training
  trainingRecords: TrainingRecordWithDays[];
  trainingSummary: TrainingSummary | null;
  isLoadingTraining: boolean;

  // Inspections
  inspectionSchedules: InspectionScheduleWithDays[];
  inspectionSummary: InspectionSummary | null;
  isLoadingInspections: boolean;

  // Risk Assessments
  riskAssessments: RiskAssessmentWithDays[];
  isLoadingRiskAssessments: boolean;

  // Activity
  recentActivity: ComplianceActivity[];
  isLoadingActivity: boolean;

  // Error
  error: string | null;

  // Actions
  fetchDashboardStats: () => Promise<void>;
  fetchRegulatoryDeadlines: () => Promise<void>;
  fetchGaps: (filters?: ComplianceTrackerState['gapFilters']) => Promise<void>;
  fetchGapSummary: () => Promise<void>;
  setGapFilters: (filters: Partial<ComplianceTrackerState['gapFilters']>) => void;
  fetchExpiringDocuments: (withinDays?: number) => Promise<void>;
  fetchTrainingRecords: () => Promise<void>;
  fetchTrainingSummary: () => Promise<void>;
  fetchInspectionSchedules: () => Promise<void>;
  fetchInspectionSummary: () => Promise<void>;
  fetchRiskAssessments: () => Promise<void>;
  fetchRecentActivity: (limit?: number) => Promise<void>;
  closeGap: (id: string, closedBy: string) => Promise<void>;
  updateDeadlineProgress: (id: string, completedRequirements: string[]) => Promise<void>;
  refreshAll: () => Promise<void>;
  clearError: () => void;
}

export const useComplianceTrackerStore = create<ComplianceTrackerState>((set, get) => ({
  // Initial state
  dashboardStats: null,
  isLoadingDashboard: false,

  deadlines: [],
  isLoadingDeadlines: false,

  gaps: [],
  gapSummary: null,
  isLoadingGaps: false,
  gapFilters: {},

  expiringDocuments: [],
  isLoadingDocuments: false,

  trainingRecords: [],
  trainingSummary: null,
  isLoadingTraining: false,

  inspectionSchedules: [],
  inspectionSummary: null,
  isLoadingInspections: false,

  riskAssessments: [],
  isLoadingRiskAssessments: false,

  recentActivity: [],
  isLoadingActivity: false,

  error: null,

  // Actions
  fetchDashboardStats: async () => {
    set({ isLoadingDashboard: true, error: null });
    try {
      const stats = await complianceTrackerApi.getDashboardStats();
      set({ dashboardStats: stats, isLoadingDashboard: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch dashboard stats',
        isLoadingDashboard: false,
      });
    }
  },

  fetchRegulatoryDeadlines: async () => {
    set({ isLoadingDeadlines: true, error: null });
    try {
      const deadlines = await complianceTrackerApi.getRegulatoryDeadlines();
      set({ deadlines, isLoadingDeadlines: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch deadlines',
        isLoadingDeadlines: false,
      });
    }
  },

  fetchGaps: async (filters) => {
    const appliedFilters = filters || get().gapFilters;
    set({ isLoadingGaps: true, error: null, gapFilters: appliedFilters });
    try {
      const gaps = await complianceTrackerApi.getGaps(appliedFilters);
      set({ gaps, isLoadingGaps: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch gaps',
        isLoadingGaps: false,
      });
    }
  },

  fetchGapSummary: async () => {
    try {
      const summary = await complianceTrackerApi.getGapSummary();
      set({ gapSummary: summary });
    } catch (error) {
      console.error('Failed to fetch gap summary:', error);
    }
  },

  setGapFilters: (filters) => {
    const currentFilters = get().gapFilters;
    const newFilters = { ...currentFilters, ...filters };
    set({ gapFilters: newFilters });
    get().fetchGaps(newFilters);
  },

  fetchExpiringDocuments: async (withinDays = 90) => {
    set({ isLoadingDocuments: true, error: null });
    try {
      const documents = await complianceTrackerApi.getExpiringDocuments(withinDays);
      set({ expiringDocuments: documents as unknown as DocumentExpiry[], isLoadingDocuments: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch expiring documents',
        isLoadingDocuments: false,
      });
    }
  },

  fetchTrainingRecords: async () => {
    set({ isLoadingTraining: true, error: null });
    try {
      const records = await complianceTrackerApi.getTrainingRecords();
      set({ trainingRecords: records, isLoadingTraining: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch training records',
        isLoadingTraining: false,
      });
    }
  },

  fetchTrainingSummary: async () => {
    try {
      const summary = await complianceTrackerApi.getTrainingSummary();
      set({ trainingSummary: summary });
    } catch (error) {
      console.error('Failed to fetch training summary:', error);
    }
  },

  fetchInspectionSchedules: async () => {
    set({ isLoadingInspections: true, error: null });
    try {
      const schedules = await complianceTrackerApi.getInspectionSchedules();
      set({ inspectionSchedules: schedules, isLoadingInspections: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch inspection schedules',
        isLoadingInspections: false,
      });
    }
  },

  fetchInspectionSummary: async () => {
    try {
      const summary = await complianceTrackerApi.getInspectionSummary();
      set({ inspectionSummary: summary });
    } catch (error) {
      console.error('Failed to fetch inspection summary:', error);
    }
  },

  fetchRiskAssessments: async () => {
    set({ isLoadingRiskAssessments: true, error: null });
    try {
      const assessments = await complianceTrackerApi.getRiskAssessments();
      set({ riskAssessments: assessments, isLoadingRiskAssessments: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch risk assessments',
        isLoadingRiskAssessments: false,
      });
    }
  },

  fetchRecentActivity: async (limit = 20) => {
    set({ isLoadingActivity: true, error: null });
    try {
      const activity = await complianceTrackerApi.getRecentActivity(limit);
      set({ recentActivity: activity, isLoadingActivity: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch activity',
        isLoadingActivity: false,
      });
    }
  },

  closeGap: async (id, closedBy) => {
    try {
      await complianceTrackerApi.closeGap(id, closedBy);
      // Refresh gaps after closing
      await get().fetchGaps();
      await get().fetchGapSummary();
      await get().fetchDashboardStats();
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to close gap',
      });
      throw error;
    }
  },

  updateDeadlineProgress: async (id, completedRequirements) => {
    try {
      await complianceTrackerApi.updateDeadlineProgress(id, completedRequirements);
      // Refresh deadlines after update
      await get().fetchRegulatoryDeadlines();
      await get().fetchDashboardStats();
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to update deadline progress',
      });
      throw error;
    }
  },

  refreshAll: async () => {
    const store = get();
    await Promise.all([
      store.fetchDashboardStats(),
      store.fetchRegulatoryDeadlines(),
      store.fetchGaps(),
      store.fetchGapSummary(),
      store.fetchExpiringDocuments(),
      store.fetchTrainingSummary(),
      store.fetchInspectionSummary(),
      store.fetchRecentActivity(),
    ]);
  },

  clearError: () => set({ error: null }),
}));
