/**
 * @file WristCameraPanels.test.tsx
 * @description The headset's wrist screens (TASK-443): where they sit, which
 *              camera each one streams, that a stale wrist never buzzes the
 *              controllers or touches the head camera's status, and the
 *              `vrUiDebug.wristCameras` list. The head panel beside them keeps
 *              its haptics and its store.
 * @feature robots
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { act, render } from '@testing-library/react';
import * as THREE from 'three';
import type { CameraScreenOptions, CameraScreenPoll } from '../useCameraScreen';

const frames: Array<(state: { clock: { elapsedTime: number } }) => void> = [];
vi.mock('@react-three/fiber', () => ({
  useFrame: (cb: (state: { clock: { elapsedTime: number } }) => void) => { frames.push(cb); },
}));

const inputSource = vi.fn((side: string) => ({ inputSource: { side } }));
vi.mock('@react-three/xr', () => ({
  useXRInputSourceState: (_kind: string, side: string) => inputSource(side),
}));

const pulsePreset = vi.fn();
vi.mock('../vrHaptics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../vrHaptics')>()),
  pulsePreset: (...args: unknown[]) => pulsePreset(...args),
}));

/** Every `useCameraScreen` call, and the poll its `step` will report. */
const screens: CameraScreenOptions[] = [];
let nextPoll: CameraScreenPoll | null = null;
vi.mock('../useCameraScreen', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../useCameraScreen')>()),
  useCameraScreen: (options: CameraScreenOptions) => {
    screens.push(options);
    return {
      texture: new THREE.Texture(),
      offlinePlate: { texture: null, draw: () => {} },
      showPlate: false,
      badgePlate: { texture: null, draw: () => {} },
      badgeRef: { current: null },
      reconnect: { phase: 'up', attempt: 0, detail: null, retryInS: null, rearm: () => {}, markFrame: () => {}, armEpoch: { current: 0 } },
      staleNow: { current: false },
      step: () => nextPoll,
    };
  },
}));

import { WristCameraPanels, wristPanelPlacement, wristSideOf } from '../WristCameraPanels';
import { HeadCameraPanel, armStream } from '../HeadCameraPanel';
import { useVrCameraStatus } from '../vrCameraStatus';
import { useVrWristCameraStatus } from '../vrWristCameraStatus';
import { vrUiDebug } from '../vrUiRegistry';
import { HAPTICS } from '../vrHaptics';
import {
  EYE_Y_M,
  PANEL_ASPECT,
  PANEL_DISTANCE_M,
  PANEL_HEIGHT_M,
  PANEL_TEXTURE_HZ,
  PANEL_WIDTH_M,
  WRIST_PANEL_TEXTURE_HZ,
  WRIST_PANEL_WIDTH_M,
} from '../vrConstants';

const WRISTS = ['left_wrist_camera', 'right_wrist_camera'];
/** The wrist screen's surround, beyond each edge. */
const SURROUND_M = 0.008;

// R3F's intrinsics are not DOM tags; see `VrScene.test.tsx`.
const realError = console.error;
beforeAll(() => {
  console.error = (...args: unknown[]) => {
    const first = String(args[0] ?? '');
    if (/incorrect casing|is unrecognized in this browser|non-boolean attribute|React does not recognize/.test(first)) return;
    realError(...(args as []));
  };
});
afterAll(() => { console.error = realError; });

// In jsdom a `<mesh ref>` binds to an unknown DOM element, which has no
// material; the frame loops set its colour. Give every element a harmless one
// for the length of this file.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'material', {
    configurable: true,
    get: () => ({ color: { set: () => {} } }),
  });
});
afterAll(() => {
  delete (HTMLElement.prototype as unknown as { material?: unknown }).material;
});

beforeEach(() => {
  frames.length = 0;
  screens.length = 0;
  nextPoll = null;
  pulsePreset.mockClear();
  inputSource.mockClear();
  useVrCameraStatus.getState().reset();
  useVrWristCameraStatus.setState({ cameras: {} });
});

function runFrames(t = 1): void {
  for (const frame of frames) frame({ clock: { elapsedTime: t } });
}

/** The corners of a wrist screen, in the yaw group's frame. */
function corners(side: 'left' | 'right', margin = 0): THREE.Vector3[] {
  const { position, rotation } = wristPanelPlacement(side);
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(...position),
    new THREE.Quaternion().setFromEuler(rotation),
    new THREE.Vector3(1, 1, 1),
  );
  const w = WRIST_PANEL_WIDTH_M / 2 + margin;
  const h = (WRIST_PANEL_WIDTH_M * PANEL_ASPECT) / 2 + margin;
  return [[-w, -h], [w, -h], [-w, h], [w, h]].map(([x, y]) => new THREE.Vector3(x, y, 0).applyMatrix4(m));
}

describe('wristPanelPlacement', () => {
  it('puts the left wrist at -Z (the model\'s left) and the right at +Z', () => {
    expect(wristPanelPlacement('left').position[2]).toBeLessThan(0);
    expect(wristPanelPlacement('right').position[2]).toBeGreaterThan(0);
  });

  it('keeps both screens within ±20° of forward and below the head screen', () => {
    const headBottom = PANEL_HEIGHT_M - (PANEL_WIDTH_M * PANEL_ASPECT) / 2 - 0.015;
    for (const side of ['left', 'right'] as const) {
      for (const c of corners(side)) {
        expect(Math.abs(Math.atan2(c.z, c.x))).toBeLessThanOrEqual((20 * Math.PI) / 180);
      }
      // With the surround, still clear of the head screen's bottom edge.
      for (const c of corners(side, SURROUND_M)) {
        expect(c.y).toBeLessThan(headBottom);
        // In front of the head screen's plane by at most a hand's width, never behind the eye.
        expect(c.x).toBeGreaterThan(0.9);
        expect(c.x).toBeLessThan(PANEL_DISTANCE_M + 0.1);
      }
    }
    // The two do not overlap each other, surrounds included.
    const leftMaxZ = Math.max(...corners('left', SURROUND_M).map((c) => c.z));
    const rightMinZ = Math.min(...corners('right', SURROUND_M).map((c) => c.z));
    expect(leftMaxZ).toBeLessThan(rightMinZ);
  });

  it('faces the eye', () => {
    for (const side of ['left', 'right'] as const) {
      const { position, rotation } = wristPanelPlacement(side);
      const normal = new THREE.Vector3(0, 0, 1).applyEuler(rotation);
      const toEye = new THREE.Vector3(0, EYE_Y_M, 0).sub(new THREE.Vector3(...position)).normalize();
      expect(normal.dot(toEye)).toBeCloseTo(1, 5);
    }
  });
});

describe('wristSideOf', () => {
  it('reads the side off the name', () => {
    expect(wristSideOf('left_wrist_camera')).toBe('left');
    expect(wristSideOf('right_wrist_camera')).toBe('right');
    expect(wristSideOf('head_camera')).toBeNull();
  });
});

describe('WristCameraPanels', () => {
  it('streams each wrist camera at the wrist rate, and lists them for the e2e spec', () => {
    const { unmount } = render(<WristCameraPanels robotId="g1" cameras={WRISTS} />);
    expect(screens.map((s) => s.camera)).toEqual(expect.arrayContaining(WRISTS));
    expect(new Set(screens.map((s) => s.camera))).toEqual(new Set(WRISTS));
    expect(screens.every((s) => s.textureHz === WRIST_PANEL_TEXTURE_HZ)).toBe(true);
    expect(WRIST_PANEL_TEXTURE_HZ).toBeLessThanOrEqual(10);
    expect(screens.some((s) => s.arm === armStream)).toBe(false);
    expect(vrUiDebug.wristCameras).toEqual(WRISTS);
    unmount();
    expect(vrUiDebug.wristCameras).toEqual([]);
  });

  it('publishes into the keyed wrist store, never the head camera\'s', () => {
    const { unmount } = render(<WristCameraPanels robotId="g1" cameras={WRISTS} />);
    const left = screens.find((s) => s.camera === 'left_wrist_camera')!;
    act(() => left.publish({ robotId: 'g1', state: 'stale' }));
    expect(useVrWristCameraStatus.getState().cameras.left_wrist_camera).toMatchObject({ robotId: 'g1', state: 'stale' });
    expect(useVrCameraStatus.getState()).toMatchObject({ robotId: null, state: 'connecting' });
    unmount();
    expect(useVrWristCameraStatus.getState().cameras).toEqual({});
  });

  it('never buzzes the controllers when a wrist goes stale', () => {
    render(<WristCameraPanels robotId="g1" cameras={WRISTS} />);
    nextPoll = { isStale: true, becameStale: true };
    runFrames();
    expect(pulsePreset).not.toHaveBeenCalled();
    expect(inputSource).not.toHaveBeenCalled();
  });

  it('mounts nothing for a name with no side', () => {
    render(<WristCameraPanels robotId="g1" cameras={['head_camera']} />);
    expect(screens).toHaveLength(0);
    expect(vrUiDebug.wristCameras).toEqual([]);
  });
});

describe('HeadCameraPanel beside them', () => {
  it('keeps head_camera, its rate, its store and its link-lost pulse on both controllers', () => {
    render(<HeadCameraPanel robotId="g1" />);
    expect(screens).toHaveLength(1);
    expect(screens[0]).toMatchObject({ camera: 'head_camera', textureHz: PANEL_TEXTURE_HZ, arm: armStream });
    expect(screens[0].publish).toBe(useVrCameraStatus.getState().publish);
    nextPoll = { isStale: true, becameStale: true };
    runFrames();
    expect(pulsePreset).toHaveBeenCalledTimes(2);
    expect(pulsePreset).toHaveBeenCalledWith({ side: 'left' }, HAPTICS.linkLost);
    expect(pulsePreset).toHaveBeenCalledWith({ side: 'right' }, HAPTICS.linkLost);
  });

  it('does not pulse again while it stays stale', () => {
    render(<HeadCameraPanel robotId="g1" />);
    nextPoll = { isStale: true, becameStale: false };
    runFrames();
    expect(pulsePreset).not.toHaveBeenCalled();
  });
});
