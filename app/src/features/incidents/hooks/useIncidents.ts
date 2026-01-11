/**
 * @file useIncidents.ts
 * @description React hooks for incident state and operations
 * @feature incidents
 * @dependencies @/features/incidents/store, @/features/incidents/types
 * @stateAccess useIncidentsStore (read/write)
 */

import { useCallback, useMemo, useEffect } from 'react';
import {
  useIncidentsStore,
  selectIncidents,
  selectIsLoading,
  selectError,
  selectPagination,
  selectFilters,
  selectSelectedIncident,
  selectIsLoadingDetails,
  selectDashboardStats,
  selectIsLoadingDashboard,
  selectTemplates,
  selectIsLoadingTemplates,
} from '../store/incidentsStore';
import type {
  Incident,
  IncidentFilters,
  IncidentPagination,
  CreateIncidentRequest,
  UpdateIncidentRequest,
  DashboardStats,
  NotificationTemplate,
  IncidentSeverity,
  IncidentStatus,
  IncidentType,
} from '../types/incidents.types';

// ============================================================================
// TYPES
// ============================================================================

export interface UseIncidentsReturn {
  /** All incidents */
  incidents: Incident[];
  /** Loading state */
  isLoading: boolean;
  /** Error message if fetch failed */
  error: string | null;
  /** Pagination info */
  pagination: IncidentPagination;
  /** Current filters */
  filters: IncidentFilters;
  /** Open incidents (not closed) */
  openIncidents: Incident[];
  /** Critical incidents */
  criticalIncidents: Incident[];
  /** Count of open incidents */
  openCount: number;
  /** Fetch incidents (optionally with page) */
  fetchIncidents: (page?: number) => Promise<void>;
  /** Set filters (triggers refetch) */
  setFilters: (filters: IncidentFilters) => void;
  /** Go to next page */
  nextPage: () => void;
  /** Go to previous page */
  prevPage: () => void;
  /** Go to specific page */
  goToPage: (page: number) => void;
  /** Create a new incident */
  createIncident: (input: CreateIncidentRequest) => Promise<Incident>;
  /** Update an incident */
  updateIncident: (id: string, input: UpdateIncidentRequest) => Promise<Incident | null>;
  /** Delete an incident */
  deleteIncident: (id: string) => Promise<boolean>;
}

export interface UseIncidentReturn {
  /** The selected incident */
  incident: Incident | null;
  /** Loading state */
  isLoading: boolean;
  /** Fetch incident by ID */
  fetchIncident: (id: string) => Promise<void>;
  /** Update this incident */
  update: (input: UpdateIncidentRequest) => Promise<Incident | null>;
  /** Delete this incident */
  remove: () => Promise<boolean>;
  /** Mark a notification as sent */
  markNotificationSent: (notificationId: string) => Promise<void>;
  /** Generate notification content */
  generateNotificationContent: (notificationId: string, templateId?: string) => Promise<string | null>;
}

export interface UseIncidentDashboardReturn {
  /** Dashboard statistics */
  stats: DashboardStats | null;
  /** Loading state */
  isLoading: boolean;
  /** Fetch dashboard stats */
  fetchStats: () => Promise<void>;
}

export interface UseNotificationTemplatesReturn {
  /** Available templates */
  templates: NotificationTemplate[];
  /** Loading state */
  isLoading: boolean;
  /** Fetch templates */
  fetchTemplates: () => Promise<void>;
}

// ============================================================================
// MAIN HOOK
// ============================================================================

/**
 * Hook for accessing incident list state and operations.
 *
 * @example
 * ```tsx
 * function IncidentList() {
 *   const { incidents, openCount, pagination, nextPage, prevPage } = useIncidents();
 *
 *   return (
 *     <div>
 *       <span>Open Incidents: {openCount}</span>
 *       {incidents.map(incident => <IncidentCard key={incident.id} incident={incident} />)}
 *       <button onClick={prevPage}>Prev</button>
 *       <button onClick={nextPage}>Next</button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useIncidents(autoFetch = true): UseIncidentsReturn {
  const incidents = useIncidentsStore(selectIncidents);
  const isLoading = useIncidentsStore(selectIsLoading);
  const error = useIncidentsStore(selectError);
  const pagination = useIncidentsStore(selectPagination);
  const filters = useIncidentsStore(selectFilters);

  const storeFetchIncidents = useIncidentsStore((state) => state.fetchIncidents);
  const storeSetFilters = useIncidentsStore((state) => state.setFilters);
  const storeCreateIncident = useIncidentsStore((state) => state.createIncident);
  const storeUpdateIncident = useIncidentsStore((state) => state.updateIncident);
  const storeDeleteIncident = useIncidentsStore((state) => state.deleteIncident);

  // Auto-fetch on mount if enabled
  useEffect(() => {
    if (autoFetch && incidents.length === 0 && !isLoading) {
      storeFetchIncidents(1);
    }
  }, [autoFetch, incidents.length, isLoading, storeFetchIncidents]);

  // Derived values
  const openIncidents = useMemo(
    () => incidents.filter((i) => i.status !== 'closed'),
    [incidents]
  );

  const criticalIncidents = useMemo(
    () => incidents.filter((i) => i.severity === 'critical'),
    [incidents]
  );

  const openCount = useMemo(
    () => openIncidents.length,
    [openIncidents]
  );

  const fetchIncidents = useCallback(
    async (page?: number): Promise<void> => {
      await storeFetchIncidents(page);
    },
    [storeFetchIncidents]
  );

  const setFilters = useCallback(
    (newFilters: IncidentFilters): void => {
      storeSetFilters(newFilters);
    },
    [storeSetFilters]
  );

  const nextPage = useCallback((): void => {
    if (pagination.page < pagination.totalPages) {
      storeFetchIncidents(pagination.page + 1);
    }
  }, [pagination.page, pagination.totalPages, storeFetchIncidents]);

  const prevPage = useCallback((): void => {
    if (pagination.page > 1) {
      storeFetchIncidents(pagination.page - 1);
    }
  }, [pagination.page, storeFetchIncidents]);

  const goToPage = useCallback(
    (page: number): void => {
      if (page >= 1 && page <= pagination.totalPages) {
        storeFetchIncidents(page);
      }
    },
    [pagination.totalPages, storeFetchIncidents]
  );

  const createIncident = useCallback(
    async (input: CreateIncidentRequest): Promise<Incident> => {
      return storeCreateIncident(input);
    },
    [storeCreateIncident]
  );

  const updateIncident = useCallback(
    async (id: string, input: UpdateIncidentRequest): Promise<Incident | null> => {
      return storeUpdateIncident(id, input);
    },
    [storeUpdateIncident]
  );

  const deleteIncident = useCallback(
    async (id: string): Promise<boolean> => {
      return storeDeleteIncident(id);
    },
    [storeDeleteIncident]
  );

  return useMemo(
    () => ({
      incidents,
      isLoading,
      error,
      pagination,
      filters,
      openIncidents,
      criticalIncidents,
      openCount,
      fetchIncidents,
      setFilters,
      nextPage,
      prevPage,
      goToPage,
      createIncident,
      updateIncident,
      deleteIncident,
    }),
    [
      incidents,
      isLoading,
      error,
      pagination,
      filters,
      openIncidents,
      criticalIncidents,
      openCount,
      fetchIncidents,
      setFilters,
      nextPage,
      prevPage,
      goToPage,
      createIncident,
      updateIncident,
      deleteIncident,
    ]
  );
}

// ============================================================================
// SINGLE INCIDENT HOOK
// ============================================================================

/**
 * Hook for accessing a single incident with details.
 *
 * @example
 * ```tsx
 * function IncidentDetail({ id }: { id: string }) {
 *   const { incident, isLoading, update, markNotificationSent } = useIncident(id);
 *
 *   useEffect(() => {
 *     fetchIncident(id);
 *   }, [id]);
 *
 *   if (isLoading) return <Loading />;
 *   if (!incident) return <NotFound />;
 *
 *   return <IncidentDetails incident={incident} />;
 * }
 * ```
 */
export function useIncident(id?: string): UseIncidentReturn {
  const incident = useIncidentsStore(selectSelectedIncident);
  const isLoading = useIncidentsStore(selectIsLoadingDetails);

  const storeFetchIncident = useIncidentsStore((state) => state.fetchIncident);
  const storeUpdateIncident = useIncidentsStore((state) => state.updateIncident);
  const storeDeleteIncident = useIncidentsStore((state) => state.deleteIncident);
  const storeMarkNotificationSent = useIncidentsStore((state) => state.markNotificationSent);
  const storeGenerateContent = useIncidentsStore((state) => state.generateNotificationContent);

  // Auto-fetch if ID is provided
  useEffect(() => {
    if (id && (!incident || incident.id !== id)) {
      storeFetchIncident(id);
    }
  }, [id, incident, storeFetchIncident]);

  const fetchIncident = useCallback(
    async (incidentId: string): Promise<void> => {
      await storeFetchIncident(incidentId);
    },
    [storeFetchIncident]
  );

  const update = useCallback(
    async (input: UpdateIncidentRequest): Promise<Incident | null> => {
      if (!incident) return null;
      return storeUpdateIncident(incident.id, input);
    },
    [incident, storeUpdateIncident]
  );

  const remove = useCallback(async (): Promise<boolean> => {
    if (!incident) return false;
    return storeDeleteIncident(incident.id);
  }, [incident, storeDeleteIncident]);

  const markNotificationSent = useCallback(
    async (notificationId: string): Promise<void> => {
      if (!incident) return;
      await storeMarkNotificationSent(incident.id, notificationId);
    },
    [incident, storeMarkNotificationSent]
  );

  const generateNotificationContent = useCallback(
    async (notificationId: string, templateId?: string): Promise<string | null> => {
      if (!incident) return null;
      return storeGenerateContent(incident.id, notificationId, templateId);
    },
    [incident, storeGenerateContent]
  );

  return useMemo(
    () => ({
      incident,
      isLoading,
      fetchIncident,
      update,
      remove,
      markNotificationSent,
      generateNotificationContent,
    }),
    [incident, isLoading, fetchIncident, update, remove, markNotificationSent, generateNotificationContent]
  );
}

// ============================================================================
// DASHBOARD HOOK
// ============================================================================

/**
 * Hook for accessing incident dashboard statistics.
 *
 * @example
 * ```tsx
 * function IncidentDashboard() {
 *   const { stats, isLoading } = useIncidentDashboard();
 *
 *   if (isLoading) return <Loading />;
 *
 *   return (
 *     <div>
 *       <StatCard title="Open Incidents" value={stats?.openIncidents} />
 *       <StatCard title="Overdue Notifications" value={stats?.overdueNotifications} />
 *     </div>
 *   );
 * }
 * ```
 */
export function useIncidentDashboard(autoFetch = true): UseIncidentDashboardReturn {
  const stats = useIncidentsStore(selectDashboardStats);
  const isLoading = useIncidentsStore(selectIsLoadingDashboard);
  const storeFetchStats = useIncidentsStore((state) => state.fetchDashboardStats);

  // Auto-fetch on mount if enabled
  useEffect(() => {
    if (autoFetch && !stats && !isLoading) {
      storeFetchStats();
    }
  }, [autoFetch, stats, isLoading, storeFetchStats]);

  const fetchStats = useCallback(async (): Promise<void> => {
    await storeFetchStats();
  }, [storeFetchStats]);

  return useMemo(
    () => ({
      stats,
      isLoading,
      fetchStats,
    }),
    [stats, isLoading, fetchStats]
  );
}

// ============================================================================
// TEMPLATES HOOK
// ============================================================================

/**
 * Hook for accessing notification templates.
 *
 * @example
 * ```tsx
 * function TemplateSelector() {
 *   const { templates, isLoading } = useNotificationTemplates();
 *
 *   return (
 *     <select>
 *       {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
 *     </select>
 *   );
 * }
 * ```
 */
export function useNotificationTemplates(autoFetch = true): UseNotificationTemplatesReturn {
  const templates = useIncidentsStore(selectTemplates);
  const isLoading = useIncidentsStore(selectIsLoadingTemplates);
  const storeFetchTemplates = useIncidentsStore((state) => state.fetchTemplates);

  // Auto-fetch on mount if enabled
  useEffect(() => {
    if (autoFetch && templates.length === 0 && !isLoading) {
      storeFetchTemplates();
    }
  }, [autoFetch, templates.length, isLoading, storeFetchTemplates]);

  const fetchTemplates = useCallback(async (): Promise<void> => {
    await storeFetchTemplates();
  }, [storeFetchTemplates]);

  return useMemo(
    () => ({
      templates,
      isLoading,
      fetchTemplates,
    }),
    [templates, isLoading, fetchTemplates]
  );
}

// ============================================================================
// FILTERED HOOKS
// ============================================================================

/**
 * Hook to get incidents filtered by severity.
 */
export function useIncidentsBySeverity(severity: IncidentSeverity): Incident[] {
  const incidents = useIncidentsStore(selectIncidents);
  return useMemo(
    () => incidents.filter((i) => i.severity === severity),
    [incidents, severity]
  );
}

/**
 * Hook to get incidents filtered by status.
 */
export function useIncidentsByStatus(status: IncidentStatus): Incident[] {
  const incidents = useIncidentsStore(selectIncidents);
  return useMemo(
    () => incidents.filter((i) => i.status === status),
    [incidents, status]
  );
}

/**
 * Hook to get incidents filtered by type.
 */
export function useIncidentsByType(type: IncidentType): Incident[] {
  const incidents = useIncidentsStore(selectIncidents);
  return useMemo(
    () => incidents.filter((i) => i.type === type),
    [incidents, type]
  );
}

/**
 * Hook to get incidents for a specific robot.
 */
export function useRobotIncidents(robotId: string): Incident[] {
  const incidents = useIncidentsStore(selectIncidents);
  return useMemo(
    () => incidents.filter((i) => i.robotId === robotId),
    [incidents, robotId]
  );
}
