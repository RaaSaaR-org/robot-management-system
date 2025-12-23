/**
 * @file zoneApi.ts
 * @description API calls for zone management endpoints
 * @feature fleet
 * @dependencies @/api/client, @/features/fleet/types
 * @apiCalls GET /zones, GET /zones/:id, POST /zones, PUT /zones/:id, DELETE /zones/:id
 */

import { apiClient } from '@/api/client';
import type { Zone, ZoneType, CreateZoneRequest, UpdateZoneRequest } from '../types/fleet.types';

// ============================================================================
// TYPES
// ============================================================================

export interface ZoneQueryFilters {
  floor?: string;
  type?: ZoneType | ZoneType[];
}

export interface PaginationParams {
  page?: number;
  pageSize?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export interface ZonesResponse {
  zones: Zone[];
}

// ============================================================================
// ENDPOINTS
// ============================================================================

const ENDPOINTS = {
  list: '/zones',
  byId: (id: string) => `/zones/${id}`,
  byFloor: (floor: string) => `/zones/floor/${floor}`,
  atPoint: '/zones/at-point',
} as const;

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Build query string from filters and pagination params
 */
function buildQueryParams(
  filters?: ZoneQueryFilters,
  pagination?: PaginationParams
): Record<string, string> {
  const params: Record<string, string> = {};

  if (filters?.floor) {
    params.floor = filters.floor;
  }

  if (filters?.type) {
    params.type = Array.isArray(filters.type) ? filters.type.join(',') : filters.type;
  }

  if (pagination?.page) {
    params.page = String(pagination.page);
  }

  if (pagination?.pageSize) {
    params.pageSize = String(pagination.pageSize);
  }

  return params;
}

// ============================================================================
// API FUNCTIONS
// ============================================================================

export const zoneApi = {
  /**
   * Get all zones with optional filters and pagination.
   * @param filters - Optional filters for floor, type
   * @param pagination - Optional pagination params
   * @returns Paginated list of zones
   */
  async getZones(
    filters?: ZoneQueryFilters,
    pagination?: PaginationParams
  ): Promise<PaginatedResponse<Zone>> {
    const params = buildQueryParams(filters, pagination);
    const response = await apiClient.get<PaginatedResponse<Zone>>(ENDPOINTS.list, { params });
    return response.data;
  },

  /**
   * Get all zones on a specific floor.
   * @param floor - Floor identifier
   * @returns List of zones on that floor
   */
  async getZonesByFloor(floor: string): Promise<Zone[]> {
    const response = await apiClient.get<ZonesResponse>(ENDPOINTS.byFloor(floor));
    return response.data.zones;
  },

  /**
   * Get a single zone by ID.
   * @param id - Zone ID
   * @returns Zone details
   */
  async getZone(id: string): Promise<Zone> {
    const response = await apiClient.get<Zone>(ENDPOINTS.byId(id));
    return response.data;
  },

  /**
   * Find zone at a specific point.
   * @param x - X coordinate
   * @param y - Y coordinate
   * @param floor - Floor identifier
   * @returns Zone at that point, or null if none
   */
  async getZoneAtPoint(x: number, y: number, floor: string): Promise<Zone | null> {
    try {
      const response = await apiClient.get<Zone>(ENDPOINTS.atPoint, {
        params: { x: String(x), y: String(y), floor },
      });
      return response.data;
    } catch {
      // 404 means no zone at point
      return null;
    }
  },

  /**
   * Create a new zone.
   * @param request - Zone creation request
   * @returns Created zone
   */
  async createZone(request: CreateZoneRequest): Promise<Zone> {
    const response = await apiClient.post<Zone>(ENDPOINTS.list, request);
    return response.data;
  },

  /**
   * Update a zone.
   * @param id - Zone ID to update
   * @param request - Zone update request
   * @returns Updated zone
   */
  async updateZone(id: string, request: UpdateZoneRequest): Promise<Zone> {
    const response = await apiClient.put<Zone>(ENDPOINTS.byId(id), request);
    return response.data;
  },

  /**
   * Delete a zone.
   * @param id - Zone ID to delete
   */
  async deleteZone(id: string): Promise<void> {
    await apiClient.delete(ENDPOINTS.byId(id));
  },
};
