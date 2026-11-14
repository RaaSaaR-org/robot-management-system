/**
 * @file modelLoading.test.ts
 * @description The URDF model's load gate and material pass (TASK-502): the
 *              model stays hidden until every mesh has landed or the timeout
 *              passed, and a mesh is restyled however late it arrives — except
 *              a `keepMaterial` (linkOverlay) mesh.
 * @feature robots
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  MODEL_REVEAL_TIMEOUT_MS,
  ROBOT_MATERIAL_NAME,
  applyRobotMaterial,
  isModelHidden,
  modelLoadLabel,
  watchModelLoad,
  type ModelLoadState,
} from '../modelLoading';

describe('watchModelLoad (TASK-502)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function watch(timeoutMs?: number) {
    const manager = new THREE.LoadingManager();
    const states: ModelLoadState[] = [];
    const dispose = watchModelLoad(manager, (s) => states.push(s), timeoutMs);
    const last = () => states[states.length - 1];
    return { manager, states, dispose, last };
  }

  it('starts hidden, before any file has been asked for', () => {
    const h = watch();
    expect(h.states).toEqual([{ phase: 'loading', loaded: 0, total: 0 }]);
    expect(isModelHidden(h.last())).toBe(true);
  });

  it('stays hidden while meshes arrive and reveals only when the last one has', () => {
    const h = watch();
    // The URDF, then the two meshes its parse asks for, then the URDF ends.
    h.manager.itemStart('g1.urdf');
    h.manager.itemStart('pelvis.STL');
    h.manager.itemStart('torso.STL');
    h.manager.itemEnd('g1.urdf');
    expect(h.last()).toEqual({ phase: 'loading', loaded: 1, total: 3 });

    h.manager.itemEnd('pelvis.STL');
    expect(h.last()).toEqual({ phase: 'loading', loaded: 2, total: 3 });
    expect(isModelHidden(h.last())).toBe(true);

    h.manager.itemEnd('torso.STL');
    expect(h.last()).toEqual({ phase: 'ready', loaded: 3, total: 3 });
    expect(isModelHidden(h.last())).toBe(false);
    expect(h.states.filter((s) => s.phase === 'ready')).toHaveLength(1);
  });

  it('a mesh that fails still lets the model be revealed', () => {
    const h = watch();
    h.manager.itemStart('g1.urdf');
    h.manager.itemStart('broken.STL');
    h.manager.itemEnd('g1.urdf');
    // What three's loaders do on a failed request: error, then end.
    h.manager.itemError('broken.STL');
    h.manager.itemEnd('broken.STL');
    expect(h.last().phase).toBe('ready');
  });

  it('reveals whatever has loaded once the timeout passes, and only once', () => {
    const h = watch();
    h.manager.itemStart('g1.urdf');
    h.manager.itemStart('hung.STL');
    h.manager.itemEnd('g1.urdf');

    vi.advanceTimersByTime(MODEL_REVEAL_TIMEOUT_MS - 1);
    expect(h.last().phase).toBe('loading');

    vi.advanceTimersByTime(1);
    expect(h.last()).toEqual({ phase: 'timeout', loaded: 1, total: 2 });
    expect(isModelHidden(h.last())).toBe(false);

    // The hung mesh finally lands: the model is already shown, nothing more is said.
    const count = h.states.length;
    h.manager.itemEnd('hung.STL');
    expect(h.states).toHaveLength(count);
  });

  it('the timeout is about 20 seconds', () => {
    expect(MODEL_REVEAL_TIMEOUT_MS).toBe(20_000);
  });

  it('does not time out a load that already finished', () => {
    const h = watch();
    h.manager.itemStart('g1.urdf');
    h.manager.itemEnd('g1.urdf');
    expect(h.last().phase).toBe('ready');

    vi.advanceTimersByTime(MODEL_REVEAL_TIMEOUT_MS * 2);
    expect(h.last().phase).toBe('ready');
  });

  it('an abandoned load reports cancelled and then stays silent', () => {
    const h = watch();
    h.manager.itemStart('g1.urdf');
    h.dispose();
    expect(h.last().phase).toBe('cancelled');

    const count = h.states.length;
    h.manager.itemEnd('g1.urdf');
    vi.advanceTimersByTime(MODEL_REVEAL_TIMEOUT_MS * 2);
    h.dispose();
    expect(h.states).toHaveLength(count);
  });

  it('disposing a finished load says nothing', () => {
    const h = watch();
    h.manager.itemStart('g1.urdf');
    h.manager.itemEnd('g1.urdf');
    const count = h.states.length;
    h.dispose();
    expect(h.states).toHaveLength(count);
  });
});

describe('modelLoadLabel (TASK-502)', () => {
  it('names the progress once the mesh count is known', () => {
    expect(modelLoadLabel({ phase: 'loading', loaded: 0, total: 0 })).toBe('Loading 3D model…');
    expect(modelLoadLabel({ phase: 'loading', loaded: 0, total: 1 })).toBe('Loading 3D model…');
    expect(modelLoadLabel({ phase: 'loading', loaded: 12, total: 36 })).toBe('Loading 3D model… 12 / 36');
  });

  it.each(['ready', 'timeout', 'cancelled'] as const)('says nothing once the load is %s', (phase) => {
    expect(modelLoadLabel({ phase, loaded: 3, total: 36 })).toBeNull();
  });

  it('says nothing for a model that never loads anything', () => {
    expect(modelLoadLabel(null)).toBeNull();
  });
});

describe('applyRobotMaterial (TASK-502)', () => {
  const create = () => new THREE.MeshStandardMaterial({ name: ROBOT_MATERIAL_NAME });
  const loaderMesh = () => new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshPhongMaterial());

  it('restyles every mesh in the tree and marks it for shadows', () => {
    const root = new THREE.Group();
    const link = new THREE.Group();
    const a = loaderMesh();
    const b = loaderMesh();
    root.add(link);
    link.add(a);
    root.add(b);

    expect(applyRobotMaterial(root, create)).toBe(2);

    for (const mesh of [a, b]) {
      expect((mesh.material as THREE.Material).name).toBe(ROBOT_MATERIAL_NAME);
      expect(mesh.castShadow).toBe(true);
      expect(mesh.receiveShadow).toBe(true);
    }
  });

  it('restyles a mesh that arrives after earlier passes — there is no time window', () => {
    const root = new THREE.Group();
    root.add(loaderMesh());
    expect(applyRobotMaterial(root, create)).toBe(1);
    // Many frames later, long past the old 3 s window, a slow STL lands.
    for (let frame = 0; frame < 600; frame += 1) expect(applyRobotMaterial(root, create)).toBe(0);

    const late = loaderMesh();
    root.add(late);

    expect(applyRobotMaterial(root, create)).toBe(1);
    expect((late.material as THREE.Material).name).toBe(ROBOT_MATERIAL_NAME);
  });

  it('skips a mesh it already restyled, so a per-frame pass builds no new material', () => {
    const root = new THREE.Group();
    const mesh = loaderMesh();
    root.add(mesh);
    const factory = vi.fn(create);

    applyRobotMaterial(root, factory);
    const first = mesh.material;
    applyRobotMaterial(root, factory);

    expect(factory).toHaveBeenCalledTimes(1);
    expect(mesh.material).toBe(first);
  });

  it('never touches a keepMaterial mesh (linkOverlay)', () => {
    const root = new THREE.Group();
    const link = new THREE.Group();
    const body = loaderMesh();
    const overlay = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ name: 'GhostHand' }));
    overlay.userData.keepMaterial = true;
    const own = overlay.material;
    root.add(link);
    link.add(body);
    link.add(overlay);

    expect(applyRobotMaterial(root, create)).toBe(1);
    expect(applyRobotMaterial(root, create)).toBe(0);

    expect(overlay.material).toBe(own);
    expect(overlay.castShadow).toBe(false);
    expect((body.material as THREE.Material).name).toBe(ROBOT_MATERIAL_NAME);
  });
});
