/**
 * @file twin.types.ts
 * @description Shared types for the Digital Twin feature (TASK-170): twins,
 *              scan sessions, zones, sidecar build jobs, DTOs, and events.
 * @feature digitaltwin
 */

// ============================================================================
// DOMAIN ENUMS
// ============================================================================

export type DigitalTwinStatus = 'draft' | 'recording' | 'processing' | 'ready' | 'failed';
export type ScanSessionStatus = 'idle' | 'recording' | 'processing' | 'complete' | 'failed';
export type ScanSessionStage = 'downloading' | 'merging' | 'occupancy' | 'mesh' | 'roadmap';
export type TwinZoneType = 'keepout' | 'workcell' | 'charging' | 'speed';
export type TwinStorageBackend = 'rustfs' | 'local';

// ============================================================================
// DOMAIN RECORDS (repository layer)
// ============================================================================

export interface DigitalTwinRecord {
  id: string;
  name: string;
  robotId: string | null;
  floor: string | null;
  status: DigitalTwinStatus;
  version: number;
  worldOriginX: number;
  worldOriginY: number;
  worldOriginZ: number;
  resolution: number;
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  pointCount: number;
  storageBackend: TwinStorageBackend;
  cloudKey: string | null;
  meshKey: string | null;
  occupancyPgmKey: string | null;
  occupancyYamlKey: string | null;
  roadmapKey: string | null;
  simSceneKey: string | null;
  simSceneBackend: string | null;
  errorMessage: string | null;
  tenantId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDigitalTwinInput {
  name: string;
  robotId?: string | null;
  floor?: string | null;
  status?: DigitalTwinStatus;
  resolution?: number;
  tenantId?: string | null;
}

export interface UpdateDigitalTwinInput {
  name?: string;
  status?: DigitalTwinStatus;
  version?: number;
  worldOriginX?: number;
  worldOriginY?: number;
  worldOriginZ?: number;
  resolution?: number;
  minX?: number;
  minY?: number;
  minZ?: number;
  maxX?: number;
  maxY?: number;
  maxZ?: number;
  pointCount?: number;
  storageBackend?: TwinStorageBackend;
  cloudKey?: string | null;
  meshKey?: string | null;
  occupancyPgmKey?: string | null;
  occupancyYamlKey?: string | null;
  roadmapKey?: string | null;
  simSceneKey?: string | null;
  simSceneBackend?: string | null;
  errorMessage?: string | null;
}

export interface ScanSessionRecord {
  id: string;
  robotId: string;
  twinId: string;
  status: ScanSessionStatus;
  frameCount: number;
  originX: number;
  originY: number;
  originZ: number;
  startedAt: string | null;
  endedAt: string | null;
  progress: number;
  stage: ScanSessionStage | null;
  workerId: string | null;
  lastHeartbeat: string | null;
  errorMessage: string | null;
  tenantId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateScanSessionInput {
  robotId: string;
  twinId: string;
  status?: ScanSessionStatus;
  originX?: number;
  originY?: number;
  originZ?: number;
  startedAt?: Date | null;
  tenantId?: string | null;
}

export interface UpdateScanSessionInput {
  status?: ScanSessionStatus;
  frameCount?: number;
  originX?: number;
  originY?: number;
  originZ?: number;
  startedAt?: Date | null;
  endedAt?: Date | null;
  progress?: number;
  stage?: ScanSessionStage | null;
  workerId?: string | null;
  lastHeartbeat?: Date | null;
  errorMessage?: string | null;
}

export interface TwinZonePoint {
  x: number;
  y: number;
}

export interface TwinZoneRecord {
  id: string;
  twinId: string;
  name: string;
  type: TwinZoneType;
  points: TwinZonePoint[];
  minZ: number;
  maxZ: number;
  color: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTwinZoneInput {
  twinId: string;
  name: string;
  type: TwinZoneType;
  points: TwinZonePoint[];
  minZ?: number;
  maxZ?: number;
  color?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface UpdateTwinZoneInput {
  name?: string;
  type?: TwinZoneType;
  points?: TwinZonePoint[];
  minZ?: number;
  maxZ?: number;
  color?: string | null;
  metadata?: Record<string, unknown> | null;
}

// ============================================================================
// DTOs (server → app, per contract)
// ============================================================================

export interface DigitalTwinDTO {
  id: string;
  name: string;
  robotId?: string | null;
  floor?: string | null;
  status: DigitalTwinStatus;
  version: number;
  worldOrigin: { x: number; y: number; z: number };
  resolution: number;
  bounds: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number };
  pointCount: number;
  hasCloud: boolean;
  hasMesh: boolean;
  hasOccupancy: boolean;
  hasSimScene: boolean;
  simSceneBackend?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScanSessionDTO {
  id: string;
  robotId: string;
  twinId: string;
  status: ScanSessionStatus;
  frameCount: number;
  progress: number;
  stage?: ScanSessionStage | null;
  origin: { x: number; y: number; z: number };
  startedAt?: string | null;
  endedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TwinZoneDTO {
  id: string;
  twinId: string;
  name: string;
  type: TwinZoneType;
  points: TwinZonePoint[];
  minZ: number;
  maxZ: number;
  color?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// SIDECAR BUILD-JOB CONTRACT
// ============================================================================

export interface TwinBuildJobFrame {
  scanId: string;
  frameIndex: number;
  pose: { x: number; y: number; z: number; qx: number; qy: number; qz: number; qw: number };
  pointCount: number;
}

export interface TwinBuildJob {
  sessionId: string;
  twinId: string;
  robotId: string;
  resolution: number;
  worldOrigin: { x: number; y: number; z: number };
  frameCount: number;
  frames: TwinBuildJobFrame[];
}

export interface TwinWorkerProgressRequest {
  sessionId: string;
  workerId: string;
  progress: number;
  stage?: ScanSessionStage;
}

export interface TwinWorkerHeartbeatRequest {
  sessionId: string;
  workerId: string;
}

export interface TwinWorkerCompleteRequest {
  sessionId: string;
  workerId: string;
  pointCount: number;
  bounds: [number, number, number, number, number, number];
  artifacts: {
    cloudKey?: string | null;
    meshKey?: string | null;
    occupancyPgmKey?: string | null;
    occupancyYamlKey?: string | null;
    roadmapKey?: string | null;
    simSceneKey?: string | null; // MJCF physics scene (TASK-171)
  };
  storageBackend: TwinStorageBackend;
}

export interface TwinWorkerFailedRequest {
  sessionId: string;
  workerId: string;
  error: string;
}

// ============================================================================
// EVENTS (service → websocket broadcast)
// ============================================================================

export type DigitalTwinEvent =
  | {
      type: 'session:progress';
      sessionId: string;
      twinId: string;
      status: ScanSessionStatus;
      frameCount: number;
      progress: number;
      stage?: ScanSessionStage | null;
      timestamp: string;
    }
  | {
      type: 'twin:ready';
      twinId: string;
      sessionId: string;
      twin: DigitalTwinDTO;
      timestamp: string;
    }
  | {
      type: 'twin:failed';
      twinId: string;
      sessionId: string;
      error: string;
      timestamp: string;
    };

export type DigitalTwinEventCallback = (event: DigitalTwinEvent) => void;

export type TwinZoneEvent =
  | { type: 'twinZone:created'; twinId: string; zone: TwinZoneDTO; timestamp: string }
  | { type: 'twinZone:updated'; twinId: string; zone: TwinZoneDTO; timestamp: string }
  | { type: 'twinZone:deleted'; twinId: string; zoneId: string; timestamp: string };

export type TwinZoneEventCallback = (event: TwinZoneEvent) => void;
