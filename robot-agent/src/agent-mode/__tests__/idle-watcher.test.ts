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

  // TASK-199: the watcher is the ONE idle clock. A check registered here must
  // inherit every guard the person watch already has.
  describe('checks[]', () => {
    it('runs each check before the vision call', async () => {
      const order: string[] = [];
      const watcher = new IdleWatcher({
        observe: async () => {
          order.push('observe');
          return observation(false);
        },
        isEligible: () => true,
        onPersonAppeared: () => {},
        checks: [
          { name: 'a', run: () => void order.push('a') },
          { name: 'b', run: () => void order.push('b') },
        ],
        intervalMs: 3000,
      });

      await watcher.tick();

      expect(order).toEqual(['a', 'b', 'observe']);
    });

    it('does not run a check while the robot is ineligible', async () => {
      const run = vi.fn();
      const watcher = new IdleWatcher({
        observe: async () => observation(false),
        isEligible: () => false,
        onPersonAppeared: () => {},
        checks: [{ name: 'heartbeat', run }],
        intervalMs: 3000,
      });

      await watcher.tick();

      expect(run).not.toHaveBeenCalled();
    });

    it('skips the vision call when a check took control', async () => {
      // The heartbeat's tier-1 plan starts inside `run()`. Spending a VLM
      // round-trip on a frame the watcher can no longer act on is pure waste.
      let eligible = true;
      const observe = vi.fn(async () => observation(true));
      const watcher = new IdleWatcher({
        observe,
        isEligible: () => eligible,
        onPersonAppeared: () => {},
        checks: [
          {
            name: 'heartbeat',
            run: () => {
              eligible = false;
            },
          },
        ],
        intervalMs: 3000,
      });

      await watcher.tick();

      expect(observe).not.toHaveBeenCalled();
    });

    it('keeps greeting when a check throws', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const greets: VisionObservation[] = [];
      const watcher = new IdleWatcher({
        observe: async () => observation(true),
        isEligible: () => true,
        onPersonAppeared: (o) => greets.push(o),
        checks: [
          {
            name: 'broken',
            run: () => {
              throw new Error('predicate blew up');
            },
          },
        ],
        intervalMs: 3000,
      });

      await watcher.tick();

      expect(greets).toHaveLength(1);
      warn.mockRestore();
    });

    // TASK-200: the mirror re-push has to happen precisely WHILE the robot is
    // busy or latched, which is when `checks[]` is skipped.
    it('runs an alwaysCheck even while the robot is ineligible', async () => {
      const always = vi.fn();
      const eligibleOnly = vi.fn();
      const observe = vi.fn(async () => observation(false));
      const watcher = new IdleWatcher({
        observe,
        isEligible: () => false,
        onPersonAppeared: () => {},
        checks: [{ name: 'heartbeat', run: eligibleOnly }],
        alwaysChecks: [{ name: 'mirror-state', run: always }],
        intervalMs: 3000,
      });

      await watcher.tick();
      await watcher.tick();

      expect(always).toHaveBeenCalledTimes(2);
      // …and it changes nothing about what the gate still forbids.
      expect(eligibleOnly).not.toHaveBeenCalled();
      expect(observe).not.toHaveBeenCalled();
    });

    it('runs alwaysChecks before the eligibility gate and before checks[]', async () => {
      const order: string[] = [];
      const watcher = new IdleWatcher({
        observe: async () => {
          order.push('observe');
          return observation(false);
        },
        isEligible: () => true,
        onPersonAppeared: () => {},
        checks: [{ name: 'heartbeat', run: () => void order.push('heartbeat') }],
        alwaysChecks: [{ name: 'mirror-state', run: () => void order.push('mirror') }],
        intervalMs: 3000,
      });

      await watcher.tick();

      expect(order).toEqual(['mirror', 'heartbeat', 'observe']);
    });

    it('keeps the tick alive when an alwaysCheck throws', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const greets: VisionObservation[] = [];
      const watcher = new IdleWatcher({
        observe: async () => observation(true),
        isEligible: () => true,
        onPersonAppeared: (o) => greets.push(o),
        alwaysChecks: [
          {
            name: 'mirror-state',
            run: () => {
              throw new Error('server down');
            },
          },
        ],
        intervalMs: 3000,
      });

      await expect(watcher.tick()).resolves.toBeUndefined();
      expect(greets).toHaveLength(1);
      warn.mockRestore();
    });

    it('does not re-enter an alwaysCheck that is still in flight', async () => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const run = vi.fn(async () => {
        await gate;
      });
      const watcher = new IdleWatcher({
        observe: async () => observation(false),
        // Ineligible: this used to be the path that skipped the re-entrancy
        // guard entirely, because `ticking` was only set after the gate.
        isEligible: () => false,
        onPersonAppeared: () => {},
        alwaysChecks: [{ name: 'mirror-state', run }],
        intervalMs: 3000,
      });

      const first = watcher.tick();
      await watcher.tick();
      release();
      await first;

      expect(run).toHaveBeenCalledTimes(1);
    });

    // A reviewer's find, and the one that mattered: the always-checks used to
    // sit INSIDE the whole-tick guard. `observe()` is a VLM call with no
    // timeout anywhere in its stack, so one hung request left `ticking` true
    // forever — the clock went on firing, every tick returned at the guard, and
    // the state re-assertion never happened again. The mirror then serves the
    // dead process's snapshot indefinitely: exactly what the re-push exists to
    // bound, defeated by the guard meant to protect it.
    it('keeps re-asserting while a hung observe() holds the tick', async () => {
      const always = vi.fn();
      let observeStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        observeStarted = resolve;
      });
      const watcher = new IdleWatcher({
        // Never settles — Ollama queued behind another workload on the GPU.
        observe: () => {
          observeStarted();
          return new Promise<VisionObservation>(() => {});
        },
        isEligible: () => true,
        onPersonAppeared: () => {},
        alwaysChecks: [{ name: 'mirror-state', run: always }],
        intervalMs: 3000,
      });

      void watcher.tick(); // hangs inside observe() and never returns
      await started;
      expect(always).toHaveBeenCalledTimes(1);

      await watcher.tick();
      await watcher.tick();

      expect(always).toHaveBeenCalledTimes(3);
    });

    it('does not make the re-push wait on a slow observe() either', async () => {
      // The non-hung version of the same thing: the effective re-push period
      // used to be max(interval, observe duration), so a 60 s round trip pushed
      // the live robot's own header past the staleness threshold.
      const order: string[] = [];
      let release!: () => void;
      let observeStarted!: () => void;
      const slow = new Promise<void>((resolve) => {
        release = resolve;
      });
      const started = new Promise<void>((resolve) => {
        observeStarted = resolve;
      });
      const watcher = new IdleWatcher({
        observe: async () => {
          order.push('observe-start');
          observeStarted();
          await slow;
          order.push('observe-end');
          return observation(false);
        },
        isEligible: () => true,
        onPersonAppeared: () => {},
        alwaysChecks: [{ name: 'mirror-state', run: () => void order.push('mirror') }],
        intervalMs: 3000,
      });

      const first = watcher.tick();
      await started; // the interval fires again while the frame is still out
      await watcher.tick();
      release();
      await first;

      // The second mirror push happened while the first observe was still out.
      expect(order).toEqual(['mirror', 'observe-start', 'mirror', 'observe-end']);
    });

    it('drops a re-entrant tick before it re-runs the checks', async () => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const run = vi.fn();
      const watcher = new IdleWatcher({
        observe: async () => {
          await gate;
          return observation(false);
        },
        isEligible: () => true,
        onPersonAppeared: () => {},
        checks: [{ name: 'heartbeat', run }],
        intervalMs: 3000,
      });

      const first = watcher.tick();
      await watcher.tick();
      release();
      await first;

      expect(run).toHaveBeenCalledTimes(1);
    });
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
