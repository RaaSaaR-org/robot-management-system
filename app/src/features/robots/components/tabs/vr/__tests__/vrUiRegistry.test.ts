/**
 * @file vrUiRegistry.test.ts
 * @description TASK-407: the in-VR UI's pure parts — the ray from a pose, hit
 *              selection against registered buttons, and the trigger press /
 *              hold-to-confirm reducer.
 * @feature robots
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import {
  IDLE_PRESS,
  pickVrUiHit,
  rayFromPose,
  registerVrUiTarget,
  resetVrUiRegistry,
  stepPress,
  vrUiTargets,
  type VrPressState,
  type VrUiTarget,
} from '../vrUiRegistry';

/** A 12 x 6 cm button plane at `z`, facing +Z. */
function button(id: string, z: number, overrides: Partial<VrUiTarget> = {}): VrUiTarget {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.06), new THREE.MeshBasicMaterial());
  mesh.position.set(0, 0, z);
  mesh.updateMatrixWorld(true);
  return {
    id,
    object: mesh,
    disabled: false,
    allowWhenEstopped: false,
    onClick: () => {},
    ui: { hovered: false, pressed: false, progress: 0 },
    ...overrides,
  };
}

/** A controller at the origin pointing down -Z (identity orientation). */
const FORWARD = { position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } };

beforeEach(() => resetVrUiRegistry());

describe('rayFromPose', () => {
  it('points along the pose\'s -Z, as WebXR defines the target ray', () => {
    const ray = rayFromPose(FORWARD);
    expect(ray.direction.toArray()).toEqual([0, 0, -1]);
  });

  it('applies the XR origin\'s transform, which a recenter moves', () => {
    const toWorld = new THREE.Matrix4().makeTranslation(1, 0, 0)
      .multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2));
    const ray = rayFromPose(FORWARD, toWorld);
    expect(ray.origin.x).toBeCloseTo(1);
    // -Z turned 90° about +Y is -X.
    expect(ray.direction.x).toBeCloseTo(-1);
    expect(ray.direction.z).toBeCloseTo(0);
  });
});

describe('pickVrUiHit', () => {
  it('hits a button straight ahead and misses one off to the side', () => {
    const ahead = button('ahead', -1);
    const off = button('off', -1);
    off.object!.position.x = 0.5;
    off.object!.updateMatrixWorld(true);
    const hit = pickVrUiHit(rayFromPose(FORWARD), [off, ahead], { estopLatched: false });
    expect(hit?.target.id).toBe('ahead');
    expect(hit?.distance).toBeCloseTo(1);
  });

  it('takes the nearest of two in line', () => {
    const far = button('far', -2);
    const near = button('near', -1);
    expect(pickVrUiHit(rayFromPose(FORWARD), [far, near], { estopLatched: false })?.target.id).toBe('near');
  });

  it('looks through a disabled or hidden button to the live one behind it', () => {
    const dead = button('dead', -1, { disabled: true });
    const hidden = button('hidden', -1.5);
    hidden.object!.visible = false;
    const live = button('live', -2);
    expect(pickVrUiHit(rayFromPose(FORWARD), [dead, hidden, live], { estopLatched: false })?.target.id).toBe('live');
  });

  it('while latched, hits only a button flagged allowWhenEstopped', () => {
    const recenter = button('recenter', -1);
    const reset = button('reset', -2, { allowWhenEstopped: true });
    expect(pickVrUiHit(rayFromPose(FORWARD), [recenter, reset], { estopLatched: true })?.target.id).toBe('reset');
    expect(pickVrUiHit(rayFromPose(FORWARD), [recenter], { estopLatched: true })).toBeNull();
  });

  it('honours a hidden ancestor (a panel group switched off)', () => {
    const b = button('b', -1);
    const parent = new THREE.Group();
    parent.add(b.object!);
    parent.visible = false;
    expect(pickVrUiHit(rayFromPose(FORWARD), [b], { estopLatched: false })).toBeNull();
  });
});

describe('the registry', () => {
  it('adds and removes targets', () => {
    const off = registerVrUiTarget(button('a', -1));
    expect(vrUiTargets().map((t) => t.id)).toEqual(['a']);
    off();
    expect(vrUiTargets()).toEqual([]);
  });
});

describe('stepPress — a click is the trigger\'s rising edge on a button', () => {
  const run = (frames: Array<{ hitId: string | null; trigger: number | null; now: number; holdMs?: number; raw?: boolean }>) => {
    let state: VrPressState = IDLE_PRESS;
    const clicks: string[] = [];
    const progress: number[] = [];
    for (const f of frames) {
      const step = stepPress(state, { hitId: f.hitId, trigger: f.trigger, now: f.now, holdMs: f.holdMs }, f.raw);
      state = step.state;
      if (step.clickId) clicks.push(step.clickId);
      progress.push(step.progress);
    }
    return { clicks, progress };
  };

  it('clicks once on the edge, not on every frame held', () => {
    const { clicks } = run([
      { hitId: 'b', trigger: 0, now: 0 },
      { hitId: 'b', trigger: 1, now: 10 },
      { hitId: 'b', trigger: 1, now: 20 },
      { hitId: 'b', trigger: 1, now: 30 },
    ]);
    expect(clicks).toEqual(['b']);
  });

  it('does not click when the ray arrives with the trigger already held', () => {
    const { clicks } = run([
      { hitId: null, trigger: 1, now: 0 },
      { hitId: 'b', trigger: 1, now: 10 },
    ]);
    expect(clicks).toEqual([]);
  });

  it('never clicks while the grip is held, nor when it opens with the trigger still down', () => {
    const { clicks } = run([
      { hitId: null, trigger: null, now: 0, raw: false },
      { hitId: null, trigger: null, now: 10, raw: true }, // trigger pulled with the grip held: a grasp
      { hitId: 'b', trigger: 1, now: 20 }, // grip let go, trigger still down
    ]);
    expect(clicks).toEqual([]);
  });

  it('holds to confirm: fills to 1 over holdMs, then clicks exactly once', () => {
    const { clicks, progress } = run([
      { hitId: 'reset', trigger: 1, now: 0, holdMs: 1000 },
      { hitId: 'reset', trigger: 1, now: 500, holdMs: 1000 },
      { hitId: 'reset', trigger: 1, now: 999, holdMs: 1000 },
      { hitId: 'reset', trigger: 1, now: 1000, holdMs: 1000 },
      { hitId: 'reset', trigger: 1, now: 1500, holdMs: 1000 },
    ]);
    expect(progress[1]).toBeCloseTo(0.5);
    expect(clicks).toEqual(['reset']);
    // Nothing before the full second.
    expect(progress[2]).toBeLessThan(1);
  });

  it('a hold released early or moved off the button does not fire, and does not resume', () => {
    expect(run([
      { hitId: 'reset', trigger: 1, now: 0, holdMs: 1000 },
      { hitId: 'reset', trigger: 0, now: 900, holdMs: 1000 },
    ]).clicks).toEqual([]);
    expect(run([
      { hitId: 'reset', trigger: 1, now: 0, holdMs: 1000 },
      { hitId: null, trigger: 1, now: 500 },
      { hitId: 'reset', trigger: 1, now: 600, holdMs: 1000 },
      { hitId: 'reset', trigger: 1, now: 2000, holdMs: 1000 },
    ]).clicks).toEqual([]);
  });
});
