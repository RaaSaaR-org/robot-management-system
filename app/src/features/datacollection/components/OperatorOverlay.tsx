/**
 * @file OperatorOverlay.tsx
 * @description Where the operator wants the hands, drawn on the desktop twin
 *              (TASK-414, D3): the commanded wrist targets as translucent ghost
 *              hands and the operator's head as a small frustum, from the
 *              relayed `OperatorState`. Mounted inside the twin's `torso_link`
 *              (`Robot3DViewer`'s `linkOverlay`), whose frame is the robot
 *              frame the headset sends in — x forward, y left, z up — offset by
 *              the eye point the targets are measured from. Reads the store in
 *              its frame loop, so a 5 Hz state never re-renders the canvas.
 * @feature datacollection
 */

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { readCssColor } from '../../robots/components/common/readCssColor';
import type { OperatorPose, OperatorState } from '../types/datacollection.types';

/**
 * The eye point in the torso frame, metres — the G1's `head_camera_site`,
 * which is what the headset's wrist vectors are measured from (the agent's
 * `HEAD_SITE_IN_TORSO`, robot-agent/src/teleop/g1-chains.generated.ts).
 */
export const EYE_IN_TORSO: readonly [number, number, number] = [0.08, 0, 0.42];

/** The link the overlay hangs off. */
export const OVERLAY_LINK = 'torso_link';

export interface OverlayPose {
  position: [number, number, number];
  /** (x, y, z, w) */
  quaternion: [number, number, number, number];
}

export interface OverlayPoses {
  left: OverlayPose | null;
  right: OverlayPose | null;
  head: OverlayPose | null;
}

const NONE: OverlayPoses = { left: null, right: null, head: null };

function place(pose: OperatorPose | null): OverlayPose | null {
  if (!pose) return null;
  return {
    position: [EYE_IN_TORSO[0] + pose.p[0], EYE_IN_TORSO[1] + pose.p[1], EYE_IN_TORSO[2] + pose.p[2]],
    quaternion: [pose.q[0], pose.q[1], pose.q[2], pose.q[3]],
  };
}

/** The ghost hands and the head, in the torso frame; nothing while the operator is out of VR. */
export function operatorOverlayPoses(state: OperatorState | null): OverlayPoses {
  if (!state || !state.inVr) return NONE;
  return {
    left: place(state.targets.left),
    right: place(state.targets.right),
    head: state.head ? { position: [...EYE_IN_TORSO], quaternion: [...state.head.q] } : null,
  };
}

export interface OperatorOverlayProps {
  /** The fresh operator state, read every frame (null: hide everything). */
  getState: () => OperatorState | null;
}

/** The twin restyles every mesh in its tree; these keep their own look. */
const KEEP = { keepMaterial: true } as const;

/** Ghost hand: a palm-sized translucent box with a knuckle bar, its +x pointing where the hand points. */
function GhostHand({ color, name }: { color: string; name: string }) {
  return (
    <group name={name}>
      <mesh userData={KEEP}>
        <boxGeometry args={[0.11, 0.08, 0.03]} />
        <meshBasicMaterial color={color} transparent opacity={0.35} depthWrite={false} />
      </mesh>
      <mesh userData={KEEP}>
        <boxGeometry args={[0.11, 0.08, 0.03]} />
        <meshBasicMaterial color={color} wireframe transparent opacity={0.9} />
      </mesh>
      <mesh userData={KEEP} position={[0.065, 0, 0]}>
        <sphereGeometry args={[0.02, 12, 8]} />
        <meshBasicMaterial color={color} transparent opacity={0.7} depthWrite={false} />
      </mesh>
    </group>
  );
}

const FRUSTUM_DEPTH_M = 0.18;

export function OperatorOverlay({ getState }: OperatorOverlayProps) {
  const left = useRef<THREE.Group>(null);
  const right = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  // The robot is drawn in the measured (mint) colour; what the operator WANTS
  // is the estimated signal colour, so a ghost never reads as part of the body.
  const colors = useMemo(
    () => ({
      hand: readCssColor('--signal-estimated', 'orange'),
      head: readCssColor('--signal-estimated', 'orange'),
    }),
    [],
  );

  useFrame(() => {
    const poses = operatorOverlayPoses(getState());
    const apply = (group: THREE.Group | null, pose: OverlayPose | null) => {
      if (!group) return;
      group.visible = pose !== null;
      if (!pose) return;
      group.position.set(...pose.position);
      group.quaternion.set(...pose.quaternion);
    };
    apply(left.current, poses.left);
    apply(right.current, poses.right);
    apply(head.current, poses.head);
  });

  return (
    <group name="operator-overlay">
      <group ref={left} visible={false}>
        <GhostHand color={colors.hand} name="ghost-hand-left" />
      </group>
      <group ref={right} visible={false}>
        <GhostHand color={colors.hand} name="ghost-hand-right" />
      </group>
      <group ref={head} visible={false} name="operator-head">
        {/* A four-sided cone: apex at the eye, opening along the gaze (+x). */}
        <mesh userData={KEEP} position={[FRUSTUM_DEPTH_M / 2, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <coneGeometry args={[0.08, FRUSTUM_DEPTH_M, 4, 1, true]} />
          <meshBasicMaterial color={colors.head} wireframe transparent opacity={0.8} />
        </mesh>
      </group>
    </group>
  );
}
