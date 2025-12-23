/**
 * @file RobotModel.tsx
 * @description 3D robot model component with URDF loading and joint animation
 * @feature robots
 */

import { useRef, useState, useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import URDFLoader, { URDFRobot } from 'urdf-loader';
import type { RobotType, JointState } from '../../types/robots.types';

// ============================================================================
// TYPES
// ============================================================================

export interface RobotModelProps {
  /** Robot type for model selection */
  robotType: RobotType;
  /** Current joint states from telemetry */
  jointStates?: JointState[];
  /** Whether to show idle animation */
  isAnimating?: boolean;
}

// ============================================================================
// URDF MODEL PATHS
// ============================================================================

const URDF_PATHS: Record<string, string> = {
  h1: '/assets/robots/h1/h1.urdf',
};

// ============================================================================
// PROCEDURAL FALLBACK (for generic/unsupported types)
// ============================================================================

interface JointDefinition {
  name: string;
  position: [number, number, number];
  size: [number, number, number];
  color: string;
  axis: 'x' | 'y' | 'z';
}

const SO101_JOINTS: JointDefinition[] = [
  { name: 'base', position: [0, 0, 0], size: [0.1, 0.05, 0.1], color: '#f5c518', axis: 'z' },
  { name: 'shoulder_pan', position: [0, 0.06, 0], size: [0.06, 0.08, 0.06], color: '#1a1a1a', axis: 'z' },
  { name: 'shoulder_lift', position: [0, 0.12, 0], size: [0.05, 0.06, 0.05], color: '#f5c518', axis: 'z' },
  { name: 'upper_arm', position: [0, 0.22, 0], size: [0.04, 0.14, 0.04], color: '#f5c518', axis: 'z' },
  { name: 'elbow', position: [0, 0.32, 0], size: [0.04, 0.04, 0.04], color: '#1a1a1a', axis: 'z' },
  { name: 'lower_arm', position: [0, 0.42, 0], size: [0.035, 0.12, 0.035], color: '#f5c518', axis: 'z' },
  { name: 'wrist', position: [0, 0.5, 0], size: [0.04, 0.04, 0.04], color: '#1a1a1a', axis: 'z' },
  { name: 'gripper_base', position: [0, 0.55, 0], size: [0.05, 0.04, 0.03], color: '#f5c518', axis: 'z' },
  { name: 'gripper_left', position: [0.02, 0.59, 0], size: [0.01, 0.04, 0.02], color: '#f5c518', axis: 'z' },
  { name: 'gripper_right', position: [-0.02, 0.59, 0], size: [0.01, 0.04, 0.02], color: '#f5c518', axis: 'z' },
];

const GENERIC_JOINTS: JointDefinition[] = [
  { name: 'base', position: [0, 0, 0], size: [0.3, 0.15, 0.2], color: '#4a5568', axis: 'y' },
  { name: 'body', position: [0, 0.2, 0], size: [0.25, 0.3, 0.15], color: '#2d3748', axis: 'y' },
];

// ============================================================================
// URDF MODEL COMPONENT
// ============================================================================

function URDFModel({
  robotType,
  jointStates,
  isAnimating
}: RobotModelProps) {
  const groupRef = useRef<THREE.Group>(null);
  const [robot, setRobot] = useState<URDFRobot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const timeRef = useRef(0);

  // Load URDF model (don't apply materials here - DAE loads async)
  useEffect(() => {
    const urdfPath = URDF_PATHS[robotType];
    if (!urdfPath) {
      setLoadError(`No URDF available for robot type: ${robotType}`);
      return;
    }

    const loader = new URDFLoader();
    timeRef.current = 0; // Reset timer to allow material application

    loader.load(
      urdfPath,
      (loadedRobot) => {
        setRobot(loadedRobot);
        setLoadError(null);
      },
      undefined,
      (error) => {
        console.error('[RobotModel] Failed to load URDF:', error);
        setLoadError(`Failed to load URDF: ${error}`);
      }
    );

    return () => {
      // Cleanup on unmount
      if (robot) {
        robot.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry?.dispose();
            if (Array.isArray(child.material)) {
              child.material.forEach((m) => m.dispose());
            } else {
              child.material?.dispose();
            }
          }
        });
      }
    };
  }, [robotType]);

  // Apply joint states from telemetry
  useEffect(() => {
    if (!robot || !jointStates) return;

    jointStates.forEach(({ name, position }) => {
      // Try exact match first
      if (robot.joints[name]) {
        robot.setJointValue(name, position);
      }
    });
  }, [robot, jointStates]);

  // Apply materials in useFrame (keep checking for 3 seconds to catch async DAE loads)
  // and handle idle animation
  useFrame((_, delta) => {
    timeRef.current += delta;
    const time = timeRef.current;

    // Keep applying materials for first 3 seconds after robot loads (DAE meshes load async)
    if (robot && time < 3) {
      robot.traverse((child: THREE.Object3D) => {
        const mesh = child as THREE.Mesh;
        // Check if mesh needs material update (hasn't been processed yet)
        if (mesh.isMesh && mesh.material) {
          const mat = mesh.material as THREE.Material;
          // Skip if already our custom material (check by name)
          if (mat.name === 'RobotCustomMaterial') return;

          // Apply bright metallic material with strong glow (visible on dark bg)
          const newMat = new THREE.MeshStandardMaterial({
            name: 'RobotCustomMaterial',
            color: 0xc8d0dc,           // Light silver-gray (bright)
            metalness: 0.5,
            roughness: 0.35,
            emissive: 0x18E4C3,        // Turquoise glow
            emissiveIntensity: 0.35,   // Stronger glow
            side: THREE.DoubleSide,
          });
          mesh.material = newMat;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
        }
      });
    }

    // Idle animation when no telemetry
    if (!isAnimating || jointStates || !groupRef.current) return;

    // Subtle breathing motion
    groupRef.current.position.y = Math.sin(time * 0.5) * 0.01;
    groupRef.current.rotation.y = Math.sin(time * 0.2) * 0.02;
  });

  // Show error state
  if (loadError) {
    return (
      <group ref={groupRef}>
        <mesh>
          <boxGeometry args={[0.5, 1.5, 0.3]} />
          <meshStandardMaterial color="#ef4444" wireframe />
        </mesh>
      </group>
    );
  }

  // Show loading state
  if (!robot) {
    return (
      <group ref={groupRef}>
        <mesh>
          <boxGeometry args={[0.5, 1.5, 0.3]} />
          <meshStandardMaterial color="#4a5568" wireframe />
        </mesh>
      </group>
    );
  }

  return (
    <group ref={groupRef} rotation={[-Math.PI / 2, 0, 0]}>
      <primitive object={robot} />
    </group>
  );
}

// ============================================================================
// PROCEDURAL MODEL COMPONENT (fallback)
// ============================================================================

function ProceduralModel({
  robotType,
  jointStates,
  isAnimating
}: RobotModelProps) {
  const groupRef = useRef<THREE.Group>(null);
  const jointRefs = useRef<Map<string, THREE.Mesh>>(new Map());
  const timeRef = useRef(0);

  const joints = useMemo(() => {
    switch (robotType) {
      case 'so101':
        return SO101_JOINTS;
      default:
        return GENERIC_JOINTS;
    }
  }, [robotType]);

  // Apply joint states from telemetry
  useEffect(() => {
    if (!jointStates) return;

    jointStates.forEach((state) => {
      const mesh = jointRefs.current.get(state.name);
      if (mesh) {
        mesh.rotation.z = state.position;
      }
    });
  }, [jointStates]);

  // Idle animation when no telemetry
  useFrame((_, delta) => {
    if (!isAnimating || jointStates) return;

    timeRef.current += delta;
    const time = timeRef.current;

    if (groupRef.current) {
      groupRef.current.position.y = Math.sin(time * 0.5) * 0.01;
      groupRef.current.rotation.y = Math.sin(time * 0.2) * 0.02;
    }
  });

  return (
    <group ref={groupRef}>
      {joints.map((joint) => (
        <mesh
          key={joint.name}
          ref={(mesh) => {
            if (mesh) jointRefs.current.set(joint.name, mesh);
          }}
          position={joint.position}
          castShadow
          receiveShadow
        >
          <boxGeometry args={joint.size} />
          <meshStandardMaterial
            color={joint.color}
            metalness={0.3}
            roughness={0.7}
          />
        </mesh>
      ))}
    </group>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function RobotModel(props: RobotModelProps) {
  const { robotType } = props;

  // Use URDF for supported types, fallback to procedural for others
  if (robotType in URDF_PATHS) {
    return <URDFModel {...props} />;
  }

  return <ProceduralModel {...props} />;
}
