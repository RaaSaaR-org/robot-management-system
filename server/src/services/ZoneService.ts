/**
 * @file ZoneService.ts
 * @description Service for managing zones with validation and real-time broadcasting
 */

import {
  zoneRepository,
  type Zone,
  type ZoneType,
  type ZoneBounds,
  type CreateZoneInput,
  type UpdateZoneInput,
  type ZoneFilters,
  type PaginationParams,
  type PaginatedResult,
} from '../repositories/index.js';

// ============================================================================
// TYPES
// ============================================================================

/** Zone event types */
export type ZoneEventType = 'zone_created' | 'zone_updated' | 'zone_deleted';

/** Zone event payload */
export interface ZoneEvent {
  type: ZoneEventType;
  zone: Zone;
  timestamp: string;
}

type ZoneEventCallback = (event: ZoneEvent) => void;

/** Validation error */
export interface ValidationError {
  field: string;
  message: string;
}

// Re-export types for convenience
export type { Zone, ZoneType, ZoneBounds, CreateZoneInput, UpdateZoneInput, ZoneFilters };

// ============================================================================
// ZONE SERVICE
// ============================================================================

/**
 * ZoneService - manages zones with validation and event broadcasting
 */
export class ZoneService {
  private eventCallbacks: Set<ZoneEventCallback> = new Set();

  // ============================================================================
  // QUERY OPERATIONS
  // ============================================================================

  /**
   * Get a zone by ID
   */
  async getZone(id: string): Promise<Zone | null> {
    return zoneRepository.findById(id);
  }

  /**
   * Get all zones with optional filters and pagination
   */
  async getZones(
    filters?: ZoneFilters,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<Zone>> {
    return zoneRepository.findAll(filters, pagination);
  }

  /**
   * Get all zones on a specific floor
   */
  async getZonesByFloor(floor: string): Promise<Zone[]> {
    return zoneRepository.findByFloor(floor);
  }

  /**
   * Get all zones (unpaginated, for caching)
   */
  async getAllZones(): Promise<Zone[]> {
    return zoneRepository.findAllUnpaginated();
  }

  /**
   * Find the zone at a specific point
   */
  async getZoneAtPoint(x: number, y: number, floor: string): Promise<Zone | null> {
    return zoneRepository.findZoneAtPoint(x, y, floor);
  }

  /**
   * Check if a point is inside a specific zone
   */
  isPointInZone(x: number, y: number, zone: Zone): boolean {
    return zoneRepository.isPointInBounds(x, y, zone.bounds);
  }

  /**
   * Check if a point is in a restricted zone
   */
  async isPointInRestrictedZone(x: number, y: number, floor: string): Promise<boolean> {
    const zone = await this.getZoneAtPoint(x, y, floor);
    return zone?.type === 'restricted';
  }

  // ============================================================================
  // MUTATION OPERATIONS
  // ============================================================================

  /**
   * Create a new zone with validation
   */
  async createZone(input: CreateZoneInput): Promise<Zone> {
    // Validate input
    const errors = await this.validateCreateInput(input);
    if (errors.length > 0) {
      throw new ZoneValidationError('Validation failed', errors);
    }

    // Create zone
    const zone = await zoneRepository.create(input);

    // Emit event
    this.emitEvent({
      type: 'zone_created',
      zone,
      timestamp: new Date().toISOString(),
    });

    console.log(`[ZoneService] Zone created: ${zone.name} (${zone.type})`);
    return zone;
  }

  /**
   * Update a zone with validation
   */
  async updateZone(id: string, input: UpdateZoneInput): Promise<Zone | null> {
    // Validate input
    const errors = await this.validateUpdateInput(id, input);
    if (errors.length > 0) {
      throw new ZoneValidationError('Validation failed', errors);
    }

    // Update zone
    const zone = await zoneRepository.update(id, input);

    if (zone) {
      // Emit event
      this.emitEvent({
        type: 'zone_updated',
        zone,
        timestamp: new Date().toISOString(),
      });

      console.log(`[ZoneService] Zone updated: ${zone.name}`);
    }

    return zone;
  }

  /**
   * Delete a zone
   */
  async deleteZone(id: string): Promise<boolean> {
    const zone = await zoneRepository.findById(id);
    if (!zone) return false;

    const deleted = await zoneRepository.delete(id);

    if (deleted) {
      // Emit event
      this.emitEvent({
        type: 'zone_deleted',
        zone,
        timestamp: new Date().toISOString(),
      });

      console.log(`[ZoneService] Zone deleted: ${zone.name}`);
    }

    return deleted;
  }

  /**
   * Delete all zones on a floor
   */
  async deleteZonesByFloor(floor: string): Promise<number> {
    return zoneRepository.deleteByFloor(floor);
  }

  // ============================================================================
  // VALIDATION
  // ============================================================================

  /**
   * Validate create input
   */
  private async validateCreateInput(input: CreateZoneInput): Promise<ValidationError[]> {
    const errors: ValidationError[] = [];

    // Required fields
    if (!input.name || input.name.trim().length === 0) {
      errors.push({ field: 'name', message: 'Name is required' });
    }

    if (!input.floor || input.floor.trim().length === 0) {
      errors.push({ field: 'floor', message: 'Floor is required' });
    }

    if (!input.type) {
      errors.push({ field: 'type', message: 'Type is required' });
    } else if (!this.isValidZoneType(input.type)) {
      errors.push({
        field: 'type',
        message: 'Type must be one of: operational, restricted, charging, maintenance',
      });
    }

    // Validate bounds
    const boundsErrors = this.validateBounds(input.bounds);
    errors.push(...boundsErrors);

    // Check for duplicate name on same floor
    if (input.name && input.floor) {
      const existing = await zoneRepository.findByNameAndFloor(input.name, input.floor);
      if (existing) {
        errors.push({
          field: 'name',
          message: `Zone with name "${input.name}" already exists on floor ${input.floor}`,
        });
      }
    }

    // Check for overlapping zones (optional - can enable if desired)
    // const overlapping = await zoneRepository.findOverlappingZones(input.bounds, input.floor);
    // if (overlapping.length > 0) {
    //   errors.push({
    //     field: 'bounds',
    //     message: `Zone overlaps with: ${overlapping.map(z => z.name).join(', ')}`,
    //   });
    // }

    return errors;
  }

  /**
   * Validate update input
   */
  private async validateUpdateInput(
    id: string,
    input: UpdateZoneInput
  ): Promise<ValidationError[]> {
    const errors: ValidationError[] = [];

    // Check zone exists
    const existingZone = await zoneRepository.findById(id);
    if (!existingZone) {
      errors.push({ field: 'id', message: 'Zone not found' });
      return errors;
    }

    // Validate type if provided
    if (input.type !== undefined && !this.isValidZoneType(input.type)) {
      errors.push({
        field: 'type',
        message: 'Type must be one of: operational, restricted, charging, maintenance',
      });
    }

    // Validate bounds if provided
    if (input.bounds) {
      const boundsErrors = this.validateBounds(input.bounds);
      errors.push(...boundsErrors);
    }

    // Check for duplicate name on same floor if name or floor changed
    const newName = input.name ?? existingZone.name;
    const newFloor = input.floor ?? existingZone.floor;

    if (input.name !== undefined || input.floor !== undefined) {
      const existing = await zoneRepository.findByNameAndFloor(newName, newFloor);
      if (existing && existing.id !== id) {
        errors.push({
          field: 'name',
          message: `Zone with name "${newName}" already exists on floor ${newFloor}`,
        });
      }
    }

    return errors;
  }

  /**
   * Validate bounds object
   */
  private validateBounds(bounds: ZoneBounds): ValidationError[] {
    const errors: ValidationError[] = [];

    if (!bounds) {
      errors.push({ field: 'bounds', message: 'Bounds is required' });
      return errors;
    }

    if (typeof bounds.x !== 'number') {
      errors.push({ field: 'bounds.x', message: 'X coordinate must be a number' });
    }

    if (typeof bounds.y !== 'number') {
      errors.push({ field: 'bounds.y', message: 'Y coordinate must be a number' });
    }

    if (typeof bounds.width !== 'number' || bounds.width <= 0) {
      errors.push({ field: 'bounds.width', message: 'Width must be a positive number' });
    }

    if (typeof bounds.height !== 'number' || bounds.height <= 0) {
      errors.push({ field: 'bounds.height', message: 'Height must be a positive number' });
    }

    return errors;
  }

  /**
   * Check if zone type is valid
   */
  private isValidZoneType(type: string): type is ZoneType {
    return ['operational', 'restricted', 'charging', 'maintenance'].includes(type);
  }

  // ============================================================================
  // EVENTS
  // ============================================================================

  /**
   * Subscribe to zone events
   */
  onZoneEvent(callback: ZoneEventCallback): () => void {
    this.eventCallbacks.add(callback);
    return () => this.eventCallbacks.delete(callback);
  }

  /**
   * Emit an event to all subscribers
   */
  private emitEvent(event: ZoneEvent): void {
    this.eventCallbacks.forEach((cb) => {
      try {
        cb(event);
      } catch (error) {
        console.error('[ZoneService] Event callback error:', error);
      }
    });
  }
}

// ============================================================================
// VALIDATION ERROR CLASS
// ============================================================================

export class ZoneValidationError extends Error {
  constructor(
    message: string,
    public errors: ValidationError[]
  ) {
    super(message);
    this.name = 'ZoneValidationError';
  }
}

// Singleton instance
export const zoneService = new ZoneService();
