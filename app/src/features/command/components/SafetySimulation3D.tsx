/**
 * @file SafetySimulation3D.tsx
 * @description 3D Three.js safety simulation preview using @react-three/fiber
 * @feature command
 */

import { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Line, Grid } from '@react-three/drei';
import type { Group } from 'three';
import * as THREE from 'three';
import type {
  SimulationPoint,
  SimulationObstacle,
  SimulationSafetyStatus,
} from '../types/simulation.types';
import {
  DEFAULT_ROBOT_SPEED,
  SAFETY_STATUS_COLORS,
} from '../types/simulation.types';
import {
  generateSimulationPath,
  formatDistance,
  formatETA,
} from '../utils/pathCalculation';

// ============================================================================
// TYPES
// ============================================================================

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

// ============================================================================
// CONSTANTS
// ============================================================================

const SCALE = 0.02; // Canvas coords to 3D units

function canvasTo3D(point: SimulationPoint): [number, number, number] {
  return [(point.x - 200) * SCALE, 0, (point.y - 112) * SCALE];
}

// ============================================================================
// SUB-COMPONENTS (Three.js)
// ============================================================================

/** Floor plane with grid */
function FloorPlane() {
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[12, 12]} />
        <meshStandardMaterial color="#0a0f1e" transparent opacity={0.8} />
      </mesh>
      <Grid
        args={[12, 12]}
        cellSize={0.5}
        cellThickness={0.5}
        cellColor="#1a2a5e"
        sectionSize={2}
        sectionThickness={1}
        sectionColor="#2A5FFF"
        fadeDistance={8}
        position={[0, 0, 0]}
      />
    </>
  );
}

/** Animated robot mesh that follows the path */
function RobotMesh({
  pathPoints,
}: {
  pathPoints: THREE.Vector3[];
}) {
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

    // Face direction of travel
    const dir = new THREE.Vector3().subVectors(to, from);
    if (dir.length() > 0.001) {
      const angle = Math.atan2(dir.x, dir.z);
      groupRef.current.rotation.y = angle;
    }
  });

  const startPos = pathPoints[0] ?? new THREE.Vector3(0, 0, 0);

  return (
    <group ref={groupRef} position={startPos}>
      {/* Robot body */}
      <mesh position={[0, 0.2, 0]} castShadow>
        <boxGeometry args={[0.3, 0.4, 0.2]} />
        <meshStandardMaterial color="#2A5FFF" />
      </mesh>
      {/* Robot head */}
      <mesh position={[0, 0.5, 0]} castShadow>
        <cylinderGeometry args={[0.1, 0.12, 0.15, 8]} />
        <meshStandardMaterial color="#1a4ad4" />
      </mesh>
      {/* Eyes */}
      <mesh position={[-0.04, 0.52, 0.08]}>
        <sphereGeometry args={[0.025, 8, 8]} />
        <meshStandardMaterial color="#18E4C3" emissive="#18E4C3" emissiveIntensity={2} />
      </mesh>
      <mesh position={[0.04, 0.52, 0.08]}>
        <sphereGeometry args={[0.025, 8, 8]} />
        <meshStandardMaterial color="#18E4C3" emissive="#18E4C3" emissiveIntensity={2} />
      </mesh>
      {/* Pulse ring on floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <ringGeometry args={[0.2, 0.25, 32]} />
        <meshBasicMaterial color="#18E4C3" transparent opacity={0.4} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

/** Path visualization as a line with color gradient */
function PathLine3D({
  pathPoints,
  safetyStatus,
}: {
  pathPoints: THREE.Vector3[];
  safetyStatus: SimulationSafetyStatus;
}) {
  const colors = SAFETY_STATUS_COLORS[safetyStatus];
  const lineColor = safetyStatus === 'dangerous' ? '#ef4444' : safetyStatus === 'caution' ? '#eab308' : '#22c55e';

  if (pathPoints.length < 2) return null;

  // Elevated path points for visibility
  const elevatedPoints = pathPoints.map(
    (p) => new THREE.Vector3(p.x, 0.05, p.z)
  );

  return (
    <>
      {/* Main path line */}
      <Line
        points={elevatedPoints}
        color={lineColor}
        lineWidth={3}
        transparent
        opacity={0.8}
      />
      {/* Glow path line */}
      <Line
        points={elevatedPoints}
        color={colors.primary}
        lineWidth={6}
        transparent
        opacity={0.2}
      />
    </>
  );
}

/** Obstacle sphere */
function ObstacleSphere({ obstacle }: { obstacle: SimulationObstacle }) {
  const [x, , z] = canvasTo3D(obstacle.position);
  const radius = obstacle.size * SCALE * 0.8;

  return (
    <group position={[x, 0, z]}>
      {/* Danger zone */}
      <mesh position={[0, radius, 0]}>
        <sphereGeometry args={[radius * 2, 16, 16]} />
        <meshStandardMaterial color="#ef4444" transparent opacity={0.12} />
      </mesh>
      {/* Obstacle body */}
      <mesh position={[0, radius, 0]} castShadow>
        <sphereGeometry args={[radius, 16, 16]} />
        <meshStandardMaterial color="#ef4444" transparent opacity={0.5} />
      </mesh>
      {/* Floor ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <ringGeometry args={[radius * 1.5, radius * 1.8, 32]} />
        <meshBasicMaterial color="#ef4444" transparent opacity={0.3} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

/** Start marker */
function StartMarker3D({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[0.15, 0.2, 32]} />
        <meshBasicMaterial color="#2A5FFF" transparent opacity={0.6} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

/** Target marker */
function TargetMarker3D({ position }: { position: [number, number, number] }) {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.position.y = 0.3 + Math.sin(state.clock.elapsedTime * 2) * 0.1;
    }
  });

  return (
    <group position={position}>
      {/* Floor ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[0.15, 0.2, 32]} />
        <meshBasicMaterial color="#18E4C3" transparent opacity={0.6} side={THREE.DoubleSide} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[0.25, 0.28, 32]} />
        <meshBasicMaterial color="#18E4C3" transparent opacity={0.3} side={THREE.DoubleSide} />
      </mesh>
      {/* Floating diamond */}
      <mesh ref={meshRef} position={[0, 0.3, 0]}>
        <octahedronGeometry args={[0.08]} />
        <meshStandardMaterial color="#18E4C3" emissive="#18E4C3" emissiveIntensity={1} />
      </mesh>
    </group>
  );
}

/** Grip point cone for pickup/drop commands */
function GripPointMarker({ position }: { position: [number, number, number] }) {
  const coneRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    if (coneRef.current) {
      coneRef.current.position.y = 0.7 + Math.sin(state.clock.elapsedTime * 3) * 0.05;
    }
  });

  return (
    <group position={position}>
      {/* Downward-pointing cone */}
      <mesh ref={coneRef} position={[0, 0.7, 0]} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[0.06, 0.15, 8]} />
        <meshStandardMaterial color="#facc15" emissive="#facc15" emissiveIntensity={0.8} />
      </mesh>
      {/* Approach line from above */}
      <Line
        points={[
          new THREE.Vector3(0, 1.0, 0),
          new THREE.Vector3(0, 0.6, 0),
        ]}
        color="#facc15"
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

/** Scene lighting */
function SceneLighting() {
  return (
    <>
      <ambientLight intensity={0.4} />
      <directionalLight
        position={[5, 8, 5]}
        intensity={1.5}
        castShadow
        shadow-mapSize={[1024, 1024]}
      />
      <directionalLight position={[-3, 5, -3]} intensity={0.8} />
      <pointLight position={[-2, 2, -2]} intensity={0.6} color="#18E4C3" distance={8} />
      <pointLight position={[2, 1, 2]} intensity={0.4} color="#2A5FFF" distance={8} />
    </>
  );
}

// ============================================================================
// MAIN 3D SCENE
// ============================================================================

function SimulationScene({
  robotPosition,
  destination,
  obstacles = [],
  safetyClassification,
  speed = DEFAULT_ROBOT_SPEED,
  commandType,
}: SafetySimulation3DProps) {
  const simulationPath = destination
    ? generateSimulationPath(robotPosition, destination, obstacles, speed)
    : null;

  // Convert waypoints to 3D points
  const pathPoints = useMemo(() => {
    if (!simulationPath || !destination) return [];

    const points: THREE.Vector3[] = [];
    const numSamples = 30;

    // Parse SVG path to extract control points for interpolation
    const startPos = canvasTo3D(robotPosition);
    const endPos = canvasTo3D(destination);

    // Generate smooth curve between start and end
    for (let i = 0; i <= numSamples; i++) {
      const t = i / numSamples;
      // Quadratic bezier approximation
      const midX = (startPos[0] + endPos[0]) / 2;
      const midZ = (startPos[2] + endPos[2]) / 2;

      // Add a curve offset based on obstacles
      const curveOffset = obstacles.length > 0 ? 0.5 : 0.2;
      const perpX = -(endPos[2] - startPos[2]) * curveOffset;
      const perpZ = (endPos[0] - startPos[0]) * curveOffset;

      const ctrlX = midX + perpX;
      const ctrlZ = midZ + perpZ;

      const x = (1 - t) * (1 - t) * startPos[0] + 2 * (1 - t) * t * ctrlX + t * t * endPos[0];
      const z = (1 - t) * (1 - t) * startPos[2] + 2 * (1 - t) * t * ctrlZ + t * t * endPos[2];

      points.push(new THREE.Vector3(x, 0.05, z));
    }

    return points;
  }, [robotPosition, destination, obstacles, simulationPath]);

  const startPos3D = canvasTo3D(robotPosition);
  const endPos3D = destination ? canvasTo3D(destination) : null;

  const isGripCommand = commandType === 'pickup' || commandType === 'drop';

  return (
    <>
      <SceneLighting />
      <FloorPlane />

      {/* Obstacles */}
      {obstacles.map((obs) => (
        <ObstacleSphere key={obs.id} obstacle={obs} />
      ))}

      {/* Path */}
      {pathPoints.length > 1 && (
        <PathLine3D pathPoints={pathPoints} safetyStatus={safetyClassification} />
      )}

      {/* Start marker */}
      <StartMarker3D position={startPos3D} />

      {/* Target marker */}
      {endPos3D && <TargetMarker3D position={endPos3D} />}

      {/* Grip point for pickup/drop */}
      {isGripCommand && endPos3D && <GripPointMarker position={endPos3D} />}

      {/* Animated robot */}
      {pathPoints.length > 1 && <RobotMesh pathPoints={pathPoints} />}

      {/* Controls */}
      <OrbitControls
        enablePan={true}
        enableZoom={true}
        enableRotate={true}
        maxPolarAngle={Math.PI / 2.1}
        minDistance={1}
        maxDistance={10}
      />
    </>
  );
}

// ============================================================================
// EXPORTED COMPONENT
// ============================================================================

export function SafetySimulation3D(props: SafetySimulation3DProps) {
  const { robotPosition, destination, speed = DEFAULT_ROBOT_SPEED, obstacles = [] } = props;

  const simulationPath = destination
    ? generateSimulationPath(robotPosition, destination, obstacles, speed)
    : null;

  return (
    <div className="relative w-full aspect-video rounded-xl overflow-hidden">
      <Canvas
        camera={{ position: [0, 4, 5], fov: 50 }}
        shadows
        gl={{ antialias: true }}
        style={{
          background: 'linear-gradient(180deg, #0C1440 0%, #060a20 100%)',
        }}
      >
        <SimulationScene {...props} />
      </Canvas>

      {/* Data overlay */}
      {simulationPath && (
        <>
          <div className="absolute top-3 left-3 flex flex-col gap-1">
            <div className="flex items-center gap-2 text-xs font-mono">
              <span className="text-theme-muted">DIST:</span>
              <span className="text-turquoise">{formatDistance(simulationPath.distance)}</span>
            </div>
            <div className="flex items-center gap-2 text-xs font-mono">
              <span className="text-theme-muted">ETA:</span>
              <span className="text-cobalt-300">{formatETA(simulationPath.eta)}</span>
            </div>
          </div>
          <div className="absolute bottom-2 left-2 text-xs text-theme-tertiary bg-surface-900/80 px-2 py-1 rounded font-mono">
            3D PREVIEW
          </div>
        </>
      )}
    </div>
  );
}
