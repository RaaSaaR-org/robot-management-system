/**
 * @file RobotModel.tsx
 * @description 3D robot model component with URDF loading and joint animation
 * @feature robots
 */

import { useRef, useState, useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import URDFLoader, { URDFRobot } from 'urdf-loader';
import { normalizeRobotType, type RobotType, type JointState } from '../../types/robots.types';
import { getFastTelemetry } from '../../store/telemetryLive';
import { tickMotion, isFollowingRoot } from '../../motion/motionPlayback';
import { brandColors } from '@/brand';

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
  /**
   * Robot id for the high-rate telemetry channel (TASK-191). When set, the
   * model reads ~10 Hz `robot_telemetry_fast` frames imperatively inside
   * useFrame; without it (or when no fast frame arrived within ~2 s) it falls
   * back to the `jointStates` prop from the regular 2 s telemetry cadence.
   */
  robotId?: string;
}

// ============================================================================
// JOINT INTERPOLATION (TASK-191)
// ============================================================================

/**
 * Exponential damping factor for joint motion (THREE.MathUtils.damp lambda).
 * ~6 converges in a few hundred ms — smooth at 10 Hz fast-channel input while
 * still visibly tracking 2 s-cadence fallback frames.
 */
const JOINT_DAMP_LAMBDA = 6;

// ============================================================================
// PER-JOINT CORRECTION CONFIG (empirical calibration)
// ============================================================================

/**
 * Fine-tune the mapping from LeRobot degrees → URDF radians.
 * sign: +1 (same direction) or -1 (invert).
 * offset_deg: add to LeRobot degrees before conversion (e.g. if URDF zero ≠ LeRobot zero).
 * These are determined empirically by moving one joint at a time and comparing.
 */
// ----------------------------------------------------------------------------
// SO-101 LeRobot → URDF joint mapping.
//
// LeRobot (use_degrees=True) emits per-joint degrees where 0° = mid of the
// *calibrated* raw-encoder range, and the sign/extent is determined by the
// calibration file (~/.cache/huggingface/lerobot/calibration/...).
//
// Formula from lerobot/motors/motors_bus.py::_normalize:
//     mid_raw  = (range_min + range_max) / 2
//     degrees  = (raw - mid_raw) * 360 / 4095
// So the signed half-range in LeRobot degrees for each joint is:
//     half_range_deg = (range_max - range_min) / 2 * 360 / 4095
//
// We map that linearly onto the URDF joint limits:
//     normalized = clamp(position_deg / half_range_deg, -1, 1)
//     urdf_rad   = urdf_mid + sign * normalized * urdf_half_range
//
// `sign` flips direction per joint when motor polarity and URDF axis disagree.
// These values are derived from the calibration of robot0 / my_so101 — if a
// different arm is connected, update the half-ranges from its calibration file.
// ----------------------------------------------------------------------------
interface So101Joint {
  /** LeRobot half-range in degrees, from calibration (range_max-range_min)/2 * 360/4095 */
  halfRangeDeg: number;
  /** +1 or -1 — flip when LeRobot rotation direction disagrees with URDF axis */
  sign: 1 | -1;
  /** Extra URDF-frame offset (degrees) added after sign/scaling, for visual alignment */
  offsetDeg?: number;
}

const SO101_LEROBOT_CALIBRATION: Record<string, So101Joint> = {
  shoulder_pan:  { halfRangeDeg: 107.81, sign: -1 },
  shoulder_lift: { halfRangeDeg: 108.74, sign:  1 },
  elbow_flex:    { halfRangeDeg:  88.02, sign:  1 },
  wrist_flex:    { halfRangeDeg:  96.86, sign:  1 },
  wrist_roll:    { halfRangeDeg: 180.00, sign: -1, offsetDeg: 90 },
  gripper:       { halfRangeDeg:  59.84, sign: -1, offsetDeg: -25 },
};

/**
 * Convert a telemetry joint position to the URDF-frame target angle in radians.
 *
 * Joints without a LeRobot calibration entry (e.g. G1 humanoid joints) already
 * report URDF-frame radians (keyboard / VR teleop, sim telemetry) and pass
 * through unchanged. SO-101 joints report LeRobot degrees where 0° == mid of
 * the calibrated range == URDF mid; those are mapped linearly onto the URDF
 * [lower, upper] limits (see the calibration notes above).
 */
function toUrdfRadians(
  joint: URDFRobot['joints'][string],
  name: string,
  position: number
): number {
  const calib = SO101_LEROBOT_CALIBRATION[name];
  if (!calib) return position;

  const lower = joint.limit?.lower ?? -Math.PI;
  const upper = joint.limit?.upper ?? Math.PI;
  const urdfMid = (lower + upper) / 2;
  const urdfHalfRange = (upper - lower) / 2;

  const normalized = Math.max(-1, Math.min(1, position / calib.halfRangeDeg));
  const offsetRad = ((calib.offsetDeg ?? 0) * Math.PI) / 180;
  return urdfMid + calib.sign * normalized * urdfHalfRange + offsetRad;
}

// ============================================================================
// URDF MODEL PATHS
// ============================================================================

const URDF_PATHS: Record<string, string> = {
  h1: `${import.meta.env.BASE_URL}assets/robots/h1/h1.urdf`,
  g1: `${import.meta.env.BASE_URL}assets/robots/g1/g1.urdf`,
  // G1 body with Dex3-1 three-finger hands instead of the stock rubber hands (shares g1/meshes)
  g1_edu: `${import.meta.env.BASE_URL}assets/robots/g1/g1_edu.urdf`,
  so101: `${import.meta.env.BASE_URL}assets/robots/so101/so101.urdf`,
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
  isAnimating,
  robotId
}: RobotModelProps) {
  const groupRef = useRef<THREE.Group>(null);
  const [robot, setRobot] = useState<URDFRobot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const timeRef = useRef(0);
  // Latest slow-path (props) joint states, read inside useFrame without
  // re-arming any effect — the fast path bypasses props entirely.
  const propJointStatesRef = useRef<JointState[] | undefined>(jointStates);
  propJointStatesRef.current = jointStates;

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

  // Apply materials in useFrame (keep checking for 3 seconds to catch async DAE loads),
  // drive joints toward their telemetry targets with damping, and handle idle animation
  useFrame((_, delta) => {
    timeRef.current += delta;
    const time = timeRef.current;

    // Joint targets, in priority order (TASK-193 adds the first):
    //   1. a loaded motion clip — deliberately outranks live telemetry. A tab showing playback
    //      must not have the robot's real pose fighting it for the same joints.
    //   2. a fresh ~10 Hz fast-channel frame (TASK-191)
    //   3. the regular 2 s telemetry from props (older agents / fast channel disabled)
    const motion = tickMotion();
    const fastFrame = !motion && robotId ? getFastTelemetry(robotId)?.frame : null;
    const activeJointStates = motion?.jointStates ?? fastFrame?.jointStates ?? propJointStatesRef.current;

    if (robot && activeJointStates) {
      for (const { name, position } of activeJointStates) {
        const joint = robot.joints[name];
        if (!joint) continue;

        const target = toUrdfRadians(joint, name, position);
        if (motion) {
          // No damping during playback. sampleClip already interpolates between clip frames, so
          // the target signal is continuous — damping on top of it would only lag and smear the
          // fast limb movements that are the whole point of watching a retargeted clip.
          robot.setJointValue(name, target);
          continue;
        }
        const rawAngle = joint.angle;
        const current = typeof rawAngle === 'number' ? rawAngle : Number(rawAngle) || 0;
        // Exponential damping instead of a hard snap: poses glide between
        // telemetry frames rather than teleporting on arrival.
        robot.setJointValue(name, THREE.MathUtils.damp(current, target, JOINT_DAMP_LAMBDA, delta));
      }
    }

    if (robot) {
      // Root pose. A MotionSample is always Z-up and always xyzw whatever the clip declared —
      // sampleClip resolves `upAxis` and `rootRotOrder` so this site has exactly one convention
      // to handle. The parent group's -90° X rotation below converts that Z-up pose into three's
      // Y-up world, so both position and quaternion are applied raw here.
      if (motion && isFollowingRoot()) {
        robot.position.set(motion.rootPos[0], motion.rootPos[1], motion.rootPos[2]);
        robot.quaternion.set(motion.rootRot[0], motion.rootRot[1], motion.rootRot[2], motion.rootRot[3]);
      } else if (robot.position.lengthSq() !== 0 || robot.quaternion.w !== 1) {
        // Leaving playback (or turning root-follow off) must put the body back at the origin,
        // otherwise the live view inherits wherever the clip left it.
        robot.position.set(0, 0, 0);
        robot.quaternion.identity();
      }
    }

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
            emissive: new THREE.Color(brandColors().accent),
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
    if (!isAnimating || activeJointStates || !groupRef.current) return;

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
  isAnimating,
  robotId
}: RobotModelProps) {
  const groupRef = useRef<THREE.Group>(null);
  const jointRefs = useRef<Map<string, THREE.Mesh>>(new Map());
  const timeRef = useRef(0);
  const propJointStatesRef = useRef<JointState[] | undefined>(jointStates);
  propJointStatesRef.current = jointStates;

  const joints = useMemo(() => {
    switch (robotType) {
      case 'so101':
        return SO101_JOINTS;
      default:
        return GENERIC_JOINTS;
    }
  }, [robotType]);

  // Drive joints toward telemetry targets with damping; idle-animate otherwise
  useFrame((_, delta) => {
    const fastFrame = robotId ? getFastTelemetry(robotId)?.frame : null;
    const activeJointStates = fastFrame?.jointStates ?? propJointStatesRef.current;

    if (activeJointStates) {
      for (const state of activeJointStates) {
        const mesh = jointRefs.current.get(state.name);
        if (mesh) {
          mesh.rotation.z = THREE.MathUtils.damp(
            mesh.rotation.z,
            state.position,
            JOINT_DAMP_LAMBDA,
            delta
          );
        }
      }
    }

    if (!isAnimating || activeJointStates) return;

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
  const normalizedType = normalizeRobotType(props.robotType);
  const normalizedProps = { ...props, robotType: normalizedType };

  // Use URDF for supported types, fallback to procedural for others
  if (normalizedType in URDF_PATHS) {
    return <URDFModel {...normalizedProps} />;
  }

  return <ProceduralModel {...normalizedProps} />;
}
