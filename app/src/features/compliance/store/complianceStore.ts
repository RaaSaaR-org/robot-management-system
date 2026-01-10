/**
 * @file complianceStore.ts
 * @description Zustand store for compliance logging state
 * @feature compliance
 */

import { create } from 'zustand';
import { complianceApi } from '../api';
import type {
  ComplianceLog,
  ComplianceLogQueryParams,
  HashChainVerificationResult,
  ComplianceMetricsSummary,
  ComplianceEventType,
  ComplianceSeverity,
  RetentionPolicy,
  RetentionStats,
  LegalHold,
  LegalHoldInput,
  RopaEntry,
  RopaEntryInput,
  RopaReport,
  ExportOptions,
  ExportResult,
  ProviderSummary,
  ProviderDocumentation,
} from '../types';

interface ComplianceState {
  // Data
  logs: ComplianceLog[];
  selectedLog: ComplianceLog | null;
  integrityResult: HashChainVerificationResult | null;
  metrics: ComplianceMetricsSummary | null;

  // Retention policies
  retentionPolicies: RetentionPolicy[];
  retentionStats: RetentionStats | null;

  // Legal holds
  legalHolds: LegalHold[];
  selectedLegalHold: LegalHold | null;

  // RoPA (Records of Processing Activities)
  ropaEntries: RopaEntry[];
  selectedRopaEntry: RopaEntry | null;
  ropaReport: RopaReport | null;

  // Export
  lastExportResult: ExportResult | null;

  // Provider documentation
  providers: ProviderSummary[];
  providerDocs: ProviderDocumentation[];

  // Pagination
  page: number;
  limit: number;
  total: number;
  totalPages: number;

  // Filters
  filters: {
    robotId?: string;
    eventType?: ComplianceEventType;
    severity?: ComplianceSeverity;
    startDate?: string;
    endDate?: string;
  };

  // Loading states
  isLoading: boolean;
  isLoadingLog: boolean;
  isVerifying: boolean;
  isLoadingMetrics: boolean;
  isLoadingRetention: boolean;
  isLoadingLegalHolds: boolean;
  isLoadingRopa: boolean;
  isExporting: boolean;
  isLoadingProviders: boolean;
  isCleaningUp: boolean;

  // Errors
  error: string | null;

  // Log Actions
  fetchLogs: (params?: ComplianceLogQueryParams) => Promise<void>;
  fetchLog: (id: string) => Promise<void>;
  verifyIntegrity: (startDate?: string, endDate?: string) => Promise<void>;
  fetchMetrics: (startDate?: string, endDate?: string) => Promise<void>;
  setPage: (page: number) => void;
  setLimit: (limit: number) => void;
  setFilters: (filters: Partial<ComplianceState['filters']>) => void;
  clearFilters: () => void;
  clearSelectedLog: () => void;
  clearError: () => void;

  // Retention Actions
  fetchRetentionPolicies: () => Promise<void>;
  fetchRetentionStats: () => Promise<void>;
  setRetentionPolicy: (eventType: string, retentionDays: number, description?: string) => Promise<void>;
  triggerCleanup: () => Promise<{ logsDeleted: number; logsSkipped: number }>;

  // Legal Hold Actions
  fetchLegalHolds: (activeOnly?: boolean) => Promise<void>;
  createLegalHold: (input: LegalHoldInput) => Promise<LegalHold>;
  releaseLegalHold: (holdId: string) => Promise<void>;
  addLogsToHold: (holdId: string, logIds: string[]) => Promise<void>;

  // RoPA Actions
  fetchRopaEntries: () => Promise<void>;
  fetchRopaEntry: (id: string) => Promise<void>;
  createRopaEntry: (input: RopaEntryInput) => Promise<RopaEntry>;
  updateRopaEntry: (id: string, input: Partial<RopaEntryInput>) => Promise<void>;
  deleteRopaEntry: (id: string) => Promise<void>;
  generateRopaReport: (organizationName?: string) => Promise<void>;
  clearSelectedRopaEntry: () => void;

  // Export Actions
  exportLogs: (options: ExportOptions) => Promise<ExportResult>;
  clearExportResult: () => void;

  // Provider Actions
  fetchProviders: () => Promise<void>;
  fetchProviderDocs: (providerName: string) => Promise<void>;
  fetchAllDocumentation: () => Promise<void>;
}

export const useComplianceStore = create<ComplianceState>((set, get) => ({
  // Initial data
  logs: [],
  selectedLog: null,
  integrityResult: null,
  metrics: null,

  // Initial retention
  retentionPolicies: [],
  retentionStats: null,

  // Initial legal holds
  legalHolds: [],
  selectedLegalHold: null,

  // Initial RoPA
  ropaEntries: [],
  selectedRopaEntry: null,
  ropaReport: null,

  // Initial export
  lastExportResult: null,

  // Initial provider docs
  providers: [],
  providerDocs: [],

  // Initial pagination
  page: 1,
  limit: 20,
  total: 0,
  totalPages: 0,

  // Initial filters
  filters: {},

  // Initial loading states
  isLoading: false,
  isLoadingLog: false,
  isVerifying: false,
  isLoadingMetrics: false,
  isLoadingRetention: false,
  isLoadingLegalHolds: false,
  isLoadingRopa: false,
  isExporting: false,
  isLoadingProviders: false,
  isCleaningUp: false,

  // Initial errors
  error: null,

  // Actions
  fetchLogs: async (params?: ComplianceLogQueryParams) => {
    set({ isLoading: true, error: null });
    try {
      const state = get();
      const queryParams: ComplianceLogQueryParams = {
        page: state.page,
        limit: state.limit,
        ...state.filters,
        ...params,
      };

      const response = await complianceApi.getLogs(queryParams);

      set({
        logs: response.logs,
        total: response.total,
        page: response.page,
        totalPages: response.totalPages,
        isLoading: false,
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch logs',
        isLoading: false,
      });
    }
  },

  fetchLog: async (id: string) => {
    set({ isLoadingLog: true, error: null });
    try {
      const log = await complianceApi.getLog(id);
      set({ selectedLog: log, isLoadingLog: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch log',
        isLoadingLog: false,
      });
    }
  },

  verifyIntegrity: async (startDate?: string, endDate?: string) => {
    set({ isVerifying: true, error: null });
    try {
      const result = await complianceApi.verifyIntegrity(startDate, endDate);
      set({ integrityResult: result, isVerifying: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to verify integrity',
        isVerifying: false,
      });
    }
  },

  fetchMetrics: async (startDate?: string, endDate?: string) => {
    set({ isLoadingMetrics: true, error: null });
    try {
      const metrics = await complianceApi.getMetrics(startDate, endDate);
      set({ metrics, isLoadingMetrics: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch metrics',
        isLoadingMetrics: false,
      });
    }
  },

  setPage: (page: number) => {
    set({ page });
    get().fetchLogs();
  },

  setLimit: (limit: number) => {
    set({ limit, page: 1 });
    get().fetchLogs();
  },

  setFilters: (filters: Partial<ComplianceState['filters']>) => {
    set((state) => ({
      filters: { ...state.filters, ...filters },
      page: 1,
    }));
    get().fetchLogs();
  },

  clearFilters: () => {
    set({ filters: {}, page: 1 });
    get().fetchLogs();
  },

  clearSelectedLog: () => {
    set({ selectedLog: null });
  },

  clearError: () => {
    set({ error: null });
  },

  // ============================================================================
  // RETENTION POLICY ACTIONS
  // ============================================================================

  fetchRetentionPolicies: async () => {
    set({ isLoadingRetention: true, error: null });
    try {
      const response = await complianceApi.getRetentionPolicies();
      set({ retentionPolicies: response.policies, isLoadingRetention: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch retention policies',
        isLoadingRetention: false,
      });
    }
  },

  fetchRetentionStats: async () => {
    set({ isLoadingRetention: true, error: null });
    try {
      const stats = await complianceApi.getRetentionStats();
      set({ retentionStats: stats, isLoadingRetention: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch retention stats',
        isLoadingRetention: false,
      });
    }
  },

  setRetentionPolicy: async (eventType: string, retentionDays: number, description?: string) => {
    set({ isLoadingRetention: true, error: null });
    try {
      const policy = await complianceApi.setRetentionPolicy(eventType, { retentionDays, description });
      set((state) => ({
        retentionPolicies: state.retentionPolicies.some((p) => p.eventType === eventType)
          ? state.retentionPolicies.map((p) => (p.eventType === eventType ? policy : p))
          : [...state.retentionPolicies, policy],
        isLoadingRetention: false,
      }));
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to set retention policy',
        isLoadingRetention: false,
      });
    }
  },

  triggerCleanup: async () => {
    set({ isCleaningUp: true, error: null });
    try {
      const result = await complianceApi.triggerCleanup();
      set({ isCleaningUp: false });
      // Refresh stats after cleanup
      get().fetchRetentionStats();
      return result;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to trigger cleanup',
        isCleaningUp: false,
      });
      throw error;
    }
  },

  // ============================================================================
  // LEGAL HOLD ACTIONS
  // ============================================================================

  fetchLegalHolds: async (activeOnly = false) => {
    set({ isLoadingLegalHolds: true, error: null });
    try {
      const response = await complianceApi.getLegalHolds(activeOnly);
      set({ legalHolds: response.holds, isLoadingLegalHolds: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch legal holds',
        isLoadingLegalHolds: false,
      });
    }
  },

  createLegalHold: async (input) => {
    set({ isLoadingLegalHolds: true, error: null });
    try {
      const hold = await complianceApi.createLegalHold(input);
      set((state) => ({
        legalHolds: [...state.legalHolds, hold],
        isLoadingLegalHolds: false,
      }));
      return hold;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to create legal hold',
        isLoadingLegalHolds: false,
      });
      throw error;
    }
  },

  releaseLegalHold: async (holdId: string) => {
    set({ isLoadingLegalHolds: true, error: null });
    try {
      const response = await complianceApi.releaseLegalHold(holdId);
      set((state) => ({
        legalHolds: state.legalHolds.map((h) =>
          h.id === holdId ? response.hold : h
        ),
        isLoadingLegalHolds: false,
      }));
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to release legal hold',
        isLoadingLegalHolds: false,
      });
      throw error;
    }
  },

  addLogsToHold: async (holdId: string, logIds: string[]) => {
    set({ isLoadingLegalHolds: true, error: null });
    try {
      const hold = await complianceApi.addLogsToHold(holdId, logIds);
      set((state) => ({
        legalHolds: state.legalHolds.map((h) => (h.id === holdId ? hold : h)),
        isLoadingLegalHolds: false,
      }));
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to add logs to hold',
        isLoadingLegalHolds: false,
      });
      throw error;
    }
  },

  // ============================================================================
  // ROPA ACTIONS
  // ============================================================================

  fetchRopaEntries: async () => {
    set({ isLoadingRopa: true, error: null });
    try {
      const response = await complianceApi.getRopaEntries();
      set({ ropaEntries: response.entries, isLoadingRopa: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch RoPA entries',
        isLoadingRopa: false,
      });
    }
  },

  fetchRopaEntry: async (id: string) => {
    set({ isLoadingRopa: true, error: null });
    try {
      const entry = await complianceApi.getRopaEntry(id);
      set({ selectedRopaEntry: entry, isLoadingRopa: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch RoPA entry',
        isLoadingRopa: false,
      });
    }
  },

  createRopaEntry: async (input) => {
    set({ isLoadingRopa: true, error: null });
    try {
      const entry = await complianceApi.createRopaEntry(input);
      set((state) => ({
        ropaEntries: [...state.ropaEntries, entry],
        isLoadingRopa: false,
      }));
      return entry;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to create RoPA entry',
        isLoadingRopa: false,
      });
      throw error;
    }
  },

  updateRopaEntry: async (id: string, input) => {
    set({ isLoadingRopa: true, error: null });
    try {
      const entry = await complianceApi.updateRopaEntry(id, input);
      set((state) => ({
        ropaEntries: state.ropaEntries.map((e) => (e.id === id ? entry : e)),
        selectedRopaEntry: state.selectedRopaEntry?.id === id ? entry : state.selectedRopaEntry,
        isLoadingRopa: false,
      }));
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to update RoPA entry',
        isLoadingRopa: false,
      });
      throw error;
    }
  },

  deleteRopaEntry: async (id: string) => {
    set({ isLoadingRopa: true, error: null });
    try {
      await complianceApi.deleteRopaEntry(id);
      set((state) => ({
        ropaEntries: state.ropaEntries.filter((e) => e.id !== id),
        selectedRopaEntry: state.selectedRopaEntry?.id === id ? null : state.selectedRopaEntry,
        isLoadingRopa: false,
      }));
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to delete RoPA entry',
        isLoadingRopa: false,
      });
      throw error;
    }
  },

  generateRopaReport: async (organizationName?: string) => {
    set({ isLoadingRopa: true, error: null });
    try {
      const report = await complianceApi.generateRopaReport(organizationName);
      set({ ropaReport: report, isLoadingRopa: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to generate RoPA report',
        isLoadingRopa: false,
      });
    }
  },

  clearSelectedRopaEntry: () => {
    set({ selectedRopaEntry: null });
  },

  // ============================================================================
  // EXPORT ACTIONS
  // ============================================================================

  exportLogs: async (options) => {
    set({ isExporting: true, error: null });
    try {
      const result = await complianceApi.exportLogs(options);
      set({ lastExportResult: result, isExporting: false });
      return result;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to export logs',
        isExporting: false,
      });
      throw error;
    }
  },

  clearExportResult: () => {
    set({ lastExportResult: null });
  },

  // ============================================================================
  // PROVIDER DOCUMENTATION ACTIONS
  // ============================================================================

  fetchProviders: async () => {
    set({ isLoadingProviders: true, error: null });
    try {
      const response = await complianceApi.getProviders();
      set({ providers: response.providers, isLoadingProviders: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch providers',
        isLoadingProviders: false,
      });
    }
  },

  fetchProviderDocs: async (providerName: string) => {
    set({ isLoadingProviders: true, error: null });
    try {
      const response = await complianceApi.getProviderDocs(providerName);
      set({ providerDocs: response.documentation, isLoadingProviders: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch provider docs',
        isLoadingProviders: false,
      });
    }
  },

  fetchAllDocumentation: async () => {
    set({ isLoadingProviders: true, error: null });
    try {
      const response = await complianceApi.getAllDocumentation();
      set({ providerDocs: response.documentation, isLoadingProviders: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch documentation',
        isLoadingProviders: false,
      });
    }
  },
}));
