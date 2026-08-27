/**
 * @file scene-memory.test.ts
 * @description Relative (image-centre) → world bearing conversion across a
 *              simulated `scan_room`, and entity merge-by-label.
 * @feature agentmode
 * @status test
 */

import { describe, it, expect } from 'vitest';
import { SceneMemoryStore } from '../scene-memory.js';
import type { ScenePlace } from '../types.js';
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

// Regression: a `goto "door"` in the four-room house walked 5.5 m past two
// doorways, turning -38°, +28°, -33° as the stored bearing jumped between them,
// and failed as "stale". The frame really did contain two doors; the store can
// only keep one; the defect was that WHICH one was decided by the order the
// vision model listed them.
describe('SceneMemoryStore — one label, several things in frame', () => {
  it('keeps the instance closest to the centre of the frame', () => {
    const scene = new SceneMemoryStore('robot-1');
    scene.setYawDeg(0, 'odometry');

    scene.merge(observation([
      { label: 'door', bearingDeg: -40 },
      { label: 'door', bearingDeg: 12 },
    ]));

    expect(scene.get('door')?.bearingDeg).toBe(12);
  });

  it('picks the same one however the model orders them', () => {
    const forwards = new SceneMemoryStore('robot-1');
    const backwards = new SceneMemoryStore('robot-1');
    const pair = [
      { label: 'door', bearingDeg: -40, distanceEstM: 1 },
      { label: 'door', bearingDeg: 12, distanceEstM: 4 },
    ];
    forwards.merge(observation(pair));
    backwards.merge(observation([...pair].reverse()));

    // The bug, stated as a test: these two differed, so the robot steered on
    // whichever door the VLM happened to mention last.
    expect(forwards.get('door')?.bearingDeg).toBe(backwards.get('door')?.bearingDeg);
  });

  it('counts one look as one observation, not one per mention', () => {
    const scene = new SceneMemoryStore('robot-1');
    scene.merge(observation([{ label: 'door', bearingDeg: 5 }]));
    const afterFirst = scene.get('door')?.observedSeq ?? 0;

    scene.merge(observation([
      { label: 'door', bearingDeg: 5 },
      { label: 'door', bearingDeg: 30 },
      { label: 'door', bearingDeg: 60 },
    ]));

    // The navigator gates "did that look find it again?" on this counter, so an
    // increment per MENTION would let a duplicated label mask a target that was
    // never actually re-seen.
    expect(scene.get('door')?.observedSeq).toBe(afterFirst + 1);
  });

  it('records how many things shared the label, and only when it is >1', () => {
    const scene = new SceneMemoryStore('robot-1');
    scene.merge(observation([
      { label: 'door', bearingDeg: 5 },
      { label: 'door', bearingDeg: 30 },
      { label: 'table', bearingDeg: 0 },
    ]));

    expect(scene.get('door')?.duplicatesInView).toBe(2);
    expect(scene.get('table')?.duplicatesInView).toBeUndefined();
  });

  it('breaks a dead-centre tie towards the nearer, known distance', () => {
    const scene = new SceneMemoryStore('robot-1');
    scene.merge(observation([
      { label: 'door', bearingDeg: 10, distanceEstM: null },
      { label: 'door', bearingDeg: -10, distanceEstM: 3 },
      { label: 'door', bearingDeg: 10, distanceEstM: 1.5 },
    ]));

    expect(scene.get('door')?.distanceEstM).toBe(1.5);
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

  it('labels an unenriched distance as the vision guess it is', () => {
    // An observation that never met the range sensor (the idle watcher, an old
    // caller) must not have its number stored as if it had been measured.
    const scene = new SceneMemoryStore('robot-1');
    scene.merge(observation([{ label: 'table', distanceEstM: 2 }, { label: 'door' }]));

    expect(scene.get('table')?.distanceSource).toBe('vlm-estimate');
    // No distance at all → no source. Never 'vlm-estimate' for a null.
    expect(scene.get('door')?.distanceSource).toBeNull();
    expect(scene.summary()).toMatch(/vision guess/);
  });

  it('carries a measured distance through with its provenance', () => {
    const scene = new SceneMemoryStore('robot-1');
    scene.merge({
      currentView: 'a table',
      personVisible: false,
      raw: '{}',
      degraded: false,
      entities: [
        {
          label: 'table',
          bearingDeg: 0,
          distanceEstM: 2.31,
          distanceSource: 'lidar',
          confidence: 0.9,
        },
      ],
    });

    expect(scene.get('table')?.distanceSource).toBe('lidar');
    expect(scene.summary()).toMatch(/2\.3 m \(lidar-measured\)/);
    expect(scene.toMarkdown()).toContain('| table | 0° | 2.3 m | lidar |');
  });

  it('drops a measured distance rather than carrying it past the next look', () => {
    // The robot has moved between the two merges. A retained 2.31 m would still
    // wear the 'lidar' label the navigator acts on, describing a pose the robot
    // is no longer in — worse than knowing nothing.
    const scene = new SceneMemoryStore('robot-1');
    scene.merge({
      currentView: 'a table',
      personVisible: false,
      raw: '{}',
      degraded: false,
      entities: [
        { label: 'table', bearingDeg: 0, distanceEstM: 2.31, distanceSource: 'lidar', confidence: 0.9 },
      ],
    });
    scene.merge(observation([{ label: 'table', bearingDeg: 0 }]));

    expect(scene.get('table')?.distanceEstM).toBeNull();
    expect(scene.get('table')?.distanceSource).toBeNull();
  });

  it('treats an unmeasured clearance as unknown and says so, rather than keeping the old one', () => {
    const scene = new SceneMemoryStore('robot-1');
    scene.merge(observation([{ label: 'table' }]), undefined, { forwardClearanceM: 1.42 });
    expect(scene.getForwardClearanceM()).toBe(1.42);
    expect(scene.snapshot()?.forwardClearanceM).toBe(1.42);
    expect(scene.summary()).toMatch(/Clear ahead: 1\.42 m/);

    // The next look measured nothing — a stale clearance is not a clearance.
    scene.merge(observation([{ label: 'table' }]));

    expect(scene.getForwardClearanceM()).toBeNull();
    expect(scene.summary()).toMatch(/does NOT mean the way is clear/);
    expect(scene.toMarkdown()).toMatch(/not the same as clear/);
  });

  it('retires the clearance once the robot turns away from the heading it measured', () => {
    // The navigator's stage is look → turn → walk. Without this, the walk down
    // the new heading would be sized by the free space down the old one.
    const scene = new SceneMemoryStore('robot-1');
    scene.merge(observation([{ label: 'table' }]), undefined, { forwardClearanceM: 1.42 });

    scene.advanceYawDeg(8); // inside the deadband — the corridor barely moved
    expect(scene.getForwardClearanceM()).toBe(1.42);

    scene.advanceYawDeg(30); // now it points somewhere else entirely
    expect(scene.getForwardClearanceM()).toBeNull();
    expect(scene.snapshot()?.forwardClearanceM).toBeNull();
    expect(scene.summary()).toMatch(/does NOT mean the way is clear/);
  });

  it('retires the clearance on a measured yaw jump too, not only on dead reckoning', () => {
    const scene = new SceneMemoryStore('robot-1');
    scene.merge(observation([{ label: 'table' }]), undefined, { forwardClearanceM: 2.0 });

    scene.setYawDeg(3, 'odometry'); // odometry noise/refresh — still the same direction
    expect(scene.getForwardClearanceM()).toBe(2.0);

    scene.setYawDeg(-90, 'odometry');
    expect(scene.getForwardClearanceM()).toBeNull();
  });

  it('keeps a clearance measured at an overridden yaw, not the store yaw', () => {
    // When a caller merges under `yawDegOverride`, the clearance must be pinned
    // to THAT heading or it expires the moment the store catches up. No
    // production caller overrides today — `BlockExecutor.observeAndMerge`
    // refreshes the store's yaw instead and passes `undefined` — so this
    // exercises the parameter's contract, not a path `scan_room` takes.
    const scene = new SceneMemoryStore('robot-1');
    scene.setYawDeg(90, 'odometry');
    scene.merge(observation([{ label: 'table' }]), 90, { forwardClearanceM: 3.3 });

    expect(scene.getForwardClearanceM()).toBe(3.3);
    scene.advanceYawDeg(45);
    expect(scene.getForwardClearanceM()).toBeNull();
  });

  it('retires the clearance AND every distance once the robot walks away from the pose that measured them', () => {
    // The 07 recording's false arrival, reduced: measure at one pose, walk 2 m,
    // and the navigator reads 0.67 m — a number about somewhere the robot no
    // longer is. Rotation had this rule from the start; translation did not.
    const scene = new SceneMemoryStore('robot-1');
    scene.merge(
      {
        currentView: 'a table',
        personVisible: false,
        raw: '{}',
        degraded: false,
        entities: [
          { label: 'table', bearingDeg: 0, distanceEstM: 0.67, distanceSource: 'lidar', confidence: 0.9 },
        ],
      },
      undefined,
      { forwardClearanceM: 0.67 }
    );

    scene.noteTranslationM(0.1); // shuffling, odometry noise — nothing has moved
    expect(scene.hasMovedSinceObservation()).toBe(false);
    expect(scene.getForwardClearanceM()).toBe(0.67);
    expect(scene.get('table')?.distanceEstM).toBe(0.67);

    scene.noteTranslationM(2.0);

    expect(scene.hasMovedSinceObservation()).toBe(true);
    expect(scene.getForwardClearanceM()).toBeNull();
    expect(scene.get('table')?.distanceEstM).toBeNull();
    // Nulled together with the number: a distance must never be left wearing
    // the label that makes the navigator act on it.
    expect(scene.get('table')?.distanceSource).toBeNull();
    expect(scene.summary()).toMatch(/does NOT mean the way is clear/);
    // The bearing survives on purpose — it is what lets `goto` aim at all, and
    // it is re-measured by the look the navigator now takes first.
    expect(scene.get('table')?.bearingDeg).toBe(0);
  });

  it('counts backwards walking as movement, and forgets it once the robot looks again', () => {
    const scene = new SceneMemoryStore('robot-1');
    scene.merge(observation([{ label: 'table' }]), undefined, { forwardClearanceM: 2.0 });

    scene.noteTranslationM(-2.0); // direction is irrelevant: it is somewhere else now
    expect(scene.hasMovedSinceObservation()).toBe(true);

    scene.merge(observation([{ label: 'table' }]), undefined, { forwardClearanceM: 4.1 });

    expect(scene.hasMovedSinceObservation()).toBe(false);
    expect(scene.getForwardClearanceM()).toBe(4.1);
  });

  it('accumulates small steps — three 0.1 m shuffles are a moved robot', () => {
    const scene = new SceneMemoryStore('robot-1');
    scene.merge(observation([{ label: 'table' }]), undefined, { forwardClearanceM: 2.0 });

    scene.noteTranslationM(0.1);
    expect(scene.getForwardClearanceM()).toBe(2.0);
    scene.noteTranslationM(0.1);
    expect(scene.getForwardClearanceM()).toBeNull();
  });

  it('ignores a non-finite translation instead of poisoning the tally', () => {
    const scene = new SceneMemoryStore('robot-1');
    scene.merge(observation([{ label: 'table' }]), undefined, { forwardClearanceM: 2.0 });

    scene.noteTranslationM(Number.NaN);

    expect(scene.hasMovedSinceObservation()).toBe(false);
    expect(scene.getForwardClearanceM()).toBe(2.0);
  });

  it('retires the distances for motion NOBODY commanded (TASK-221)', () => {
    // Teleop, a direct POST to the sidecar, a VLA rollout: the robot is two
    // metres from where it looked and no `walk` block ever ran, so the
    // commanded tally is still zero. Odometry is the only witness.
    const scene = new SceneMemoryStore('robot-1');
    scene.noteOdometryM(0, 0);
    scene.merge(observation([{ label: 'table', distanceEstM: 0.67 }]), undefined, {
      forwardClearanceM: 0.67,
    });
    expect(scene.hasMovedSinceObservation()).toBe(false);

    scene.noteOdometryM(-2, 0);

    expect(scene.hasMovedSinceObservation()).toBe(true);
    expect(scene.getForwardClearanceM()).toBeNull();
    expect(scene.get('table')?.distanceEstM).toBeNull();
    expect(scene.get('table')?.distanceSource).toBeNull();
  });

  it('never counts the same metres twice, commanded AND measured', () => {
    // One 0.1 m stage, seen by both feeds. Added together it is 0.2 m and trips
    // the 0.15 m tolerance; it is one stage of 0.1 m and must not.
    const scene = new SceneMemoryStore('robot-1');
    scene.noteOdometryM(0, 0);
    scene.merge(observation([{ label: 'table' }]), undefined, { forwardClearanceM: 2.0 });

    scene.noteTranslationM(0.1); // what `driveFor` commanded
    scene.noteOdometryM(0.1, 0); // what `refreshYaw` then measured

    expect(scene.hasMovedSinceObservation()).toBe(false);
    expect(scene.getForwardClearanceM()).toBe(2.0);
  });

  it('takes the LARGER of the two accounts, so a base that fell short still counts', () => {
    // Commanded 1.0 m, achieved 0.30 m: the store must not quietly believe the
    // measurement and keep a metre that was measured before the stage.
    const scene = new SceneMemoryStore('robot-1');
    scene.noteOdometryM(0, 0);
    scene.merge(observation([{ label: 'table' }]), undefined, { forwardClearanceM: 2.0 });

    scene.noteTranslationM(1.0);
    scene.noteOdometryM(0.3, 0);

    expect(scene.hasMovedSinceObservation()).toBe(true);
  });

  it('does not walk a STANDING robot away from its own memory on odometry jitter', () => {
    // The reason the odometry side is a high-water mark and not a running sum:
    // |delta| is unsigned, so fifty centimetre-scale wobbles would add up to
    // half a metre of imaginary travel and null every distance the robot holds.
    const scene = new SceneMemoryStore('robot-1');
    scene.noteOdometryM(0, 0);
    scene.merge(observation([{ label: 'table' }]), undefined, { forwardClearanceM: 2.0 });

    for (let i = 0; i < 50; i++) scene.noteOdometryM(i % 2 === 0 ? 0.01 : -0.01, 0);

    expect(scene.hasMovedSinceObservation()).toBe(false);
    expect(scene.getForwardClearanceM()).toBe(2.0);
  });

  it('reads a fix that is merely OLD as no further motion', () => {
    // Two feeds, one unordered stream: `refreshYaw` reads `/loco/odom` fresh
    // while the controller's pose poll hands over a 2 s cache. The cached one
    // arriving second is the robot being where it already was, not the robot
    // walking back — summed it would be 0.2 m and would trip the tolerance.
    const scene = new SceneMemoryStore('robot-1');
    scene.noteOdometryM(0, 0);
    scene.merge(observation([{ label: 'table' }]), undefined, { forwardClearanceM: 2.0 });

    scene.noteOdometryM(0.1, 0); // fresh
    scene.noteOdometryM(0, 0); // the poll's cache, one read behind

    expect(scene.hasMovedSinceObservation()).toBe(false);
    expect(scene.getForwardClearanceM()).toBe(2.0);
  });

  it('re-opens the odometry window where the robot looked from', () => {
    const scene = new SceneMemoryStore('robot-1');
    scene.noteOdometryM(0, 0);
    scene.merge(observation([{ label: 'table' }]), undefined, { forwardClearanceM: 2.0 });

    scene.noteOdometryM(2, 0);
    expect(scene.hasMovedSinceObservation()).toBe(true);

    // Looked again from where it now stands, so the two metres are spent…
    scene.merge(observation([{ label: 'table' }]), undefined, { forwardClearanceM: 4.1 });
    expect(scene.hasMovedSinceObservation()).toBe(false);

    // …and the very next fix, from that same spot, must not re-spend them.
    scene.noteOdometryM(2, 0);
    expect(scene.hasMovedSinceObservation()).toBe(false);
    expect(scene.getForwardClearanceM()).toBe(4.1);
  });

  it('treats the FIRST fix as a reference point, not as a journey', () => {
    // Odometry coordinates are metres from an arbitrary origin. A robot that
    // happens to stand at (9, 0) has not walked nine metres — and the ordinary
    // order of events puts that first fix BEFORE the first look, because
    // `observeAndMerge` refreshes the yaw (and with it the position) on its way
    // into every merge.
    const scene = new SceneMemoryStore('robot-1');
    scene.noteOdometryM(9, 0);
    scene.merge(observation([{ label: 'table' }]), undefined, { forwardClearanceM: 2.0 });

    scene.noteOdometryM(9.05, 0);

    expect(scene.hasMovedSinceObservation()).toBe(false);
    expect(scene.getForwardClearanceM()).toBe(2.0);
  });

  it('calls a window that opened with NO fix behind it unmeasured, not zero', () => {
    // TASK-221 review. `/loco/odom` has a 2 s timeout and returns null on any
    // hiccup, which is routine and not a fault: `refreshYaw` then hands the
    // store nothing and the look is merged with no anchor. Odometry comes back,
    // the base is pushed four metres with nobody holding the lock, and the
    // first fix to land describes where the robot IS — it says nothing about
    // where it LOOKED FROM. Adopting it as the anchor called that gap zero and
    // expired nothing, and `goto` answered "Arrived at table after 0 stages".
    const scene = new SceneMemoryStore('robot-1');
    scene.merge(observation([{ label: 'table', distanceEstM: 0.55 }]), undefined, {
      forwardClearanceM: 0.55,
    });
    expect(scene.hasMovedSinceObservation()).toBe(false);

    scene.noteOdometryM(4, 0);

    expect(scene.hasMovedSinceObservation()).toBe(true);
    expect(scene.get('table')?.distanceEstM).toBeNull();
    expect(scene.get('table')?.distanceSource).toBeNull();
    expect(scene.getForwardClearanceM()).toBeNull();
  });

  it('keeps saying so until the robot looks again from a pose it knows', () => {
    // The gap stays unmeasured however many fixes follow: the store still never
    // learned the looking pose. Only a fresh look re-opens the window, and one
    // look is all it takes.
    const scene = new SceneMemoryStore('robot-1');
    scene.merge(observation([{ label: 'table', distanceEstM: 0.55 }]), undefined, {
      forwardClearanceM: 0.55,
    });

    scene.noteOdometryM(4, 0);
    scene.noteOdometryM(4, 0);
    scene.noteOdometryM(4.01, 0);
    expect(scene.hasMovedSinceObservation()).toBe(true);

    scene.merge(observation([{ label: 'table', distanceEstM: 4.4 }]), undefined, {
      forwardClearanceM: 4.4,
    });

    expect(scene.hasMovedSinceObservation()).toBe(false);
    expect(scene.getForwardClearanceM()).toBe(4.4);
  });

  it('does not anchor a look on a fix from BEFORE the odometry outage', () => {
    // TASK-221 N1, and the same user-visible failure as the two tests above by
    // a route they do not cover. `lastOdomM` is never nulled once set, so
    // `merge()` re-anchoring on it unconditionally made every window after the
    // store's FIRST fix look measured — including one that `/loco/odom` said
    // nothing across. The `odomFromAnchorM` high-water mark absorbs most
    // orderings of that; it does not absorb the robot coming back near the
    // stale anchor, which is exactly what a shove out and back does.
    const scene = new SceneMemoryStore('robot-1');
    scene.noteOdometryM(0, 0);
    // Look A, correctly anchored at (0, 0).
    scene.merge(observation([{ label: 'table', distanceEstM: 4.55 }]), undefined, {
      forwardClearanceM: 4.55,
    });
    expect(scene.hasMovedSinceObservation()).toBe(false);

    // `/loco/odom` starts timing out, so no fix reaches the store from here.
    // The base is shoved to (4, 0) with nobody holding the control lock and
    // look B is merged there: its anchor must not silently stay (0, 0).
    scene.merge(observation([{ label: 'table', distanceEstM: 0.55 }]), undefined, {
      forwardClearanceM: 0.55,
    });

    // Shoved back, and odometry recovers reporting where it left off. Measured
    // from the stale anchor that is zero displacement, and `goto` answered
    // `Arrived at "table" after 0 stages` with the table 4.55 m away.
    scene.noteOdometryM(0, 0);

    expect(scene.hasMovedSinceObservation()).toBe(true);
    expect(scene.get('table')?.distanceEstM).toBeNull();
    expect(scene.get('table')?.distanceSource).toBeNull();
    expect(scene.getForwardClearanceM()).toBeNull();
  });

  it('re-anchors a look that DID have a fresh fix behind it, mid-run', () => {
    // The other side of the same rule: the outage rule must not cost a look its
    // anchor whenever one happens to have been anchorless earlier. A fix
    // arrived since the last window opened, so this look anchors where the
    // robot stands and the metres before it are spent.
    const scene = new SceneMemoryStore('robot-1');
    scene.noteOdometryM(0, 0);
    scene.merge(observation([{ label: 'table' }]), undefined, { forwardClearanceM: 6.0 });

    scene.merge(observation([{ label: 'table' }]), undefined, { forwardClearanceM: 4.0 }); // no fix: anchorless
    scene.noteOdometryM(2, 0); // odometry is back — that window was unmeasured
    expect(scene.hasMovedSinceObservation()).toBe(true);

    scene.merge(observation([{ label: 'table' }]), undefined, { forwardClearanceM: 2.0 });

    expect(scene.hasMovedSinceObservation()).toBe(false);
    expect(scene.getForwardClearanceM()).toBe(2.0);
    // And the window really is open at (2, 0), not merely un-flagged.
    scene.noteOdometryM(2.05, 0);
    expect(scene.hasMovedSinceObservation()).toBe(false);
    scene.noteOdometryM(4, 0);
    expect(scene.hasMovedSinceObservation()).toBe(true);
  });

  it('does not invent a gap for a robot whose odometry never answers at all', () => {
    // The other half of the same rule, and the reason the verdict waits for a
    // fix instead of being pronounced at the merge. A sidecar with no
    // `/loco/odom` feeds this store nothing, ever; it must behave exactly as it
    // did before odometry existed — commanded metres and nothing else — rather
    // than declaring every window unmeasured and taxing every `goto` a look.
    const scene = new SceneMemoryStore('robot-1');
    scene.merge(observation([{ label: 'table', distanceEstM: 0.55 }]), undefined, {
      forwardClearanceM: 0.55,
    });

    expect(scene.hasMovedSinceObservation()).toBe(false);
    scene.noteTranslationM(0.05);
    expect(scene.hasMovedSinceObservation()).toBe(false);
    expect(scene.getForwardClearanceM()).toBe(0.55);
  });

  it('does not pronounce a mid-run window unmeasured at the merge itself', () => {
    // The deliberate half of the design, and it now has to hold at any point in
    // a store's life rather than only before the first fix: opening a window
    // with no fix behind it is not the same as knowing the robot moved
    // unwatched. Declaring it at the merge would make a robot whose
    // `/loco/odom` has gone away for good permanently "moved" — a look before
    // every `goto`, and every distance nulled by the first commanded
    // centimetre. The verdict waits for a fix, because that fix is what proves
    // odometry was alive and still said nothing across the window.
    const scene = new SceneMemoryStore('robot-1');
    scene.noteOdometryM(0, 0);
    scene.merge(observation([{ label: 'table' }]), undefined, { forwardClearanceM: 2.0 });

    // Odometry goes away and never comes back. This look is anchorless.
    scene.merge(observation([{ label: 'table' }]), undefined, { forwardClearanceM: 2.0 });

    expect(scene.hasMovedSinceObservation()).toBe(false);
    scene.noteTranslationM(0.05);
    expect(scene.hasMovedSinceObservation()).toBe(false);
    expect(scene.getForwardClearanceM()).toBe(2.0);

    // …and the commanded account still works on its own, exactly as it did
    // before odometry fed this store at all.
    scene.noteTranslationM(1.0);
    expect(scene.hasMovedSinceObservation()).toBe(true);
  });

  it('does not call the gap unmeasured when there is nothing observed to measure', () => {
    // A fix arriving before the robot has ever looked — at boot, or after
    // `clear()` — has no window to fall outside of. Nothing to expire, and no
    // reason to send the navigator looking.
    const scene = new SceneMemoryStore('robot-1');
    scene.noteOdometryM(9, 0);
    expect(scene.hasMovedSinceObservation()).toBe(false);

    scene.merge(observation([{ label: 'table' }]), undefined, { forwardClearanceM: 2.0 });

    expect(scene.hasMovedSinceObservation()).toBe(false);
    expect(scene.getForwardClearanceM()).toBe(2.0);
  });

  it('ignores a non-finite fix instead of poisoning the anchor', () => {
    const scene = new SceneMemoryStore('robot-1');
    scene.noteOdometryM(0, 0);
    scene.merge(observation([{ label: 'table' }]), undefined, { forwardClearanceM: 2.0 });

    scene.noteOdometryM(Number.NaN, 0);
    scene.noteOdometryM(0.05, 0);

    expect(scene.hasMovedSinceObservation()).toBe(false);
    expect(scene.getForwardClearanceM()).toBe(2.0);
  });

  it('propagates personVisible into the snapshot', () => {
    const scene = new SceneMemoryStore('robot-1');
    scene.merge(observation([{ label: 'Person' }], { personVisible: true }));

    expect(scene.snapshot()?.personVisible).toBe(true);
    expect(scene.isPersonVisible()).toBe(true);
  });
});

describe('SceneMemoryStore — pose and place (TASK-195)', () => {
  const aisle3: ScenePlace = {
    id: 'AISLE-3',
    name: 'Aisle 3',
    placeType: 'aisle',
    confidence: 'confident',
    source: 'surveyed',
  };

  it('records the pose source verbatim, exactly as setYawDeg does', () => {
    const scene = new SceneMemoryStore('robot-1');
    scene.setPoseM(1.5, -2.25, 'odometry');

    expect(scene.getPoseM()).toEqual({ x: 1.5, y: -2.25 });
    expect(scene.getPoseSource()).toBe('odometry');
  });

  it('clearPoseM leaves NO coordinates behind', () => {
    const scene = new SceneMemoryStore('robot-1');
    scene.setPoseM(1.5, -2.25, 'odometry');
    scene.clearPoseM();

    expect(scene.getPoseM()).toBeNull();
    expect(scene.getPoseSource()).toBeNull();
  });

  it('treats a non-finite pose as no pose', () => {
    const scene = new SceneMemoryStore('robot-1');
    scene.setPoseM(1.5, -2.25, 'odometry');
    scene.setPoseM(Number.NaN, 0, 'odometry');

    expect(scene.getPoseM()).toBeNull();
  });

  it('puts the place line at the top of summary(), before any observation', () => {
    const scene = new SceneMemoryStore('robot-1');
    scene.setPoseM(9, 0, 'odometry');
    scene.setPlace(aisle3, 3.2);

    const first = scene.summary().split('\n')[0];
    expect(first).toBe('You are in AISLE-3 (surveyed map; pose from odometry, 3.2 m since last anchor).');
  });

  it('keeps the place line after a merge', () => {
    const scene = new SceneMemoryStore('robot-1');
    scene.setPoseM(9, 0, 'odometry');
    scene.setPlace(aisle3, 3.2);
    scene.merge(observation([{ label: 'rack' }]));

    expect(scene.summary().split('\n')[0]).toContain('You are in AISLE-3');
    expect(scene.summary()).toContain('Current view:');
  });

  it('says "Place unknown — no pose." rather than the last place', () => {
    const scene = new SceneMemoryStore('robot-1');
    scene.setPoseM(9, 0, 'odometry');
    scene.setPlace(aisle3, 3.2);
    // The pose feed lost it — both halves must go.
    scene.clearPoseM();
    scene.setPlace(null);

    expect(scene.summary()).toContain('Place unknown — no pose.');
    expect(scene.summary()).not.toContain('AISLE-3');
    expect(scene.toMarkdown()).toContain('Place unknown — no pose.');
    expect(scene.toMarkdown()).not.toContain('AISLE-3');
  });

  it('distinguishes "no pose" from "pose is not on the map"', () => {
    const scene = new SceneMemoryStore('robot-1');
    scene.setPoseM(0, -5.9, 'odometry');
    scene.setPlace(null);

    expect(scene.summary()).toContain('Place unknown — the pose is not inside any mapped place.');
  });

  it('flags a stale belief instead of quietly presenting it as current', () => {
    const scene = new SceneMemoryStore('robot-1');
    scene.setPoseM(9, 0, 'odometry');
    scene.setPlace({ ...aisle3, confidence: 'stale' }, 21.4);

    expect(scene.summary()).toContain('STALE');
  });

  it('renders the place line in toMarkdown() with no observation yet', () => {
    const scene = new SceneMemoryStore('robot-1');
    scene.setPoseM(9, 0, 'odometry');
    scene.setPlace(aisle3, 3.2);

    const md = scene.toMarkdown();
    expect(md).toContain('You are in AISLE-3');
    expect(md).toContain('_No observation yet');
    expect(md).toContain('(9.00, 0.00) m (odometry)');
  });

  it('carries the place onto the snapshot wire shape', () => {
    const scene = new SceneMemoryStore('robot-1');
    scene.setPlace(aisle3, 0);
    scene.merge(observation([{ label: 'rack' }]));

    expect(scene.snapshot()?.place).toEqual(aisle3);
  });

  it('adds exactly ONE line to the planner prompt', () => {
    const withPlace = new SceneMemoryStore('robot-1');
    withPlace.setPoseM(9, 0, 'odometry');
    withPlace.setPlace(aisle3, 3.2);
    withPlace.merge(observation([{ label: 'rack' }]));

    const without = new SceneMemoryStore('robot-1');
    without.merge(observation([{ label: 'rack' }]));

    // The prompt-length regression gate: place costs one line, not a paragraph.
    expect(withPlace.summary().split('\n').length).toBe(without.summary().split('\n').length);
  });

  it('keeps pose and place across clear() — where the robot stands is not an observation', () => {
    const scene = new SceneMemoryStore('robot-1');
    scene.setPoseM(9, 0, 'odometry');
    scene.setPlace(aisle3, 3.2);
    scene.merge(observation([{ label: 'rack' }]));

    scene.clear();

    expect(scene.getPlace()).toEqual(aisle3);
    expect(scene.getPoseM()).toEqual({ x: 9, y: 0 });
  });
});
