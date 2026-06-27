/**
 * @file ZoneVolumes.tsx
 * @description L2 layer — renders each TwinZone polygon as a translucent
 *   extruded volume (THREE.Shape → ExtrudeGeometry, height = maxZ − minZ),
 *   colored by zone type. Lives INSIDE the world-frame group in TwinViewer, so
 *   polygon points are world meters directly (z-up). The extrude is along +z
 *   from minZ to maxZ.
 * @feature digitaltwin
 */

import { memo, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { TwinZoneDTO } from '../types/twin.types';
import { TWIN_ZONE_COLORS } from '../store/twinZoneStore';

function zoneColor(zone: TwinZoneDTO): string {
  return zone.color || TWIN_ZONE_COLORS[zone.type] || '#FF6700';
}

const ZoneVolume = memo(function ZoneVolume({
  zone,
  selected,
  onSelect,
}: {
  zone: TwinZoneDTO;
  selected: boolean;
  onSelect?: (id: string) => void;
}) {
  const geometry = useMemo(() => {
    if (zone.points.length < 3) return null;
    const shape = new THREE.Shape();
    shape.moveTo(zone.points[0].x, zone.points[0].y);
    for (let i = 1; i < zone.points.length; i++) {
      shape.lineTo(zone.points[i].x, zone.points[i].y);
    }
    shape.closePath();
    const depth = Math.max(0.05, zone.maxZ - zone.minZ);
    const geom = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
    // Shape is in the XY plane; lift it to the zone's floor (minZ along +z).
    geom.translate(0, 0, zone.minZ);
    return geom;
  }, [zone]);

  useEffect(() => () => geometry?.dispose(), [geometry]);

  const color = useMemo(() => new THREE.Color(zoneColor(zone)), [zone]);

  if (!geometry) return null;

  return (
    <mesh
      geometry={geometry}
      onClick={(e) => {
        e.stopPropagation();
        onSelect?.(zone.id);
      }}
    >
      <meshStandardMaterial
        color={color}
        transparent
        opacity={selected ? 0.42 : 0.22}
        side={THREE.DoubleSide}
        depthWrite={false}
        emissive={color}
        emissiveIntensity={selected ? 0.4 : 0.18}
      />
    </mesh>
  );
});

export interface ZoneVolumesProps {
  zones: TwinZoneDTO[];
  selectedZoneId?: string | null;
  onSelect?: (id: string) => void;
}

export const ZoneVolumes = memo(function ZoneVolumes({ zones, selectedZoneId, onSelect }: ZoneVolumesProps) {
  return (
    <group>
      {zones.map((zone) => (
        <ZoneVolume
          key={zone.id}
          zone={zone}
          selected={zone.id === selectedZoneId}
          onSelect={onSelect}
        />
      ))}
    </group>
  );
});
