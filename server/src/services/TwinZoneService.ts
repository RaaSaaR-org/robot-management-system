/**
 * @file TwinZoneService.ts
 * @description CRUD + events for TwinZone (L2 semantic zones — typed polygons in
 *              the twin world frame). Singleton EventEmitter; emits
 *              twinZone:created|updated|deleted for websocket broadcast.
 * @feature digitaltwin
 */

import { EventEmitter } from 'events';
import { twinZoneRepository, digitalTwinRepository } from '../repositories/index.js';
import { twinZoneToDTO } from './twinDto.js';
import type {
  TwinZoneDTO,
  CreateTwinZoneInput,
  UpdateTwinZoneInput,
  TwinZoneEvent,
  TwinZoneEventCallback,
} from '../types/twin.types.js';

export class TwinZoneService extends EventEmitter {
  private static instance: TwinZoneService;

  private constructor() {
    super();
  }

  static getInstance(): TwinZoneService {
    if (!TwinZoneService.instance) {
      TwinZoneService.instance = new TwinZoneService();
    }
    return TwinZoneService.instance;
  }

  /** True when the parent twin exists (routes use this for 404s). */
  async twinExists(twinId: string): Promise<boolean> {
    return (await digitalTwinRepository.findById(twinId)) !== null;
  }

  async listZones(twinId: string): Promise<TwinZoneDTO[]> {
    const zones = await twinZoneRepository.listByTwin(twinId);
    return zones.map(twinZoneToDTO);
  }

  async createZone(input: CreateTwinZoneInput): Promise<TwinZoneDTO> {
    const zone = await twinZoneRepository.create(input);
    const dto = twinZoneToDTO(zone);
    this.emitEvent({
      type: 'twinZone:created',
      twinId: zone.twinId,
      zone: dto,
      timestamp: new Date().toISOString(),
    });
    return dto;
  }

  async updateZone(
    twinId: string,
    zoneId: string,
    input: UpdateTwinZoneInput,
  ): Promise<TwinZoneDTO | null> {
    const existing = await twinZoneRepository.findById(zoneId);
    if (!existing || existing.twinId !== twinId) return null;

    const zone = await twinZoneRepository.update(zoneId, input);
    if (!zone) return null;

    const dto = twinZoneToDTO(zone);
    this.emitEvent({
      type: 'twinZone:updated',
      twinId,
      zone: dto,
      timestamp: new Date().toISOString(),
    });
    return dto;
  }

  async deleteZone(twinId: string, zoneId: string): Promise<boolean> {
    const existing = await twinZoneRepository.findById(zoneId);
    if (!existing || existing.twinId !== twinId) return false;

    const ok = await twinZoneRepository.delete(zoneId);
    if (!ok) return false;

    this.emitEvent({
      type: 'twinZone:deleted',
      twinId,
      zoneId,
      timestamp: new Date().toISOString(),
    });
    return true;
  }

  // ==========================================================================
  // EVENTS
  // ==========================================================================

  onTwinZoneEvent(handler: TwinZoneEventCallback): () => void {
    this.on('twin-zone:event', handler);
    return () => this.off('twin-zone:event', handler);
  }

  private emitEvent(event: TwinZoneEvent): void {
    this.emit('twin-zone:event', event);
  }
}

export const twinZoneService = TwinZoneService.getInstance();
