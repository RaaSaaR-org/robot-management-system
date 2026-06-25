/**
 * @file twinZoneApi.ts
 * @description API client for L2 twin zones — `/api/digital-twins/:id/zones`.
 *   Clone of the fleet `zoneApi` shape, but scoped to a twin and using polygon
 *   points in world meters. Thin wrapper over the zone methods in `twinApi`.
 * @feature digitaltwin
 * @dependencies @/features/digitaltwin/api/twinApi
 */

import { twinApi } from './twinApi';
import type {
  TwinZoneDTO,
  CreateTwinZoneRequest,
  UpdateTwinZoneRequest,
} from '../types/twin.types';

export const twinZoneApi = {
  /** List all zones authored on a twin. */
  async getZones(twinId: string): Promise<TwinZoneDTO[]> {
    return twinApi.listZones(twinId);
  },

  /** Create a polygon zone on a twin. */
  async createZone(twinId: string, request: CreateTwinZoneRequest): Promise<TwinZoneDTO> {
    return twinApi.createZone(twinId, request);
  },

  /** Update a zone (partial). */
  async updateZone(twinId: string, zoneId: string, request: UpdateTwinZoneRequest): Promise<TwinZoneDTO> {
    return twinApi.updateZone(twinId, zoneId, request);
  },

  /** Delete a zone. */
  async deleteZone(twinId: string, zoneId: string): Promise<void> {
    return twinApi.deleteZone(twinId, zoneId);
  },
};
