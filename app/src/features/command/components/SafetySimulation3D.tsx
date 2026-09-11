/**
 * @file SafetySimulation3D.tsx
 * @description 3D safety simulation preview (@react-three/fiber). Every colour
 *              is a theme token, resolved once from CSS variables through
 *              readSimColors() — three.js materials cannot read `var(--…)`.
 * @feature command
 */

import { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Line, Grid } from '@react-three/drei';
import type { Group } from 'three';
import * as THREE from 'three';
import type { SimulationPoint, SimulationObstacle, SimulationSafetyStatus } from '../types/simulation.types';
import { DEFAULT_ROBOT_SPEED } from '../types/simulation.types';
import { generateSimulationPath, formatDistance, formatETA } from '../utils/pathCalculation';
import { SAFETY_STATUS_ROLE, readSimColors, type SimColorRole } from '../utils/simColors';

export interface SafetySimulation3DProps {
  /** Robot's current position (canvas coordinates) */
  robotPosition: SimulationPoint;
  /** Command destination (canvas coordinates, null hides simulation) */
  destination: SimulationPoint | null;
  /** Obstacles to display (canvas coordinates) */
  obstacles?: SimulationObstacle[];
  /** Safety classification from interpretation */
  safetyClassification: SimulationSafetyStatus;
  /** Robot speed in m/s (for ETA calculation) */
  speed?: number;
  /** Command type for grip point visualization */
  commandType?: string;
}

type SimPalette = Record<SimColorRole, string>;

const SCALE = 0.02; // Canvas coords to 3D units

function canvasTo3D(point: SimulationPoint): [number, number, number] {
  return [(point.x - 200) * SCALE, 0, (point.y - 112) * SCALE];
}

function FloorPlane({ c }: { c: SimPalette }) {
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[12, 12]} />
        <meshStandardMaterial color={c.ground} />
      </mesh>
      <Grid
        args={[12, 12]}
        cellSize={0.5}
        cellThickness={0.5}
        cellColor={c.line}
        sectionSize={2}
        sectionThickness={1}
        sectionColor={c.lineStrong}
        fadeDistance={8}
        position={[0, 0, 0]}
      />
    </>
  );
}

/** Robot mesh that follows the path */
function RobotMesh({ pathPoints, c }: { pathPoints: THREE.Vector3[]; c: SimPalette }) {
  const groupRef = useRef<Group>(null);
  const progressRef = useRef(0);

  useFrame((_, delta) => {
    if (!groupRef.current || pathPoints.length < 2) return;
    progressRef.current += delta * 0.15;
    if (progressRef.current > 1) progressRef.current = 0;

    const totalSegments = pathPoints.length - 1;
    const segmentFloat = progressRef.current * totalSegments;
    const segmentIndex = Math.min(Math.floor(segmentFloat), totalSegments - 1);
    const segmentT = segmentFloat - segmentIndex;
    const from = pathPoints[segmentIndex];
    const to = pathPoints[segmentIndex + 1];
    groupRef.current.position.lerpVectors(from, to, segmentT);

    const dir = new THREE.Vector3().subVectors(to, from);
    if (dir.length() > 0.001) groupRef.current.rotation.y = Math.atan2(dir.x, dir.z);
  });

  return (
    <group ref={groupRef} position={pathPoints[0] ?? new THREE.Vector3(0, 0, 0)}>
      <mesh position={[0, 0.2, 0]} castShadow>
        <boxGeometry args={[0.3, 0.4, 0.2]} />
        <meshStandardMaterial color={c.primary} />
      </mesh>
      <mesh position={[0, 0.5, 0]} castShadow>
        <cylinderGeometry args={[0.1, 0.12, 0.15, 8]} />
        <meshStandardMaterial color={c.accent} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <ringGeometry args={[0.2, 0.25, 32]} />
        <meshBasicMaterial color={c.primary} transparent opacity={0.4} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

/** Path line coloured by the safety class */
function PathLine3D({ pathPoints, color }: { pathPoints: THREE.Vector3[]; color: string }) {
  if (pathPoints.length < 2) return null;
  const elevated = pathPoints.map((p) => new THREE.Vector3(p.x, 0.05, p.z));
  return <Line points={elevated} color={color} lineWidth={3} transparent opacity={0.9} />;
}

function ObstacleSphere({ obstacle, c }: { obstacle: SimulationObstacle; c: SimPalette }) {
  const [x, , z] = canvasTo3D(obstacle.position);
  const radius = obstacle.size * SCALE * 0.8;
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, radius, 0]}>
        <sphereGeometry args={[radius * 2, 16, 16]} />
        <meshStandardMaterial color={c.stopped} transparent opacity={0.1} />
      </mesh>
      <mesh position={[0, radius, 0]} castShadow>
        <sphereGeometry args={[radius, 16, 16]} />
        <meshStandardMaterial color={c.stopped} transparent opacity={0.5} />
      </mesh>
    </group>
  );
}

function StartMarker3D({ position, c }: { position: [number, number, number]; c: SimPalette }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[position[0], 0.02, position[2]]}>
      <ringGeometry args={[0.15, 0.2, 32]} />
      <meshBasicMaterial color={c.muted} transparent opacity={0.8} side={THREE.DoubleSide} />
    </mesh>
  );
}

function TargetMarker3D({ position, c }: { position: [number, number, number]; c: SimPalette }) {
  const meshRef = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (meshRef.current) meshRef.current.position.y = 0.3 + Math.sin(state.clock.elapsedTime * 2) * 0.1;
  });
  return (
    <group position={position}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[0.15, 0.2, 32]} />
        <meshBasicMaterial color={c.primary} transparent opacity={0.7} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={meshRef} position={[0, 0.3, 0]}>
        <octahedronGeometry args={[0.08]} />
        <meshStandardMaterial color={c.primary} />
      </mesh>
    </group>
  );
}

/** Grip point cone for pickup/drop commands */
function GripPointMarker({ position, c }: { position: [number, number, number]; c: SimPalette }) {
  const coneRef = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (coneRef.current) coneRef.current.position.y = 0.7 + Math.sin(state.clock.elapsedTime * 3) * 0.05;
  });
  return (
    <group position={position}>
      <mesh ref={coneRef} position={[0, 0.7, 0]} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[0.06, 0.15, 8]} />
        <meshStandardMaterial color={c.estimated} />
      </mesh>
      <Line
        points={[new THREE.Vector3(0, 1.0, 0), new THREE.Vector3(0, 0.6, 0)]}
        color={c.estimated}
        lineWidth={2}
        transparent
        opacity={0.6}
        dashed
        dashSize={0.05}
        gapSize={0.03}
      />
    </group>
  );
}

function SimulationScene({
  robotPosition,
  destination,
  obstacles = [],
  safetyClassification,
  commandType,
  c,
}: SafetySimulation3DProps & { c: SimPalette }) {
  // Quadratic curve from start to destination, bent further when obstacles exist
  const pathPoints = useMemo(() => {
    if (!destination) return [];
    const [sx, , sz] = canvasTo3D(robotPosition);
    const [ex, , ez] = canvasTo3D(destination);
    const bend = obstacles.length > 0 ? 0.5 : 0.2;
    const cx = (sx + ex) / 2 - (ez - sz) * bend;
    const cz = (sz + ez) / 2 + (ex - sx) * bend;
    return Array.from({ length: 31 }, (_, i) => {
      const t = i / 30;
      const x = (1 - t) * (1 - t) * sx + 2 * (1 - t) * t * cx + t * t * ex;
      const z = (1 - t) * (1 - t) * sz + 2 * (1 - t) * t * cz + t * t * ez;
      return new THREE.Vector3(x, 0.05, z);
    });
  }, [robotPosition, destination, obstacles]);

  const endPos3D = destination ? canvasTo3D(destination) : null;
  const isGripCommand = commandType === 'pickup' || commandType === 'drop';

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 8, 5]} intensity={1.4} castShadow shadow-mapSize={[1024, 1024]} />
      <directionalLight position={[-3, 5, -3]} intensity={0.6} />
      <FloorPlane c={c} />
      {obstacles.map((obs) => (
        <ObstacleSphere key={obs.id} obstacle={obs} c={c} />
      ))}
      <PathLine3D pathPoints={pathPoints} color={c[SAFETY_STATUS_ROLE[safetyClassification]]} />
      <StartMarker3D position={canvasTo3D(robotPosition)} c={c} />
      {endPos3D && <TargetMarker3D position={endPos3D} c={c} />}
      {isGripCommand && endPos3D && <GripPointMarker position={endPos3D} c={c} />}
      {pathPoints.length > 1 && <RobotMesh pathPoints={pathPoints} c={c} />}
      <OrbitControls enablePan enableZoom enableRotate maxPolarAngle={Math.PI / 2.1} minDistance={1} maxDistance={10} />
    </>
  );
}

/**
 * 3D path preview. Colours follow the theme at mount time.
 */
export function SafetySimulation3D(props: SafetySimulation3DProps) {
  const { robotPosition, destination, speed = DEFAULT_ROBOT_SPEED, obstacles = [] } = props;
  const colors = useMemo(() => readSimColors(), []);
  const simulationPath = destination ? generateSimulationPath(robotPosition, destination, obstacles, speed) : null;

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-control border border-line-subtle">
      <Canvas
        camera={{ position: [0, 4, 5], fov: 50 }}
        shadows
        gl={{ antialias: true }}
        style={{ background: 'var(--bg-tertiary)' }}
        aria-label="3D path preview"
      >
        <SimulationScene {...props} c={colors} />
      </Canvas>
      {simulationPath && (
        <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-0.5 rounded-tag bg-panel/90 px-2 py-1 text-[13px] tabular-nums">
          <span className="text-ink-secondary">
            <span className="text-ink-tertiary">Distance </span>
            {formatDistance(simulationPath.distance)}
          </span>
          <span className="text-ink-secondary">
            <span className="text-ink-tertiary">ETA </span>
            {formatETA(simulationPath.eta)}
          </span>
        </div>
      )}
    </div>
  );
}
