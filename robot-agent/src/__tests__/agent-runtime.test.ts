/**
 * @file agent-runtime.test.ts
 * @description The boot ordering extracted from `index.ts`: nothing may
 *              actuate, push to the fleet mirror or decide a safety question
 *              before this process owns its port — and once it does, the crash
 *              verdict is in the controller before the idle watcher's first
 *              tick can ever run.
 *
 *              The regression this pins down: `recordBoot()` moved into the
 *              `listen()` callback while `startIdleWatcher()` stayed in the boot
 *              sequence, so for the whole pre-bind window the controller
 *              answered `isCrashAcknowledged() === true` with no verdict in it
 *              at all — a robot that came up from a `kill -9` would greet a
 *              passer-by with a real arm wave.
 * @feature agentmode
 * @status test
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createAgentRuntime,
  PORT_OWNED_STEPS,
  type AgentRuntime,
  type AgentRuntimeSteps,
  type PortOwnedStep,
} from '../agent-runtime.js';
import { AgentModeController } from '../agent-mode/agent-mode-controller.js';
import { ControlOwnerLock } from '../agent-mode/control-owner.js';
import { IncarnationLog } from '../agent-mode/incarnations.js';
import { RangeSensor } from '../agent-mode/range.js';
import type { Planner } from '../agent-mode/planner.js';
import type { ServerMirror } from '../agent-mode/server-mirror.js';
import type { VisionClient, VisionObservation } from '../agent-mode/vision.js';
import type { AgentModeEvent } from '../agent-mode/types.js';
import type { RobotStateManager } from '../robot/state.js';
import { defaultPersistedAgentState } from '../robot/StatePersistence.js';

const EMPTY_VIEW: VisionObservation = {
  currentView: 'ein leerer Raum',
  entities: [],
  personVisible: false,
  raw: '{}',
  degraded: false,
};

// ── the ordering unit ───────────────────────────────────────────────────────

/** Steps that record their own name instead of doing anything. */
function recordingSteps(overrides: Partial<AgentRuntimeSteps> = {}) {
  const calls: string[] = [];
  const steps = {} as AgentRuntimeSteps;
  for (const name of PORT_OWNED_STEPS) {
    steps[name] = () => {
      calls.push(name);
    };
  }
  steps.abandonIncarnation = (reason: string) => {
    calls.push(`abandonIncarnation:${reason}`);
  };
  return { steps: { ...steps, ...overrides }, calls };
}

/** Where each step landed, so an ordering claim reads as one comparison. */
const at = (calls: string[], step: PortOwnedStep) => calls.indexOf(step);

describe('agent runtime — the port-owned start-up order', () => {
  it('runs nothing at all until the port is owned', () => {
    const { steps, calls } = recordingSteps();
    const runtime = createAgentRuntime(steps);

    expect(calls).toEqual([]);
    expect(runtime.isPortOwned()).toBe(false);
    expect(runtime.startedSteps()).toEqual([]);
  });

  it('runs every step, in the documented order, once the port is owned', () => {
    const { steps, calls } = recordingSteps();
    const runtime = createAgentRuntime(steps);

    runtime.onPortOwned();

    expect(calls).toEqual([...PORT_OWNED_STEPS]);
    expect(runtime.startedSteps()).toEqual([...PORT_OWNED_STEPS]);
    expect(runtime.isPortOwned()).toBe(true);
  });

  it('records the incarnation FIRST, so a process that dies mid-start-up is a crash', () => {
    // Everything after this point can actuate; a process that moved the robot
    // and then died must leave an open line for the next boot to find.
    const { steps, calls } = recordingSteps();
    createAgentRuntime(steps).onPortOwned();

    expect(calls[0]).toBe('confirmIncarnation');
  });

  it('has the crash verdict in the controller before the idle watcher starts', () => {
    // The HIGH finding, as one assertion: `recordBoot()` decides
    // `isCrashAcknowledged()`, and the watcher's very first tick can greet.
    const { steps, calls } = recordingSteps();
    createAgentRuntime(steps).onPortOwned();

    expect(at(calls, 'recordBoot')).toBeLessThan(at(calls, 'startIdleWatcher'));
  });

  it('attaches the controller before it records the boot and before safety monitoring', () => {
    // attach() re-takes a latch that survived the restart and registers the
    // safety-stop listener; recordBoot() can emit the first mirror push, and a
    // push that claims no latch while one is on disk is a lying state.
    const { steps, calls } = recordingSteps();
    createAgentRuntime(steps).onPortOwned();

    expect(at(calls, 'attachController')).toBeLessThan(at(calls, 'recordBoot'));
    expect(at(calls, 'attachController')).toBeLessThan(at(calls, 'startSafetyMonitoring'));
  });

  it('re-asserts a restored E-Stop latch after attach and before the mirror hears anything', () => {
    // TASK-201: the `RobotStateManager` constructor restores such a latch in
    // MEMORY (a latched robot must refuse commands from the first instant), but
    // the sidecar `StopMove` and the durable write belong to a process that
    // owns its port. After attach() so Agent Mode's onSafetyStop listener is
    // registered when the stop fires; before recordBoot() so the first mirror
    // push describes a robot that is already stopped.
    const { steps, calls } = recordingSteps();
    createAgentRuntime(steps).onPortOwned();

    expect(at(calls, 'reassertRestoredStop')).toBeGreaterThan(at(calls, 'attachController'));
    expect(at(calls, 'reassertRestoredStop')).toBeLessThan(at(calls, 'recordBoot'));
    expect(at(calls, 'reassertRestoredStop')).toBeLessThan(at(calls, 'announceBootState'));
  });

  it('seeds the mirror after everything that changes what the state IS', () => {
    const { steps, calls } = recordingSteps();
    createAgentRuntime(steps).onPortOwned();

    expect(at(calls, 'announceBootState')).toBeGreaterThan(at(calls, 'attachController'));
    expect(at(calls, 'announceBootState')).toBeGreaterThan(at(calls, 'recordBoot'));
    expect(at(calls, 'announceBootState')).toBeLessThan(at(calls, 'startIdleWatcher'));
  });

  it('starts the idle watcher last', () => {
    const { steps, calls } = recordingSteps();
    createAgentRuntime(steps).onPortOwned();

    expect(calls.at(-1)).toBe('startIdleWatcher');
  });

  it('is idempotent — a second listen callback does not start a second robot', () => {
    const { steps, calls } = recordingSteps();
    const runtime = createAgentRuntime(steps);

    runtime.onPortOwned();
    runtime.onPortOwned();

    expect(calls).toEqual([...PORT_OWNED_STEPS]);
  });

  it('stops the sequence when a step fails, rather than running the rest on a false premise', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { steps, calls } = recordingSteps({
      recordBoot: () => {
        throw new Error('lineage unreadable');
      },
    });
    const runtime = createAgentRuntime(steps);

    expect(() => runtime.onPortOwned()).toThrow('lineage unreadable');
    // The line IS on disk (confirmIncarnation ran), so this process is read as
    // the crash it is — but nothing that actuates or greets ever started.
    expect(calls).toEqual(['confirmIncarnation', 'attachController', 'reassertRestoredStop']);
    expect(runtime.startedSteps()).toEqual([
      'confirmIncarnation',
      'attachController',
      'reassertRestoredStop',
    ]);
    error.mockRestore();
  });
});

describe('agent runtime — losing the port', () => {
  it('abandons the incarnation and runs no start-up step', () => {
    const { steps, calls } = recordingSteps();
    const runtime = createAgentRuntime(steps);

    runtime.onBindFailed('port 41246 is already in use');

    expect(calls).toEqual(['abandonIncarnation:port 41246 is already in use']);
    expect(runtime.startedSteps()).toEqual([]);
    expect(runtime.isPortOwned()).toBe(false);
  });

  it('ignores a late listen callback after the bind already failed', () => {
    const { steps, calls } = recordingSteps();
    const runtime = createAgentRuntime(steps);

    runtime.onBindFailed('EADDRINUSE');
    runtime.onPortOwned();

    expect(calls).toEqual(['abandonIncarnation:EADDRINUSE']);
    expect(runtime.isPortOwned()).toBe(false);
  });

  it('abandons only once', () => {
    const { steps, calls } = recordingSteps();
    const runtime = createAgentRuntime(steps);

    runtime.onBindFailed('EADDRINUSE');
    runtime.onBindFailed('EADDRINUSE');

    expect(calls).toHaveLength(1);
  });
});

// ── the same wiring, over the real controller and the real lineage ──────────

interface Harness {
  controller: AgentModeController;
  runtime: AgentRuntime;
  incarnations: IncarnationLog;
  lineageFile: string;
  /** Everything pushed to the server mirror, oldest first. */
  pushes: AgentModeEvent[];
  /** Whether the robot may act on its own, sampled when the watcher is armed. */
  crashAcknowledgedAtWatcherStart: boolean | null;
  /** True once the simulation loop and the safety monitor have been started. */
  actuating: () => boolean;
  /** Whether a latch restored from disk was re-asserted on the hardware. */
  restoredStopReasserted: () => boolean;
}

const tempDirs: string[] = [];
const harnesses: Harness[] = [];

afterEach(() => {
  while (harnesses.length) harnesses.pop()?.controller.stopIdleWatcher();
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** A private lineage path per test. */
function makeLineageFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-runtime-'));
  tempDirs.push(dir);
  return path.join(dir, 'incarnations.jsonl');
}

/** Crash a boot into `file`: a confirmed line that is never closed. */
function crashPreviousBoot(file: string): void {
  const log = new IncarnationLog({ robotId: 'robot-1', filePath: file });
  log.open();
  log.confirm(); // …and no close(): exactly what `kill -9` leaves behind.
}

/**
 * The real `AgentModeController` and the real `IncarnationLog`, wired through
 * the same `createAgentRuntime` call `index.ts` makes. Only the state manager,
 * the planner, the vision client and the transport are doubles.
 */
function makeHarness(opts: { lineageFile?: string; estopLatched?: boolean } = {}): Harness {
  const lineageFile = opts.lineageFile ?? makeLineageFile();
  const pushes: AgentModeEvent[] = [];
  const started = { simulation: false, safety: false, restoredStop: false };

  const controller = new AgentModeController({
    robotId: 'robot-1',
    enabled: true,
    lock: new ControlOwnerLock(),
    planner: {
      plan: async () => ({ blocks: [], fallback: false, attempts: 1 }),
    } as unknown as Planner,
    mirror: {
      emit: (event: AgentModeEvent) => pushes.push(event),
      push: async () => {},
      logBlock: async () => {},
    } as unknown as ServerMirror,
    vision: { observe: async () => EMPTY_VIEW } as unknown as VisionClient,
    range: new RangeSensor({ enabled: false }),
    memory: null,
    journal: null,
    identity: null,
    lineage: () => [],
    loco: {
      move: async () => ({ ok: true }),
      action: async () => ({ ok: true }),
      fsm: async () => ({ ok: true }),
      standHeight: async () => ({ ok: true }),
      odometry: async () => null,
    },
    sleep: async () => {},
    idleWatchIntervalMs: 2,
  });

  const stateManager = {
    triggerEmergencyStop: () => {},
    resetEmergencyStop: () => true,
    isEStopTriggered: () => false,
    isTeleopActive: () => false,
    isVLAActive: () => false,
    onSafetyStop: () => () => {},
    // The in-memory latch is taken in the constructor; THIS is the half that
    // reaches the sidecar and the state file (TASK-201).
    reassertRestoredSafetyStop: () => opts.estopLatched === true,
    getRestoredAgentState: () =>
      opts.estopLatched
        ? {
            ...defaultPersistedAgentState(),
            estopLatched: true,
            estopReason: 'E-Stop was latched when the robot last shut down',
            estopAt: '2026-08-02T07:30:00.000Z',
          }
        : null,
    setAgentSafetyState: () => {},
  } as unknown as RobotStateManager;

  const incarnations = new IncarnationLog({ robotId: 'robot-1', filePath: lineageFile });
  const incarnation = incarnations.open();

  const harness: Harness = {
    controller,
    incarnations,
    lineageFile,
    pushes,
    crashAcknowledgedAtWatcherStart: null,
    actuating: () => started.simulation && started.safety,
    restoredStopReasserted: () => started.restoredStop,
    runtime: createAgentRuntime({
      confirmIncarnation: () => incarnations.confirm(),
      attachController: () => controller.attach(stateManager),
      reassertRestoredStop: () => {
        started.restoredStop = stateManager.reassertRestoredSafetyStop();
      },
      recordBoot: () => controller.recordBoot(incarnation),
      startSimulation: () => {
        started.simulation = true;
      },
      startSafetyMonitoring: () => {
        started.safety = true;
      },
      announceBootState: () => controller.announceBootState(),
      startIdleWatcher: () => {
        // Sampled at exactly the instant the one clock that can greet is armed.
        harness.crashAcknowledgedAtWatcherStart = controller.isCrashAcknowledged();
        controller.startIdleWatcher();
      },
      abandonIncarnation: (reason: string) => incarnations.abandon(reason),
    }),
  };

  harnesses.push(harness);
  return harness;
}

const firstStatePush = (h: Harness) => h.pushes.find((p) => p.type === 'agent:state:changed');

describe('agent runtime — over the real controller', () => {
  it('pushes nothing to the fleet mirror before the port is owned, and does push after', async () => {
    const h = makeHarness();

    // The MEDIUM finding: a loser that stalled on a hung compliance POST used
    // to stamp the mirror from its idle tick and mark the robot hydrated.
    expect(h.pushes).toHaveLength(0);
    expect(h.actuating()).toBe(false);

    h.runtime.onPortOwned();

    await vi.waitFor(() => expect(firstStatePush(h)).toBeDefined());
    expect(h.actuating()).toBe(true);
  });

  it('carries the inherited crash on the FIRST mirror push', () => {
    // The pre-bind window is closed by construction, so the earliest anything
    // could ever have been said to the fleet is now — and what it says is true.
    const file = makeLineageFile();
    crashPreviousBoot(file);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = makeHarness({ lineageFile: file });
    h.runtime.onPortOwned();
    warn.mockRestore();

    expect(firstStatePush(h)?.state?.recovered).toMatchObject({ fromCrash: true });
  });

  it('refuses self-initiated motion from the instant the idle watcher is armed', () => {
    // The crash verdict is sampled INSIDE the step that starts the one clock
    // that can greet — not read afterwards, which would prove nothing about the
    // window the watcher's first tick lives in.
    const file = makeLineageFile();
    crashPreviousBoot(file);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = makeHarness({ lineageFile: file });
    h.runtime.onPortOwned();
    warn.mockRestore();

    expect(h.crashAcknowledgedAtWatcherStart).toBe(false);
  });

  it('acknowledges nothing to acknowledge after a clean previous shutdown', () => {
    // The banner must stay quiet when it should — a crash gate that is always
    // closed teaches the operator to click it away.
    const file = makeLineageFile();
    const previous = new IncarnationLog({ robotId: 'robot-1', filePath: file });
    previous.open();
    previous.confirm();
    previous.close('SIGTERM');

    const h = makeHarness({ lineageFile: file });
    h.runtime.onPortOwned();

    expect(h.crashAcknowledgedAtWatcherStart).toBe(true);
    expect(firstStatePush(h)?.state?.recovered).toBeNull();
  });

  it('reports a restored E-Stop latch on that same first push', () => {
    // attach() before recordBoot(): a seed that claimed the robot was free
    // while the SafetyMonitor refuses every command is the lying state.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = makeHarness({ estopLatched: true });
    h.runtime.onPortOwned();
    warn.mockRestore();

    expect(firstStatePush(h)?.state?.estopActive).toBe(true);
    expect(firstStatePush(h)?.state?.recovered).toMatchObject({ estopLatched: true });
  });

  it('re-asserts a restored latch on the hardware only once the port is owned', () => {
    // TASK-201, from the other end: the constructor's in-memory latch is not
    // enough for a robot that comes back stopped — the base has to be told —
    // but a candidate telling it would be telling somebody else's robot.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = makeHarness({ estopLatched: true });

    expect(h.restoredStopReasserted()).toBe(false);

    h.runtime.onPortOwned();
    warn.mockRestore();

    expect(h.restoredStopReasserted()).toBe(true);
  });

  it('re-asserts nothing when the bind fails', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = makeHarness({ estopLatched: true });

    h.runtime.onBindFailed('port 41246 is already in use');
    warn.mockRestore();

    expect(h.restoredStopReasserted()).toBe(false);
  });

  it('writes no lineage line, pushes nothing and actuates nothing when the bind fails', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = makeHarness();

    h.runtime.onBindFailed('port 41246 is already in use');
    warn.mockRestore();

    expect(fs.existsSync(h.lineageFile)).toBe(false);
    expect(h.pushes).toHaveLength(0);
    expect(h.actuating()).toBe(false);
    expect(h.crashAcknowledgedAtWatcherStart).toBeNull();
  });

  it('is still detected as a crash when the process dies AFTER the port was owned', () => {
    const h = makeHarness();
    h.runtime.onPortOwned();

    // …and now the process is killed: no `incarnations.close()`.
    const next = new IncarnationLog({ robotId: 'robot-1', filePath: h.lineageFile });
    expect(next.open().fromCrash).toBe(true);
  });

  it('is NOT a crash when the process shut down cleanly', () => {
    const h = makeHarness();
    h.runtime.onPortOwned();
    h.incarnations.close('SIGTERM', h.controller.incarnationSnapshot());

    const next = new IncarnationLog({ robotId: 'robot-1', filePath: h.lineageFile });
    expect(next.open().fromCrash).toBe(false);
  });

  it('is NOT a crash when a duplicate lost the port and died', () => {
    // Finding 2's ghost, seen from the lineage: the loser leaves no trace at
    // all, so the boot after the winner's clean exit still reads clean.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const winner = makeHarness();
    winner.runtime.onPortOwned();

    const loser = makeHarness({ lineageFile: winner.lineageFile });
    loser.runtime.onBindFailed('EADDRINUSE');
    expect(loser.pushes).toHaveLength(0);

    winner.incarnations.close('SIGTERM', winner.controller.incarnationSnapshot());
    warn.mockRestore();

    const next = new IncarnationLog({ robotId: 'robot-1', filePath: winner.lineageFile });
    expect(next.open().fromCrash).toBe(false);
    expect(next.readAll()).toHaveLength(1);
  });

  it("holds nothing open: every timer the sequence starts is unref'd", () => {
    // `shutdown()` in index.ts relies on this — a ref'd interval here is a
    // process that ignores Ctrl+C.
    const timers: NodeJS.Timeout[] = [];
    const realSetInterval = globalThis.setInterval;
    const spy = vi
      .spyOn(globalThis, 'setInterval')
      .mockImplementation(((handler: () => void, ms?: number) => {
        const timer = realSetInterval(handler, ms);
        timers.push(timer);
        return timer;
      }) as unknown as typeof globalThis.setInterval);

    const h = makeHarness();
    h.runtime.onPortOwned();
    spy.mockRestore();

    expect(timers.length).toBeGreaterThan(0);
    expect(timers.every((t) => t.hasRef() === false)).toBe(true);
  });
});
