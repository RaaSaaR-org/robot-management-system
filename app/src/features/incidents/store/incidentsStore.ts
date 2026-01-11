/**
 * @file incidentsStore.ts
 * @description Zustand store for incident management with API integration
 * @feature incidents
 * @dependencies zustand, immer, @/features/incidents/types, @/features/incidents/api
 * @stateAccess useIncidentsStore (read/write)
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import type {
  Incident,
  IncidentFilters,
  IncidentPagination,
  IncidentsState,
  IncidentsStore,
  CreateIncidentRequest,
  UpdateIncidentRequest,
  DashboardStats,
  NotificationTemplate,
} from '../types/incidents.types';
import { SEVERITY_PRIORITY } from '../types/incidents.types';
import { incidentsApi } from '../api/incidentsApi';

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Sort incidents by severity (highest first) then by detected date (newest first).
 */
function sortIncidents(incidents: Incident[]): Incident[] {
  return [...incidents].sort((a, b) => {
    const priorityDiff = SEVERITY_PRIORITY[a.severity] - SEVERITY_PRIORITY[b.severity];
    if (priorityDiff !== 0) return priorityDiff;
    return new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime();
  });
}

// ============================================================================
// INITIAL STATE
// ============================================================================

const initialState: IncidentsState = {
  incidents: [],
  isLoading: false,
  error: null,
  pagination: {
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  },
  filters: {},

  selectedIncident: null,
  isLoadingDetails: false,

  dashboardStats: null,
  isLoadingDashboard: false,

  templates: [],
  isLoadingTemplates: false,
};

// ============================================================================
// STORE
// ============================================================================

export const useIncidentsStore = create<IncidentsStore>()(
  devtools(
    immer((set, get) => ({
      ...initialState,

      // --------------------------------------------------------------------
      // LIST ACTIONS
      // --------------------------------------------------------------------

      fetchIncidents: async (page?: number): Promise<void> => {
        const { filters, pagination } = get();
        const targetPage = page ?? pagination.page;

        set((state) => {
          state.isLoading = true;
          state.error = null;
        });

        try {
          const result = await incidentsApi.getIncidents(
            {
              type: filters.type,
              severity: filters.severity,
              status: filters.status,
              robotId: filters.robotId,
              startDate: filters.startDate,
              endDate: filters.endDate,
            },
            {
              page: targetPage,
              limit: pagination.limit,
              sortBy: 'detectedAt',
              sortOrder: 'desc',
            }
          );

          set((state) => {
            state.incidents = result.incidents;
            state.pagination = {
              page: result.page,
              limit: result.limit,
              total: result.total,
              totalPages: result.totalPages,
            };
            state.isLoading = false;
          });
        } catch (error) {
          set((state) => {
            state.isLoading = false;
            state.error = error instanceof Error ? error.message : 'Failed to fetch incidents';
          });
        }
      },

      setFilters: (filters: IncidentFilters): void => {
        set((state) => {
          state.filters = filters;
          state.pagination.page = 1; // Reset to first page on filter change
        });
        // Fetch with new filters
        get().fetchIncidents(1);
      },

      // --------------------------------------------------------------------
      // DETAIL ACTIONS
      // --------------------------------------------------------------------

      fetchIncident: async (id: string): Promise<void> => {
        set((state) => {
          state.isLoadingDetails = true;
          state.selectedIncident = null;
        });

        try {
          const incident = await incidentsApi.getIncident(id);
          set((state) => {
            state.selectedIncident = incident;
            state.isLoadingDetails = false;
          });
        } catch (error) {
          console.error('Failed to fetch incident:', error);
          set((state) => {
            state.isLoadingDetails = false;
          });
        }
      },

      createIncident: async (input: CreateIncidentRequest): Promise<Incident> => {
        const incident = await incidentsApi.createIncident(input);

        set((state) => {
          state.incidents = sortIncidents([incident, ...state.incidents]);
          state.pagination.total += 1;
        });

        return incident;
      },

      updateIncident: async (id: string, input: UpdateIncidentRequest): Promise<Incident | null> => {
        try {
          const updated = await incidentsApi.updateIncident(id, input);

          set((state) => {
            // Update in list
            const index = state.incidents.findIndex((i) => i.id === id);
            if (index !== -1) {
              state.incidents[index] = updated;
              state.incidents = sortIncidents(state.incidents);
            }

            // Update selected incident if it matches
            if (state.selectedIncident?.id === id) {
              state.selectedIncident = updated;
            }
          });

          return updated;
        } catch (error) {
          console.error('Failed to update incident:', error);
          return null;
        }
      },

      deleteIncident: async (id: string): Promise<boolean> => {
        try {
          await incidentsApi.deleteIncident(id);

          set((state) => {
            state.incidents = state.incidents.filter((i) => i.id !== id);
            state.pagination.total -= 1;

            if (state.selectedIncident?.id === id) {
              state.selectedIncident = null;
            }
          });

          return true;
        } catch (error) {
          console.error('Failed to delete incident:', error);
          return false;
        }
      },

      // --------------------------------------------------------------------
      // DASHBOARD ACTIONS
      // --------------------------------------------------------------------

      fetchDashboardStats: async (): Promise<void> => {
        set((state) => {
          state.isLoadingDashboard = true;
        });

        try {
          const stats = await incidentsApi.getDashboardStats();
          set((state) => {
            state.dashboardStats = stats;
            state.isLoadingDashboard = false;
          });
        } catch (error) {
          console.error('Failed to fetch dashboard stats:', error);
          set((state) => {
            state.isLoadingDashboard = false;
          });
        }
      },

      // --------------------------------------------------------------------
      // NOTIFICATION ACTIONS
      // --------------------------------------------------------------------

      markNotificationSent: async (incidentId: string, notificationId: string): Promise<void> => {
        try {
          await incidentsApi.markNotificationSent(incidentId, notificationId);

          // Refresh the selected incident to get updated notifications
          if (get().selectedIncident?.id === incidentId) {
            await get().fetchIncident(incidentId);
          }
        } catch (error) {
          console.error('Failed to mark notification as sent:', error);
        }
      },

      generateNotificationContent: async (
        incidentId: string,
        notificationId: string,
        templateId?: string
      ): Promise<string | null> => {
        try {
          const content = await incidentsApi.generateNotificationContent(
            incidentId,
            notificationId,
            templateId
          );
          return content;
        } catch (error) {
          console.error('Failed to generate notification content:', error);
          return null;
        }
      },

      // --------------------------------------------------------------------
      // TEMPLATE ACTIONS
      // --------------------------------------------------------------------

      fetchTemplates: async (): Promise<void> => {
        set((state) => {
          state.isLoadingTemplates = true;
        });

        try {
          const templates = await incidentsApi.getTemplates();
          set((state) => {
            state.templates = templates;
            state.isLoadingTemplates = false;
          });
        } catch (error) {
          console.error('Failed to fetch templates:', error);
          set((state) => {
            state.isLoadingTemplates = false;
          });
        }
      },

      // --------------------------------------------------------------------
      // WEBSOCKET ACTIONS
      // --------------------------------------------------------------------

      addIncidentFromWebSocket: (incident: Incident): void => {
        set((state) => {
          // Check if incident already exists
          const exists = state.incidents.some((i) => i.id === incident.id);
          if (!exists) {
            state.incidents = sortIncidents([incident, ...state.incidents]);
            state.pagination.total += 1;
          }
        });
      },

      updateIncidentFromWebSocket: (incident: Incident): void => {
        set((state) => {
          const index = state.incidents.findIndex((i) => i.id === incident.id);
          if (index !== -1) {
            state.incidents[index] = incident;
            state.incidents = sortIncidents(state.incidents);
          }

          // Update selected incident if it matches
          if (state.selectedIncident?.id === incident.id) {
            state.selectedIncident = incident;
          }
        });
      },

      // --------------------------------------------------------------------
      // RESET
      // --------------------------------------------------------------------

      reset: (): void => {
        set(initialState);
      },
    })),
    { name: 'incidents-store' }
  )
);

// ============================================================================
// SELECTORS
// ============================================================================

/**
 * Select all incidents.
 */
export const selectIncidents = (state: IncidentsStore): Incident[] => state.incidents;

/**
 * Select loading state.
 */
export const selectIsLoading = (state: IncidentsStore): boolean => state.isLoading;

/**
 * Select error state.
 */
export const selectError = (state: IncidentsStore): string | null => state.error;

/**
 * Select pagination.
 */
export const selectPagination = (state: IncidentsStore): IncidentPagination => state.pagination;

/**
 * Select filters.
 */
export const selectFilters = (state: IncidentsStore): IncidentFilters => state.filters;

/**
 * Select selected incident.
 */
export const selectSelectedIncident = (state: IncidentsStore): Incident | null =>
  state.selectedIncident;

/**
 * Select details loading state.
 */
export const selectIsLoadingDetails = (state: IncidentsStore): boolean => state.isLoadingDetails;

/**
 * Select dashboard stats.
 */
export const selectDashboardStats = (state: IncidentsStore): DashboardStats | null =>
  state.dashboardStats;

/**
 * Select dashboard loading state.
 */
export const selectIsLoadingDashboard = (state: IncidentsStore): boolean => state.isLoadingDashboard;

/**
 * Select templates.
 */
export const selectTemplates = (state: IncidentsStore): NotificationTemplate[] => state.templates;

/**
 * Select templates loading state.
 */
export const selectIsLoadingTemplates = (state: IncidentsStore): boolean => state.isLoadingTemplates;

/**
 * Select open incidents (not closed).
 */
export const selectOpenIncidents = (state: IncidentsStore): Incident[] =>
  state.incidents.filter((i) => i.status !== 'closed');

/**
 * Select critical incidents.
 */
export const selectCriticalIncidents = (state: IncidentsStore): Incident[] =>
  state.incidents.filter((i) => i.severity === 'critical');

/**
 * Select open critical incidents.
 */
export const selectOpenCriticalIncidents = (state: IncidentsStore): Incident[] =>
  state.incidents.filter((i) => i.severity === 'critical' && i.status !== 'closed');

/**
 * Select incident by ID.
 */
export const selectIncidentById =
  (id: string) =>
  (state: IncidentsStore): Incident | undefined =>
    state.incidents.find((i) => i.id === id);

/**
 * Select count of open incidents.
 */
export const selectOpenIncidentCount = (state: IncidentsStore): number =>
  state.incidents.filter((i) => i.status !== 'closed').length;

/**
 * Select incidents with overdue notifications.
 */
export const selectIncidentsWithOverdueNotifications = (state: IncidentsStore): Incident[] =>
  state.incidents.filter(
    (i) => i.notifications?.some((n) => n.isOverdue) ?? false
  );
