/**
 * @file twin.types.ts
 * @description Types for the digital-twin feature (scan sessions, sites, server
 *   DTOs, and L2 zones). The server-of-record is the `DigitalTwin` row; the app
 *   `Site` view is derived from `DigitalTwinDTO`.
 * @feature digitaltwin
 */

/** A planar world pose. `yaw` is radians, about +z (robotics frame). */
export interface TwinPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/** A world-frame point cloud accumulated during a scan session. */
export interface AccumulatedCloud {
  /** Interleaved world positions `[x,y,z,...]`. */
  positions: Float32Array;
  /** Per-point intensity 0..1. */
  intensities: Float32Array;
  pointCount: number;
}

export type ScanStatus = 'idle' | 'scanning' | 'finalizing' | 'done' | 'error';

// ============================================================================
// SERVER DTOs (locked contract — server returns these, app consumes)
// ============================================================================

/** Lifecycle status of a server-side DigitalTwin row. */
export type TwinStatus = 'draft' | 'recording' | 'processing' | 'ready' | 'failed';

/** Lifecycle status of a server-side ScanSession row. */
export type SessionStatus = 'idle' | 'recording' | 'processing' | 'complete' | 'failed';

/** Build-pipeline stage reported during processing. */
export type SessionStage = 'downloading' | 'merging' | 'occupancy' | 'mesh' | 'roadmap';

/**
 * L2 zone classification authored on top of a twin. `'room'` (TASK-200) is a
 * named region of floor the robot MAY stand in — it becomes a place in the
 * robot's place graph and is excluded from the Nav2 keep-out raster.
 */
export type TwinZoneType = 'keepout' | 'workcell' | 'charging' | 'speed' | 'room';

/**
 * Place vocabulary a `room` (or `keepout`) zone can carry in `metadata.placeType`.
 * Closed set — mirrors the robot agent's `PlaceTypes`.
 */
export const TWIN_PLACE_TYPES = [
  'aisle',
  'rack_face',
  'dock',
  'staging',
  'cell',
  'charging',
  'corridor',
  'office',
  'unknown',
] as const;
export type TwinPlaceType = (typeof TWIN_PLACE_TYPES)[number];

/** A 2D world-meters point used for zone polygons. */
export interface TwinPoint {
  x: number;
  y: number;
}

/** The server system-of-record for a scanned site (app "Site" maps to this). */
export interface DigitalTwinDTO {
  id: string;
  name: string;
  robotId?: string;
  floor?: string;
  status: TwinStatus;
  version: number;
  worldOrigin: { x: number; y: number; z: number };
  resolution: number;
  bounds: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number };
  pointCount: number;
  hasCloud: boolean;
  hasMesh: boolean;
  hasOccupancy: boolean;
  /** True once a sim scene has been built from this twin (twin-builder). */
  hasSimScene: boolean;
  /** Backend of the built sim scene ('mujoco' | 'isaac'), if any. */
  simSceneBackend?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** One sweep + its build-job lifecycle. */
export interface ScanSessionDTO {
  id: string;
  robotId: string;
  twinId: string;
  status: SessionStatus;
  frameCount: number;
  progress: number;
  stage?: SessionStage;
  origin: { x: number; y: number; z: number };
  startedAt?: string;
  endedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** An L2 zone authored on a twin (polygon in world meters). */
export interface TwinZoneDTO {
  id: string;
  twinId: string;
  name: string;
  type: TwinZoneType;
  points: TwinPoint[];
  minZ: number;
  maxZ: number;
  color?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** Body for creating a twin (POST /api/digital-twins). */
export interface CreateTwinRequest {
  name: string;
  robotId?: string;
  floor?: string;
}

/** Body for creating a zone (POST /api/digital-twins/:id/zones). */
export interface CreateTwinZoneRequest {
  name: string;
  type: TwinZoneType;
  points: TwinPoint[];
  minZ?: number;
  maxZ?: number;
  color?: string;
  metadata?: Record<string, unknown>;
}

/** Body for updating a zone (PUT /api/digital-twins/:id/zones/:zoneId). */
export type UpdateTwinZoneRequest = Partial<CreateTwinZoneRequest>;

/** Summary of one captured frame (GET /api/scan-sessions/:id/frames). */
export interface SensorScanSummaryDTO {
  id: string;
  robotId: string;
  sessionId?: string;
  frameIndex?: number;
  pointCount: number;
  createdAt: string;
}

// ============================================================================
// TWIN WEBSOCKET EVENTS (server → app, on the shared a2a socket)
// ============================================================================

export interface SessionProgressEvent {
  type: 'session:progress';
  sessionId: string;
  twinId: string;
  status: SessionStatus;
  frameCount: number;
  progress: number;
  stage?: SessionStage;
  timestamp: string;
}

export interface TwinReadyEvent {
  type: 'twin:ready';
  twinId: string;
  sessionId: string;
  twin: DigitalTwinDTO;
  timestamp: string;
}

export interface TwinFailedEvent {
  type: 'twin:failed';
  twinId: string;
  sessionId: string;
  error: string;
  timestamp: string;
}

export interface TwinZoneCreatedEvent {
  type: 'twinZone:created';
  twinId: string;
  zone: TwinZoneDTO;
  timestamp: string;
}

export interface TwinZoneUpdatedEvent {
  type: 'twinZone:updated';
  twinId: string;
  zone: TwinZoneDTO;
  timestamp: string;
}

export interface TwinZoneDeletedEvent {
  type: 'twinZone:deleted';
  twinId: string;
  zoneId: string;
  timestamp: string;
}

export type TwinWebSocketEvent =
  | SessionProgressEvent
  | TwinReadyEvent
  | TwinFailedEvent
  | TwinZoneCreatedEvent
  | TwinZoneUpdatedEvent
  | TwinZoneDeletedEvent;

// ============================================================================
// SITE (app view model — derived from DigitalTwinDTO)
// ============================================================================

/**
 * A scanned site / room (the L0 backdrop of a digital twin). This is the app's
 * card/view model, derived 1:1 from a server `DigitalTwinDTO`.
 */
export interface Site {
  id: string;
  name: string;
  robotId: string;
  createdAt: string;
  status: TwinStatus;
  /** Accumulated point count from the server build (for the gallery). */
  pointCount?: number;
  /** True once the server has built a downloadable merged cloud. */
  hasCloud?: boolean;
  hasMesh?: boolean;
  hasOccupancy?: boolean;
  /** World-meters AABB (for footprint dimensions on the card). */
  bounds?: DigitalTwinDTO['bounds'];
  /** Grid resolution in m/px (for the export grid estimate). */
  resolution?: number;
}

/** Map a server `DigitalTwinDTO` to the app `Site` view model. */
export function twinToSite(twin: DigitalTwinDTO): Site {
  return {
    id: twin.id,
    name: twin.name,
    robotId: twin.robotId ?? '',
    createdAt: twin.createdAt,
    status: twin.status,
    pointCount: twin.pointCount,
    hasCloud: twin.hasCloud,
    hasMesh: twin.hasMesh,
    hasOccupancy: twin.hasOccupancy,
    bounds: twin.bounds,
    resolution: twin.resolution,
  };
}

/** Footprint dimensions (m) + area (m²) derived from a world-meters AABB. */
export interface TwinDimensions {
  width: number;
  length: number;
  height: number;
  area: number;
}

/** Derive width/length/height/area from a twin AABB. Returns null if degenerate. */
export function twinDimensions(bounds?: DigitalTwinDTO['bounds']): TwinDimensions | null {
  if (!bounds) return null;
  const width = bounds.maxX - bounds.minX;
  const length = bounds.maxY - bounds.minY;
  const height = bounds.maxZ - bounds.minZ;
  if (!(width > 0.1 && length > 0.1)) return null;
  return { width, length, height: Math.max(0, height), area: width * length };
}

/** Estimate the occupancy grid size (px) from an AABB + resolution. */
export function twinGridSize(
  bounds?: DigitalTwinDTO['bounds'],
  resolution?: number,
): { w: number; h: number } | null {
  const dims = twinDimensions(bounds);
  if (!dims || !resolution || resolution <= 0) return null;
  return { w: Math.round(dims.width / resolution), h: Math.round(dims.length / resolution) };
}
