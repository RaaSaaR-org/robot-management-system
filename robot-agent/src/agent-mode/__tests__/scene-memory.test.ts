/**
 * @file scene-memory.test.ts
 * @description Relative (image-centre) → world bearing conversion across a
 *              simulated `scan_room`, and entity merge-by-label.
 * @feature agentmode
 * @status test
 */

import { describe, it, expect } from 'vitest';
import { SceneMemoryStore } from '../scene-memory.js';
import type { VisionEntity, VisionObservation } from '../vision.js';

function observation(entities: Partial<VisionEntity>[], extra: Partial<VisionObservation> = {}): VisionObservation {
  return {
    currentView: extra.currentView ?? 'a view',
    personVisible: extra.personVisible ?? false,
    raw: '{}',
    degraded: false,
    entities: entities.map((e) => ({
      label: e.label ?? 'Ding',
      bearingDeg: e.bearingDeg ?? 0,
      distanceEstM: e.distanceEstM ?? null,
      confidence: e.confidence ?? 0.8,
      ...(e.note ? { note: e.note } : {}),
    })),
  };
}

describe('SceneMemoryStore — relative → world bearing', () => {
  it('adds the robot yaw to the image-relative bearing', () => {
    const scene = new SceneMemoryStore('robot-1');
    scene.setYawDeg(0, 'odometry');

    scene.merge(observation([{ label: 'table', bearingDeg: 30 }]));

    expect(scene.get('table')?.bearingDeg).toBe(30);
  });

  it('converts correctly from a non-zero heading', () => {
    const scene = new SceneMemoryStore('robot-1');
    scene.setYawDeg(90, 'odometry');

    scene.merge(observation([{ label: 'chair', bearingDeg: -45 }]));

    expect(scene.get('chair')?.bearingDeg).toBe(45);
  });

  it('normalizes the sum into (-180, 180]', () => {
    const scene = new SceneMemoryStore('robot-1');
    scene.setYawDeg(170, 'odometry');

    scene.merge(observation([{ label: 'shelf', bearingDeg: 30 }]));

    expect(scene.get('shelf')?.bearingDeg).toBe(-160);
  });

  it('maps a full scan_room sweep onto four distinct world bearings', () => {
    const scene = new SceneMemoryStore('robot-1');
    // Four steps of 90°, each seeing one object dead ahead (relative 0°).
    const sweep: Array<[number, string]> = [
      [0, 'table'],
      [90, 'chair'],
      [180, 'shelf'],
      [270, 'door'],
    ];

    for (const [yaw, label] of sweep) {
      scene.setYawDeg(yaw, 'dead-reckoning');
      scene.merge(observation([{ label, bearingDeg: 0, distanceEstM: 2 }]));
    }

    const byLabel = Object.fromEntries(scene.listEntities().map((e) => [e.label, e.bearingDeg]));
    expect(byLabel).toEqual({ table: 0, chair: 90, shelf: 180, door: -90 });
    // Sorted by bearing, so the sweep reads as a map, not as insertion order.
    expect(scene.listEntities().map((e) => e.label)).toEqual(['door', 'table', 'chair', 'shelf']);
  });

  it('honours a per-observation yaw override without moving the stored heading', () => {
    const scene = new SceneMemoryStore('robot-1');
    scene.setYawDeg(0, 'odometry');

    scene.merge(observation([{ label: 'hat', bearingDeg: 10 }]), 45);

    expect(scene.get('hat')?.bearingDeg).toBe(55);
    expect(scene.getYawDeg()).toBe(0);
  });

  it('integrates commanded turns into a dead-reckoned heading', () => {
    const scene = new SceneMemoryStore('robot-1');
    scene.advanceYawDeg(120);
    scene.advanceYawDeg(120);
    scene.advanceYawDeg(120);
    expect(scene.getYawDeg()).toBe(0);
  });
});

describe('SceneMemoryStore — merge by label', () => {
  it('updates an existing entity instead of appending a duplicate', () => {
    const scene = new SceneMemoryStore('robot-1');
    scene.setYawDeg(0, 'odometry');
    scene.merge(observation([{ label: 'table', bearingDeg: 30, distanceEstM: 3, confidence: 0.6 }]));

    scene.setYawDeg(30, 'odometry');
    scene.merge(observation([{ label: 'table', bearingDeg: 0, distanceEstM: 2, confidence: 0.9 }]));

    const entities = scene.listEntities();
    expect(entities).toHaveLength(1);
    expect(entities[0]).toMatchObject({ bearingDeg: 30, distanceEstM: 2, confidence: 0.9 });
  });

  it('matches case-insensitively and keeps the first-seen label spelling', () => {
    const scene = new SceneMemoryStore('robot-1');
    scene.merge(observation([{ label: 'table' }]));
    scene.merge(observation([{ label: 'TABLE', distanceEstM: 1.5 }]));

    expect(scene.listEntities()).toHaveLength(1);
    expect(scene.listEntities()[0].label).toBe('table');
    expect(scene.get('table')?.distanceEstM).toBe(1.5);
  });

  it('resolves a descriptive lookup to the known entity', () => {
    const scene = new SceneMemoryStore('robot-1');
    scene.merge(observation([{ label: 'table', bearingDeg: 20 }]));

    expect(scene.get('table with the hat')?.label).toBe('table');
    expect(scene.get('Sofa')).toBeUndefined();
  });

  it('resolves a descriptive lookup to the MOST specific entity, whatever the sighting order', () => {
    // "table with the hat" contains both "table" and "hat". Returning the first
    // substring match meant the target was decided by the order the vision
    // model happened to mention things — and `goto` then walks the robot to it.
    const hatFirst = new SceneMemoryStore('robot-1');
    hatFirst.merge(observation([{ label: 'hat', bearingDeg: -40 }]));
    hatFirst.merge(observation([{ label: 'table', bearingDeg: 20 }]));

    const tableFirst = new SceneMemoryStore('robot-1');
    tableFirst.merge(observation([{ label: 'table', bearingDeg: 20 }]));
    tableFirst.merge(observation([{ label: 'hat', bearingDeg: -40 }]));

    // "table" (5) is longer than "hat" (3), so it accounts for more of the
    // request — and both orders must agree.
    expect(hatFirst.get('table with the hat')?.label).toBe('table');
    expect(tableFirst.get('table with the hat')?.label).toBe('table');
  });

  it('falls back to the narrowest entity that contains the needle', () => {
    // The planner asks for "shelf"; the vision model called it something longer.
    // No stored key is contained in "regal", so the widening branch runs, and
    // the least-extra match must win rather than the first one seen.
    const scene = new SceneMemoryStore('robot-1');
    scene.merge(observation([{ label: 'bookshelfbrett', bearingDeg: 5 }]));
    scene.merge(observation([{ label: 'bookshelf', bearingDeg: 20 }]));

    expect(scene.get('shelf')?.label).toBe('bookshelf');
    expect(scene.get('bookshelf')?.label).toBe('bookshelf');
  });

  it('carries a previous note forward when a later look omits it', () => {
    const scene = new SceneMemoryStore('robot-1');
    scene.merge(observation([{ label: 'table', note: 'a hat lies on it' }]));
    scene.merge(observation([{ label: 'table', distanceEstM: 2 }]));

    expect(scene.get('table')?.note).toBe('a hat lies on it');
  });

  it('ignores entities with an empty label', () => {
    const scene = new SceneMemoryStore('robot-1');
    scene.merge(observation([{ label: '   ' }, { label: 'chair' }]));

    expect(scene.listEntities().map((e) => e.label)).toEqual(['chair']);
  });
});

describe('SceneMemoryStore — reporting', () => {
  it('is null until the first observation', () => {
    const scene = new SceneMemoryStore('robot-1');
    expect(scene.snapshot()).toBeNull();
    expect(scene.summary()).toMatch(/empty/i);
    expect(scene.toMarkdown()).toMatch(/No observation yet/);
  });

  it('states the provenance of the heading in the markdown dump', () => {
    const scene = new SceneMemoryStore('robot-1');
    scene.setYawDeg(45, 'dead-reckoning');
    scene.merge(observation([{ label: 'table', bearingDeg: 0, distanceEstM: 2 }]));

    const md = scene.toMarkdown();
    expect(md).toContain('45° (dead-reckoning)');
    expect(md).toContain('| table | 45° | 2.0 m |');
    expect(md).toContain('world-frame');
  });

  it('propagates personVisible into the snapshot', () => {
    const scene = new SceneMemoryStore('robot-1');
    scene.merge(observation([{ label: 'Person' }], { personVisible: true }));

    expect(scene.snapshot()?.personVisible).toBe(true);
    expect(scene.isPersonVisible()).toBe(true);
  });
});
