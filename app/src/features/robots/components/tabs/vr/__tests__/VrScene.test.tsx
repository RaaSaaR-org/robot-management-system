/**
 * @file VrScene.test.tsx
 * @description The one thing about this scene that is not three.js trivia: the
 *              desktop orbit controls must be OFF inside an immersive session.
 * @feature robots
 *
 * WHY THIS FILE EXISTS AT ALL. Everything else in `VrScene` is scene graph and
 * belongs in a headset, not in jsdom — see the note at the top of
 * `VRTeleopModal.test.tsx`. This one prop is different, because getting it wrong
 * silently kills arm teleoperation for a whole session:
 *
 * drei's `OrbitControls` runs `controls.update()` in its own `useFrame`, and
 * `update()` WRITES `camera.position` and `camera.quaternion` from its spherical
 * state. Inside an XR session that lands on the same camera object three has
 * just posed from the `XRViewerPose`, so `state.camera` reports where the
 * desktop preview is pointing rather than where the wearer is looking.
 *
 * Nothing about the rendering shows it — the headset draws from the per-eye
 * views. What breaks is downstream: `VrTeleopRig` reads that camera for
 * `headingFromCamera`, and a preview orbited above the robot has a horizontal
 * forward projection shorter than `FWD_MIN_HORIZONTAL`, so the bearing reads
 * null every frame, `robotHeadingRef` is never seeded, and `wristToRobotFrame`
 * refuses every pose for a non-finite heading. Measured through the WebXR
 * emulator: 0 `{wrists}` frames sent across a session with the grip held, while
 * `{move}` streamed normally beside it.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import * as THREE from 'three';

vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { children?: React.ReactNode }) => <div data-testid="canvas">{children}</div>,
  useFrame: () => {},
  useThree: () => ({}),
}));

vi.mock('@react-three/drei', () => ({
  OrbitControls: (props: { enabled?: boolean }) => (
    // `enabled` is deliberately serialised as a string rather than omitted when
    // false: a missing attribute and `enabled={false}` are the same DOM, and
    // this test has to tell them apart.
    <div data-testid="orbit-controls" data-enabled={String(props.enabled)} />
  ),
  Grid: () => <div data-testid="grid" />,
  Center: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@react-three/xr', () => ({
  XR: ({ children }: { children?: React.ReactNode }) => <div data-testid="xr">{children}</div>,
}));

vi.mock('../../../visualization/RobotModel', () => ({ RobotModel: () => <div /> }));
vi.mock('../HeadCameraPanel', () => ({ HeadCameraPanel: () => <div /> }));
vi.mock('../VrWristHud', () => ({ VrWristHud: () => <div /> }));
vi.mock('../VrOrigin', () => ({
  VrOrigin: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../VrTeleopRig', () => ({
  VrTeleopRig: () => <div data-testid="rig" />,
  createRigTelemetry: () => ({}),
}));

import { VrScene, type VrSceneProps } from '../VrScene';

function makeProps(overrides: Partial<VrSceneProps> = {}): VrSceneProps {
  return {
    store: {} as VrSceneProps['store'],
    robotId: 'sim-robot-g1-edu',
    modelType: 'g1',
    jointStates: [],
    modelRef: createRef<THREE.Group>(),
    yawRef: createRef<THREE.Group>(),
    headingRef: { current: 0 },
    robotHeadingRef: { current: Number.NaN },
    robotPositionsRef: { current: {} },
    canStreamRef: { current: false },
    telemetryRef: { current: {} as VrSceneProps['telemetryRef']['current'] },
    recenterKey: 0,
    retargetMode: 'ik',
    handTracking: false,
    inVr: false,
    jointMap: {} as VrSceneProps['jointMap'],
    send: () => true,
    onRecenter: () => {},
    ...overrides,
  } as VrSceneProps;
}

// R3F's intrinsics (`<ambientLight>`, `<group>`, …) are not DOM tags, so React
// warns about every one of them. Filtered rather than left to scroll, so a real
// error in this file is still visible.
const realError = console.error;
beforeAll(() => {
  console.error = (...args: unknown[]) => {
    const first = String(args[0] ?? '');
    if (/incorrect casing|is unrecognized in this browser/.test(first)) return;
    realError(...(args as []));
  };
});
afterAll(() => { console.error = realError; });

describe('VrScene orbit controls', () => {
  it('drives the preview camera while the operator is at the desk', () => {
    render(<VrScene {...makeProps({ inVr: false })} />);
    expect(screen.getByTestId('orbit-controls')).toHaveAttribute('data-enabled', 'true');
  });

  it('lets go of the camera inside a session, or the arm never receives a pose', () => {
    render(<VrScene {...makeProps({ inVr: true })} />);
    expect(screen.getByTestId('orbit-controls')).toHaveAttribute('data-enabled', 'false');
  });
});
