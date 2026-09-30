/**
 * @file TwinZoneService.ts
 * @description CRUD + events for TwinZone (L2 semantic zones — typed polygons in
 *              the twin world frame). Singleton EventEmitter; emits
 *              twinZone:created|updated|deleted for websocket broadcast.
 *              Every zone is a named place (TASK-326): its name is a valid
 *              robot place id and unique per twin, case-insensitively.
 * @feature digitaltwin
 */

import { EventEmitter } from 'events';
import { twinZoneRepository, digitalTwinRepository } from '../repositories/index.js';
import { twinZoneToDTO } from './twinDto.js';
import { ROBOT_SAFE_PLACE_ID } from './TwinPlaceGraphService.js';
import { BadRequestError, ConflictError } from '../utils/errors.js';
import type {
  TwinZoneDTO,
  CreateTwinZoneInput,
  UpdateTwinZoneInput,
  TwinZoneEvent,
  TwinZoneEventCallback,
} from '../types/twin.types.js';

/** The grammar a zone name / placeId override must satisfy, for error text. */
const PLACE_ID_RULE =
  'letters, digits, ".", "_" or "-", starting with a letter or digit, at most 64 characters';

/**
 * Reject a name (or `metadata.placeId` override) the robot could not use as a
 * place id. Slugifying would silently rename the operator's place, so the
 * operator picks a valid one instead.
 */
function assertPlaceSafe(name: string | undefined, metadata: Record<string, unknown> | null | undefined): void {
  if (name !== undefined && !ROBOT_SAFE_PLACE_ID.test(name)) {
    throw new BadRequestError(`Zone name "${name}" is not a valid place id: use ${PLACE_ID_RULE}`);
  }
  const placeId = metadata?.placeId;
  if (typeof placeId === 'string' && placeId.length > 0 && !ROBOT_SAFE_PLACE_ID.test(placeId)) {
    throw new BadRequestError(`Place id "${placeId}" is not valid: use ${PLACE_ID_RULE}`);
  }
}

/** Translate the `(twinId, nameKey)` unique violation into a readable 409. */
function rethrowDuplicate(error: unknown, name: string | undefined): never {
  if (
    name !== undefined &&
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'P2002'
  ) {
    throw new ConflictError(`A zone named "${name}" already exists in this twin`);
  }
  throw error;
}

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
    assertPlaceSafe(input.name, input.metadata);
    let zone;
    try {
      zone = await twinZoneRepository.create(input);
    } catch (error) {
      rethrowDuplicate(error, input.name);
    }
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
    assertPlaceSafe(input.name, input.metadata);

    let zone;
    try {
      zone = await twinZoneRepository.update(zoneId, input);
    } catch (error) {
      rethrowDuplicate(error, input.name);
    }
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
