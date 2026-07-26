/**
 * @file idle-watcher.test.ts
 * @description A person who simply stands there must be greeted exactly ONCE,
 *              not once per watch tick.
 * @feature agentmode
 * @status test
 */

import { describe, it, expect, vi } from 'vitest';
import { IdleWatcher } from '../idle-watcher.js';
import type { VisionObservation } from '../vision.js';

function observation(personVisible: boolean): VisionObservation {
  return {
    currentView: personVisible ? 'eine Person steht vor mir' : 'ein leerer Raum',
    entities: personVisible
      ? [{ label: 'Person', bearingDeg: 0, distanceEstM: 1.5, confidence: 0.9 }]
      : [],
    personVisible,
    raw: '{}',
    degraded: false,
  };
}

function makeWatcher(opts: {
  personVisible: () => boolean;
  eligible?: () => boolean;
  personAbsentMs?: number;
}) {
  let clock = 1_000_000;
  const greets: VisionObservation[] = [];
  const observe = vi.fn(async () => observation(opts.personVisible()));
  const watcher = new IdleWatcher({
    observe,
    isEligible: opts.eligible ?? (() => true),
    onPersonAppeared: (o) => greets.push(o),
    intervalMs: 3000,
    personAbsentMs: opts.personAbsentMs ?? 10_000,
    now: () => clock,
  });
  return {
    watcher,
    greets,
    observe,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe('IdleWatcher', () => {
  it('greets a person who stays in view exactly once', async () => {
    const { watcher, greets, advance } = makeWatcher({ personVisible: () => true });

    for (let i = 0; i < 10; i++) {
      await watcher.tick();
      advance(3000);
    }

    expect(greets).toHaveLength(1);
    expect(greets[0].personVisible).toBe(true);
  });

  it('does not greet an empty room', async () => {
    const { watcher, greets, advance } = makeWatcher({ personVisible: () => false });

    for (let i = 0; i < 5; i++) {
      await watcher.tick();
      advance(3000);
    }

    expect(greets).toHaveLength(0);
  });

  it('greets again only after the person has been gone long enough', async () => {
    let visible = true;
    const { watcher, greets, advance } = makeWatcher({
      personVisible: () => visible,
      personAbsentMs: 10_000,
    });

    await watcher.tick(); // greet #1
    advance(3000);
    await watcher.tick();

    // Person leaves for 4 s — shorter than the absence threshold.
    visible = false;
    advance(4000);
    await watcher.tick();
    visible = true;
    advance(3000);
    await watcher.tick();
    expect(greets).toHaveLength(1);

    // Now they are gone long enough for the next arrival to be a new person.
    visible = false;
    advance(30_000);
    await watcher.tick();
    visible = true;
    await watcher.tick();
    expect(greets).toHaveLength(2);
  });

  // Regression (finding 11): a plan (or an E-Stop latch) longer than
  // personAbsentMs used to make a stationary person look newly arrived, so the
  // robot greeted the operator who had just given it the order.
  it('does not re-greet a person who never left after a long busy stretch', async () => {
    let eligible = true;
    const { watcher, greets, advance } = makeWatcher({
      personVisible: () => true,
      eligible: () => eligible,
      personAbsentMs: 10_000,
    });

    await watcher.tick(); // greet #1
    expect(greets).toHaveLength(1);

    // "warte 20 Sekunden": the base never moves, so the person provably stays
    // in frame — but the watcher is ineligible for the whole plan.
    eligible = false;
    for (let i = 0; i < 7; i++) {
      advance(3000);
      await watcher.tick();
    }

    eligible = true;
    advance(3000);
    await watcher.tick();

    expect(greets).toHaveLength(1);
  });

  it('still greets again after an OBSERVED absence that spans a busy stretch', async () => {
    let eligible = true;
    let visible = true;
    const { watcher, greets, advance } = makeWatcher({
      personVisible: () => visible,
      eligible: () => eligible,
      personAbsentMs: 10_000,
    });

    await watcher.tick(); // greet #1
    // The person is observed leaving BEFORE the robot gets busy…
    visible = false;
    advance(3000);
    await watcher.tick();

    eligible = false;
    for (let i = 0; i < 7; i++) {
      advance(3000);
      await watcher.tick();
    }

    // …so their reappearance is a genuinely new arrival.
    eligible = true;
    visible = true;
    advance(3000);
    await watcher.tick();

    expect(greets).toHaveLength(2);
  });

  it('does nothing while the robot is not eligible (busy / e-stopped)', async () => {
    const { watcher, greets, observe, advance } = makeWatcher({
      personVisible: () => true,
      eligible: () => false,
    });

    for (let i = 0; i < 3; i++) {
      await watcher.tick();
      advance(3000);
    }

    expect(observe).not.toHaveBeenCalled();
    expect(greets).toHaveLength(0);
  });

  it('forgets the last person on reset, so a fresh session greets again', async () => {
    const { watcher, greets, advance } = makeWatcher({ personVisible: () => true });

    await watcher.tick();
    advance(3000);
    watcher.reset();
    await watcher.tick();

    expect(greets).toHaveLength(2);
  });

  it('swallows an observation failure instead of crashing the watcher', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const watcher = new IdleWatcher({
      observe: async () => {
        throw new Error('Sidecar snapshot head_camera failed: HTTP 503');
      },
      isEligible: () => true,
      onPersonAppeared: () => {
        throw new Error('must not be called');
      },
      intervalMs: 3000,
    });

    await expect(watcher.tick()).resolves.toBeUndefined();
    warn.mockRestore();
  });

  it('drops a re-entrant tick instead of queuing frames', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const observe = vi.fn(async () => {
      await gate;
      return observation(true);
    });
    const watcher = new IdleWatcher({
      observe,
      isEligible: () => true,
      onPersonAppeared: () => {},
      intervalMs: 3000,
    });

    const first = watcher.tick();
    await watcher.tick(); // dropped — the first one is still in flight
    release();
    await first;

    expect(observe).toHaveBeenCalledTimes(1);
  });
});
