/**
 * @file twinDto.ts
 * @description Pure record → DTO mappers for the Digital Twin feature. Shared by
 *              services + routes so the wire shapes stay consistent with the
 *              integration contract.
 * @feature digitaltwin
 */

import type {
  DigitalTwinRecord,
  DigitalTwinDTO,
  ScanSessionRecord,
  ScanSessionDTO,
  TwinZoneRecord,
  TwinZoneDTO,
} from '../types/twin.types.js';

export function twinToDTO(twin: DigitalTwinRecord): DigitalTwinDTO {
  return {
    id: twin.id,
    name: twin.name,
    robotId: twin.robotId,
    floor: twin.floor,
    status: twin.status,
    version: twin.version,
    worldOrigin: { x: twin.worldOriginX, y: twin.worldOriginY, z: twin.worldOriginZ },
    resolution: twin.resolution,
    bounds: {
      minX: twin.minX,
      minY: twin.minY,
      minZ: twin.minZ,
      maxX: twin.maxX,
      maxY: twin.maxY,
      maxZ: twin.maxZ,
    },
    pointCount: twin.pointCount,
    hasCloud: !!twin.cloudKey,
    hasMesh: !!twin.meshKey,
    hasOccupancy: !!twin.occupancyPgmKey,
    hasSimScene: !!twin.simSceneKey,
    simSceneBackend: twin.simSceneBackend,
    createdAt: twin.createdAt,
    updatedAt: twin.updatedAt,
  };
}

export function scanSessionToDTO(session: ScanSessionRecord): ScanSessionDTO {
  return {
    id: session.id,
    robotId: session.robotId,
    twinId: session.twinId,
    status: session.status,
    frameCount: session.frameCount,
    progress: session.progress,
    stage: session.stage,
    origin: { x: session.originX, y: session.originY, z: session.originZ },
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

export function twinZoneToDTO(zone: TwinZoneRecord): TwinZoneDTO {
  return {
    id: zone.id,
    twinId: zone.twinId,
    name: zone.name,
    type: zone.type,
    points: zone.points,
    minZ: zone.minZ,
    maxZ: zone.maxZ,
    color: zone.color,
    metadata: zone.metadata,
    createdAt: zone.createdAt,
    updatedAt: zone.updatedAt,
  };
}
