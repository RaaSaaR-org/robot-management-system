/**
 * @file TwinBackdrop.tsx
 * @description L0/L1 geometry layer of the twin. A `kind` discriminator selects
 *   the backdrop representation:
 *     - `points` (default) — the accumulated world point cloud as THREE.Points,
 *       colored by height. Feeds from either the live client preview or the
 *       authoritative server-built cloud (twin:ready path).
 *     - `mesh` — a GLB room mesh loaded from the twin's `/mesh` artifact via
 *       drei `useGLTF` (room-scale ships without forcing a heavy mesh dep on the
 *       points path).
 *     - `octree` — documented stub/TODO (no heavy deps added).
 *   Lives inside the world-frame group (z-up), so positions are world
 *   coordinates directly.
 * @feature digitaltwin
 */

import { memo, Suspense, useEffect, useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import type { AccumulatedCloud } from '../types/twin.types';

function turbo(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t));
  const stops: Array<[number, [number, number, number]]> = [
    [0.0, [0.13, 0.32, 0.85]],
    [0.25, [0.0, 0.78, 0.92]],
    [0.5, [0.18, 0.85, 0.3]],
    [0.75, [0.98, 0.82, 0.12]],
    [1.0, [0.92, 0.18, 0.12]],
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i];
    const [t1, c1] = stops[i + 1];
    if (x >= t0 && x <= t1) {
      const f = (x - t0) / (t1 - t0 || 1);
      return [c0[0] + (c1[0] - c0[0]) * f, c0[1] + (c1[1] - c0[1]) * f, c0[2] + (c1[2] - c0[2]) * f];
    }
  }
  return stops[stops.length - 1][1];
}

/** Backdrop representation discriminator. */
export type TwinBackdropKind = 'points' | 'mesh' | 'octree';

export interface TwinBackdropProps {
  /** Representation. Defaults to 'points' (the only path that always works). */
  kind?: TwinBackdropKind;
  /** Point cloud (required for kind='points'). */
  cloud?: AccumulatedCloud | null;
  /** GLB artifact URL (required for kind='mesh'). */
  meshUrl?: string;
  pointSize?: number;
}

// ----------------------------------------------------------------------------
// Points backdrop (default)
// ----------------------------------------------------------------------------

const PointsBackdrop = memo(function PointsBackdrop({ cloud, pointSize = 0.04 }: { cloud: AccumulatedCloud; pointSize?: number }) {
  const geometry = useMemo(() => {
    const n = cloud.pointCount;
    const positions = cloud.positions;
    const colors = new Float32Array(n * 3);

    let minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
      const z = positions[i * 3 + 2];
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    const span = maxZ - minZ || 1;
    for (let i = 0; i < n; i++) {
      const [r, g, b] = turbo((positions[i * 3 + 2] - minZ) / span);
      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geom;
  }, [cloud]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  const material = useMemo(
    () => new THREE.PointsMaterial({ size: pointSize, vertexColors: true, sizeAttenuation: true }),
    [pointSize],
  );
  useEffect(() => () => material.dispose(), [material]);

  return <points geometry={geometry} material={material} frustumCulled={false} />;
});

// ----------------------------------------------------------------------------
// Mesh backdrop (GLB room mesh, behind the discriminator + Suspense)
// ----------------------------------------------------------------------------

function MeshBackdropInner({ meshUrl }: { meshUrl: string }) {
  const { scene } = useGLTF(meshUrl);
  // Clone so the cached gltf isn't mutated when added to multiple scenes.
  const object = useMemo(() => scene.clone(true), [scene]);
  return <primitive object={object} />;
}

// ----------------------------------------------------------------------------
// Public component
// ----------------------------------------------------------------------------

export const TwinBackdrop = memo(function TwinBackdrop({
  kind = 'points',
  cloud,
  meshUrl,
  pointSize = 0.04,
}: TwinBackdropProps) {
  if (kind === 'mesh' && meshUrl) {
    return (
      <Suspense fallback={cloud && cloud.pointCount > 0 ? <PointsBackdrop cloud={cloud} pointSize={pointSize} /> : null}>
        <MeshBackdropInner meshUrl={meshUrl} />
      </Suspense>
    );
  }

  // kind === 'octree' is a documented stub for now — fall back to points so the
  // viewer never renders empty. (TODO: stream an octree LOD for room-scale.)
  if (cloud && cloud.pointCount > 0) {
    return <PointsBackdrop cloud={cloud} pointSize={pointSize} />;
  }
  return null;
});
