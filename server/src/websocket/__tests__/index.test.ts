/**
 * @file index.test.ts
 * @description Unit tests for the A2A WebSocket server setup (setupWebSocket),
 *   covering connection lifecycle, heartbeat, capacity limits, client message
 *   handling, backpressure/error-safe sending, and service event broadcasting.
 * @feature websocket
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
// Type-only: erased at runtime, so it does not defeat the vi.mock below.
import type { EStopEvent } from '../../services/SafetyService.js';

// ---------------------------------------------------------------------------
// Mock the `ws` module. We need:
//  - WebSocket.OPEN constant (used by safeSend readyState check)
//  - WebSocketServer that records its options and lets us emit connection/close
// ---------------------------------------------------------------------------
const wsMock = vi.hoisted(() => {
  // Require inside the hoisted block: top-level imports are not yet initialized here.
  const { EventEmitter: HoistedEmitter } = require('node:events') as typeof import('node:events');
  const OPEN = 1;
  const CLOSED = 3;

  class FakeWebSocketServer extends HoistedEmitter {
    public options: unknown;
    constructor(options: unknown) {
      super();
      this.options = options;
    }
  }

  return {
    OPEN,
    CLOSED,
    FakeWebSocketServer,
    instances: [] as FakeWebSocketServer[],
  };
});

vi.mock('ws', () => {
  return {
    WebSocketServer: vi.fn(function (this: unknown, options: unknown) {
      const inst = new wsMock.FakeWebSocketServer(options);
      wsMock.instances.push(inst);
      return inst;
    }),
    // WebSocket is used both as a type and for the OPEN static constant.
    WebSocket: { OPEN: wsMock.OPEN, CLOSED: wsMock.CLOSED },
  };
});

// ---------------------------------------------------------------------------
// Mock every service the module subscribes to. Each onXEvent registers a
// callback we can capture and invoke to drive the broadcast logic for real.
// ---------------------------------------------------------------------------
const services = vi.hoisted(() => {
  const make = () => ({ cb: undefined as undefined | ((event: unknown) => void) });
  return {
    task: make(), // conversationManager.onTaskEvent
    robot: make(), // robotManager.onRobotEvent
    alert: make(), // alertService.onAlertEvent
    process: make(), // processManager.onProcessEvent
    robotTask: make(), // taskDistributor.onTaskEvent
    estop: make(), // safetyService.onEStopEvent
    incident: make(), // incidentService.onIncidentEvent
    job: make(), // trainingJobService.onJobEvent
    dataset: make(), // datasetService.onDatasetEvent
    deployment: make(), // deploymentService.onDeploymentEvent
    agentMode: make(), // agentModeService.onAgentModeEvent
    // taskDistributor.on('robot:work_assigned' | 'robot:work_cancelled')
    distributorOn: {} as Record<string, (data: unknown) => void>,
    // teleoperationService.on('teleoperation:event')
    teleopOn: {} as Record<string, (event: unknown) => void>,
  };
});

vi.mock('../../services/ConversationManager.js', () => ({
  conversationManager: {
    onTaskEvent: vi.fn((cb: (e: unknown) => void) => { services.task.cb = cb; return () => {}; }),
  },
}));
vi.mock('../../services/RobotManager.js', () => ({
  robotManager: {
    onRobotEvent: vi.fn((cb: (e: unknown) => void) => { services.robot.cb = cb; return () => {}; }),
  },
}));
vi.mock('../../services/AlertService.js', () => ({
  alertService: {
    onAlertEvent: vi.fn((cb: (e: unknown) => void) => { services.alert.cb = cb; return () => {}; }),
  },
}));
vi.mock('../../services/ProcessManager.js', () => ({
  processManager: {
    onProcessEvent: vi.fn((cb: (e: unknown) => void) => { services.process.cb = cb; }),
  },
}));
vi.mock('../../services/TaskDistributor.js', () => ({
  taskDistributor: {
    onTaskEvent: vi.fn((cb: (e: unknown) => void) => { services.robotTask.cb = cb; }),
    on: vi.fn((event: string, cb: (data: unknown) => void) => { services.distributorOn[event] = cb; }),
  },
}));
vi.mock('../../services/SafetyService.js', () => ({
  safetyService: {
    onEStopEvent: vi.fn((cb: (e: unknown) => void) => { services.estop.cb = cb; return () => {}; }),
  },
}));
vi.mock('../../services/IncidentService.js', () => ({
  incidentService: {
    onIncidentEvent: vi.fn((cb: (e: unknown) => void) => { services.incident.cb = cb; return () => {}; }),
  },
}));
vi.mock('../../services/TrainingJobService.js', () => ({
  trainingJobService: {
    onJobEvent: vi.fn((cb: (e: unknown) => void) => { services.job.cb = cb; return () => {}; }),
  },
}));
vi.mock('../../services/DatasetService.js', () => ({
  datasetService: {
    onDatasetEvent: vi.fn((cb: (e: unknown) => void) => { services.dataset.cb = cb; return () => {}; }),
  },
}));
vi.mock('../../services/DeploymentService.js', () => ({
  deploymentService: {
    onDeploymentEvent: vi.fn((cb: (e: unknown) => void) => { services.deployment.cb = cb; return () => {}; }),
  },
}));
vi.mock('../../services/TeleoperationService.js', () => ({
  teleoperationService: {
    on: vi.fn((event: string, cb: (e: unknown) => void) => { services.teleopOn[event] = cb; }),
  },
}));
vi.mock('../../services/AgentModeService.js', () => ({
  agentModeService: {
    onAgentModeEvent: vi.fn((cb: (e: unknown) => void) => { services.agentMode.cb = cb; return () => {}; }),
  },
}));

// Multi-tenancy is read per event, so a test can switch it on (TASK-368), and
// the tenant of every entity comes from this table instead of the database.
const tenancy = vi.hoisted(() => ({
  enabled: false,
  tenants: new Map<string, string | null>(),
}));
vi.mock('../../config/features.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../config/features.js')>()),
  get MULTI_TENANCY_ENABLED() {
    return tenancy.enabled;
  },
}));
vi.mock('../tenantLookups.js', () => ({
  lookupTenant: vi.fn(async (key: string) =>
    tenancy.tenants.has(key) ? tenancy.tenants.get(key) ?? null : '\u0000unresolved'
  ),
  // TASK-414: session → robot for presence; `missing` names no session.
  lookupTeleopSessionRobot: vi.fn(async (sessionId: string) => (sessionId === 'missing' ? null : `robot-of-${sessionId}`)),
}));

import { setupWebSocket } from '../index.js';
import { WebSocketServer } from 'ws';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Build a fake client WebSocket that records sent messages and supports event emission. */
function makeClient(opts?: { readyState?: number; bufferedAmount?: number; sendThrows?: boolean }) {
  const emitter = new EventEmitter();
  const sent: string[] = [];
  const client = {
    readyState: opts?.readyState ?? wsMock.OPEN,
    bufferedAmount: opts?.bufferedAmount ?? 0,
    sent,
    // Mutable so a test can let the welcome message through and only throw later.
    throwOnSend: opts?.sendThrows ?? false,
    send: vi.fn((msg: string) => {
      if (client.throwOnSend) throw new Error('send failed');
      sent.push(msg);
    }),
    close: vi.fn(),
    terminate: vi.fn(),
    ping: vi.fn(),
    on: (event: string, listener: (...args: unknown[]) => void) => { emitter.on(event, listener); return client; },
    emit: (event: string, ...args: unknown[]) => emitter.emit(event, ...args),
    /** Clear both the send spy call log and the captured-message buffer. */
    reset: () => { client.send.mockClear(); sent.length = 0; },
  };
  return client;
}

type FakeServer = InstanceType<typeof wsMock.FakeWebSocketServer>;

/** Run setupWebSocket and return the created fake WebSocketServer instance. */
function setup(): FakeServer {
  // The http Server is passed straight through to WebSocketServer options; a stub is fine.
  setupWebSocket({ on: vi.fn() } as never);
  return wsMock.instances[wsMock.instances.length - 1] as FakeServer;
}

/** Connect a client (drains its welcome message) and return it. */
function connect(wss: FakeServer, client: ReturnType<typeof makeClient>) {
  wss.emit('connection', client);
  return client;
}

describe('setupWebSocket', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    wsMock.instances.length = 0;
    services.distributorOn = {};
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Server creation
  // -------------------------------------------------------------------------
  describe('server creation', () => {
    it('creates a noServer WebSocketServer and routes the A2A path to it (TASK-393)', () => {
      const server = { on: vi.fn() };
      setupWebSocket(server as never);
      const wss = wsMock.instances[wsMock.instances.length - 1] as FakeServer & {
        handleUpgrade?: (...args: unknown[]) => void;
      };
      expect(WebSocketServer).toHaveBeenCalledTimes(1);
      expect(wss.options).toMatchObject({ noServer: true });
      // One `upgrade` listener for the whole server: the A2A path goes to this
      // socket server, any other path is refused rather than aborted by `ws`.
      expect(server.on).toHaveBeenCalledWith('upgrade', expect.any(Function));
      const dispatch = server.on.mock.calls[0][1] as (req: unknown, socket: unknown, head: unknown) => void;
      wss.handleUpgrade = vi.fn();
      dispatch({ url: '/api/a2a/ws?x=1' }, {}, Buffer.alloc(0));
      expect(wss.handleUpgrade).toHaveBeenCalledTimes(1);
      const other = { write: vi.fn(), destroy: vi.fn(), destroyed: false };
      dispatch({ url: '/elsewhere' }, other, Buffer.alloc(0));
      expect(other.destroy).toHaveBeenCalled();
      expect(String(other.write.mock.calls[0][0])).toMatch(/^HTTP\/1.1 404/);
    });
  });

  // -------------------------------------------------------------------------
  // Connection lifecycle
  // -------------------------------------------------------------------------
  describe('connection lifecycle', () => {
    it('sends a welcome message on connect', () => {
      const wss = setup();
      const client = connect(wss, makeClient());
      expect(client.send).toHaveBeenCalledTimes(1);
      const welcome = JSON.parse(client.sent[0]);
      expect(welcome.type).toBe('connected');
      expect(welcome.message).toContain('Connected');
      expect(typeof welcome.timestamp).toBe('number');
    });

    it('rejects connections once max clients is reached', () => {
      const wss = setup();
      // Connect MAX_CLIENTS (1000) accepted clients.
      for (let i = 0; i < 1000; i++) {
        connect(wss, makeClient());
      }
      const overflow = makeClient();
      connect(wss, overflow);
      expect(overflow.close).toHaveBeenCalledWith(1013, 'Server at capacity');
      expect(overflow.send).not.toHaveBeenCalled();
    });

    it('removes a client from the set on close', () => {
      const wss = setup();
      const client = connect(wss, makeClient());
      client.emit('close');
      // After close, a broadcast should no longer reach this client.
      client.reset();
      services.alert.cb?.({ type: 'alert:created', alert: { id: 'a1' }, timestamp: 1 });
      expect(client.send).not.toHaveBeenCalled();
    });

    it('removes a client from the set on error', () => {
      const wss = setup();
      const client = connect(wss, makeClient());
      client.emit('error', new Error('boom'));
      client.reset();
      services.alert.cb?.({ type: 'alert:created', alert: { id: 'a1' }, timestamp: 1 });
      expect(client.send).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Client message handling
  // -------------------------------------------------------------------------
  describe('client message handling', () => {
    it('responds to ping with pong', () => {
      const wss = setup();
      const client = connect(wss, makeClient());
      client.reset();
      client.emit('message', Buffer.from(JSON.stringify({ type: 'ping' })));
      const reply = JSON.parse(client.sent[0]);
      expect(reply.type).toBe('pong');
      expect(typeof reply.timestamp).toBe('number');
    });

    it('responds to subscribe with subscribed', () => {
      const wss = setup();
      const client = connect(wss, makeClient());
      client.reset();
      client.emit('message', Buffer.from(JSON.stringify({ type: 'subscribe' })));
      const reply = JSON.parse(client.sent[0]);
      expect(reply.type).toBe('subscribed');
    });

    it('responds to unknown message types with an unknown reply', () => {
      const wss = setup();
      const client = connect(wss, makeClient());
      client.reset();
      client.emit('message', Buffer.from(JSON.stringify({ type: 'frobnicate' })));
      const reply = JSON.parse(client.sent[0]);
      expect(reply.type).toBe('unknown');
      expect(reply.message).toContain('frobnicate');
    });

    it('sends an error reply on invalid JSON', () => {
      const wss = setup();
      const client = connect(wss, makeClient());
      client.reset();
      client.emit('message', Buffer.from('not-json{'));
      const reply = JSON.parse(client.sent[0]);
      expect(reply.type).toBe('error');
      expect(reply.message).toBe('Invalid message format');
    });

    it('ignores non-object messages (e.g. JSON number) without replying', () => {
      const wss = setup();
      const client = connect(wss, makeClient());
      client.reset();
      client.emit('message', Buffer.from('42'));
      expect(client.send).not.toHaveBeenCalled();
    });

    it('ignores null messages without replying', () => {
      const wss = setup();
      const client = connect(wss, makeClient());
      client.reset();
      client.emit('message', Buffer.from('null'));
      expect(client.send).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Heartbeat
  // -------------------------------------------------------------------------
  describe('heartbeat', () => {
    it('pings alive clients on the heartbeat interval', () => {
      const wss = setup();
      const client = connect(wss, makeClient());
      vi.advanceTimersByTime(30000);
      expect(client.ping).toHaveBeenCalledTimes(1);
      expect(client.terminate).not.toHaveBeenCalled();
    });

    it('marks a client alive again when it responds with pong', () => {
      const wss = setup();
      const client = connect(wss, makeClient());
      // First tick: ping sent, alive set to false.
      vi.advanceTimersByTime(30000);
      // Client responds with pong -> alive true.
      client.emit('pong');
      // Second tick: should NOT terminate because it answered.
      vi.advanceTimersByTime(30000);
      expect(client.terminate).not.toHaveBeenCalled();
      expect(client.ping).toHaveBeenCalledTimes(2);
    });

    it('terminates a client that does not respond to ping', () => {
      const wss = setup();
      const client = connect(wss, makeClient());
      // First tick: ping, alive=false.
      vi.advanceTimersByTime(30000);
      // No pong. Second tick: alive is false -> terminate.
      vi.advanceTimersByTime(30000);
      expect(client.terminate).toHaveBeenCalledTimes(1);
      // After termination it is removed from the set: a broadcast won't reach it.
      client.reset();
      services.alert.cb?.({ type: 'alert:created', alert: {}, timestamp: 1 });
      expect(client.send).not.toHaveBeenCalled();
    });

    it('clears the heartbeat interval when the server closes', () => {
      const wss = setup();
      const client = connect(wss, makeClient());
      wss.emit('close');
      vi.advanceTimersByTime(60000);
      expect(client.ping).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Broadcasting + safeSend behavior
  // -------------------------------------------------------------------------
  describe('broadcasting', () => {
    it('broadcasts task events to all connected clients', () => {
      const wss = setup();
      const c1 = connect(wss, makeClient());
      const c2 = connect(wss, makeClient());
      c1.reset();
      c2.reset();

      services.task.cb?.({ taskId: 't1', status: 'running' });

      const m1 = JSON.parse(c1.sent[0]);
      const m2 = JSON.parse(c2.sent[0]);
      expect(m1.type).toBe('task_event');
      expect(m1.event).toMatchObject({ taskId: 't1', status: 'running' });
      expect(m2.type).toBe('task_event');
    });

    it('does not send to a client whose readyState is not OPEN', () => {
      const wss = setup();
      const client = connect(wss, makeClient({ readyState: wsMock.CLOSED }));
      client.reset();
      services.alert.cb?.({ type: 'alert:created', alert: {}, timestamp: 1 });
      expect(client.send).not.toHaveBeenCalled();
    });

    it('skips a backpressured client (bufferedAmount over threshold)', () => {
      const wss = setup();
      const client = connect(wss, makeClient({ bufferedAmount: 70000 }));
      client.reset();
      services.alert.cb?.({ type: 'alert:created', alert: {}, timestamp: 1 });
      expect(client.send).not.toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('backpressure'));
    });

    it('removes a client whose send throws and keeps broadcasting to others', () => {
      const wss = setup();
      const bad = connect(wss, makeClient());
      const good = connect(wss, makeClient());
      bad.reset();
      good.reset();
      // Now make `bad` start throwing on send so the broadcast hits the error path.
      bad.throwOnSend = true;

      services.alert.cb?.({ type: 'alert:created', alert: {}, timestamp: 1 });
      // good still received it
      expect(good.send).toHaveBeenCalledTimes(1);
      expect(console.error).toHaveBeenCalled();

      // bad was removed: a second broadcast should not even attempt it.
      bad.reset();
      services.alert.cb?.({ type: 'alert:created', alert: {}, timestamp: 1 });
      expect(bad.send).not.toHaveBeenCalled();
    });

    it('broadcasts robot events with type overriding the spread', () => {
      const wss = setup();
      const client = connect(wss, makeClient());
      client.reset();
      services.robot.cb?.({ type: 'robot:updated', robot: { id: 'r1' } });
      const msg = JSON.parse(client.sent[0]);
      expect(msg.type).toBe('robot:updated');
      expect(msg.robot).toEqual({ id: 'r1' });
    });

    it('broadcasts alert events with type/alert/timestamp', () => {
      const wss = setup();
      const client = connect(wss, makeClient());
      client.reset();
      services.alert.cb?.({ type: 'alert:created', alert: { id: 'a1' }, timestamp: 123 });
      const msg = JSON.parse(client.sent[0]);
      expect(msg).toEqual({ type: 'alert:created', alert: { id: 'a1' }, timestamp: 123 });
    });

    it('broadcasts process events extracting only present fields', () => {
      const wss = setup();
      const client = connect(wss, makeClient());
      client.reset();
      services.process.cb?.({ type: 'process:started', processInstance: { id: 'p1' } });
      const msg = JSON.parse(client.sent[0]);
      expect(msg.type).toBe('process:started');
      expect(msg.processInstance).toEqual({ id: 'p1' });
      // Absent optional fields are dropped by JSON.stringify (value undefined).
      expect('error' in msg).toBe(false);
    });

    it('broadcasts robot task events', () => {
      const wss = setup();
      const client = connect(wss, makeClient());
      client.reset();
      services.robotTask.cb?.({ type: 'task:progress', taskId: 'rt1', progress: 50 });
      const msg = JSON.parse(client.sent[0]);
      expect(msg.type).toBe('task:progress');
      expect(msg.taskId).toBe('rt1');
      expect(msg.progress).toBe(50);
    });

    it('broadcasts robot:work_assigned events from taskDistributor.on', () => {
      const wss = setup();
      const client = connect(wss, makeClient());
      client.reset();
      services.distributorOn['robot:work_assigned']?.({ robotId: 'r1', task: { id: 'tt' } });
      const msg = JSON.parse(client.sent[0]);
      expect(msg.type).toBe('robot:work_assigned');
      expect(msg.robotId).toBe('r1');
      expect(msg.task).toEqual({ id: 'tt' });
    });

    it('broadcasts robot:work_cancelled events from taskDistributor.on', () => {
      const wss = setup();
      const client = connect(wss, makeClient());
      client.reset();
      services.distributorOn['robot:work_cancelled']?.({ robotId: 'r1', taskId: 'tt', reason: 'preempted' });
      const msg = JSON.parse(client.sent[0]);
      expect(msg.type).toBe('robot:work_cancelled');
      expect(msg.reason).toBe('preempted');
    });

    // Driven with a real `EStopEvent` from the service's own type, not an
    // invented `{ robotId, engaged }` literal — that shape the service never
    // emits, so the old test passed no matter what went over the wire.
    it('broadcasts safety e-stop events under safety:estop', () => {
      const wss = setup();
      const client = connect(wss, makeClient());
      client.reset();

      const estopEvent: EStopEvent = {
        id: 'estop-1',
        scope: 'robot',
        action: 'trigger',
        triggeredAt: '2026-01-01T00:00:00.000Z',
        triggeredBy: 'operator',
        reason: 'obstacle detected',
        affectedRobots: ['r1'],
        result: {
          scope: 'robot',
          robotId: 'r1',
          robotName: 'Robot One',
          triggeredAt: '2026-01-01T00:00:00.000Z',
          triggeredBy: 'operator',
          reason: 'obstacle detected',
          robotResults: [{ robotId: 'r1', robotName: 'Robot One', success: true }],
          successCount: 1,
          failureCount: 0,
        },
      };

      services.estop.cb?.(estopEvent);

      const msg = JSON.parse(client.sent[0]);
      expect(msg.type).toBe('safety:estop');
      expect(msg.event).toEqual(estopEvent);
      // The trigger/reset discriminator must survive the envelope — it is what
      // the console reduces into the fleet Stop button.
      expect(msg.event.action).toBe('trigger');
    });

    it('broadcasts a reset e-stop event with its action intact', () => {
      const wss = setup();
      const client = connect(wss, makeClient());
      client.reset();

      const resetEvent: EStopEvent = {
        id: 'estop-2',
        scope: 'fleet',
        action: 'reset',
        triggeredAt: '2026-01-01T00:01:00.000Z',
        triggeredBy: 'server',
        reason: 'Fleet E-stop reset',
        affectedRobots: ['r1', 'r2'],
        result: {
          scope: 'fleet',
          triggeredAt: '2026-01-01T00:01:00.000Z',
          triggeredBy: 'server',
          reason: 'Fleet E-stop reset',
          robotResults: [
            { robotId: 'r1', robotName: 'Robot One', success: true },
            { robotId: 'r2', robotName: 'Robot Two', success: true },
          ],
          successCount: 2,
          failureCount: 0,
        },
      };

      services.estop.cb?.(resetEvent);

      const msg = JSON.parse(client.sent[0]);
      expect(msg.type).toBe('safety:estop');
      expect(msg.event.action).toBe('reset');
      expect(msg.event.affectedRobots).toEqual(['r1', 'r2']);
    });

    it('broadcasts incident events', () => {
      const wss = setup();
      const client = connect(wss, makeClient());
      client.reset();
      services.incident.cb?.({ type: 'incident:opened', incident: { id: 'i1' }, notification: { ch: 'x' }, timestamp: 7 });
      const msg = JSON.parse(client.sent[0]);
      expect(msg.type).toBe('incident:opened');
      expect(msg.incident).toEqual({ id: 'i1' });
      expect(msg.notification).toEqual({ ch: 'x' });
    });

    it('broadcasts training job events', () => {
      const wss = setup();
      const client = connect(wss, makeClient());
      client.reset();
      services.job.cb?.({ type: 'job:progress', jobId: 'j1', job: { id: 'j1' }, progress: 25, timestamp: 3 });
      const msg = JSON.parse(client.sent[0]);
      expect(msg.type).toBe('job:progress');
      expect(msg.jobId).toBe('j1');
      expect(msg.progress).toBe(25);
    });

    it('broadcasts dataset events', () => {
      const wss = setup();
      const client = connect(wss, makeClient());
      client.reset();
      services.dataset.cb?.({ type: 'dataset:imported', datasetId: 'd1', dataset: { id: 'd1' }, importProgress: 80, timestamp: 4 });
      const msg = JSON.parse(client.sent[0]);
      expect(msg.type).toBe('dataset:imported');
      expect(msg.datasetId).toBe('d1');
      expect(msg.importProgress).toBe(80);
    });

    it('broadcasts teleop progress events under teleop:session:progress', () => {
      const wss = setup();
      const client = connect(wss, makeClient());
      client.reset();
      services.teleopOn['teleoperation:event']?.({
        type: 'session:progress',
        sessionId: 's1',
        recordingProgress: { frameCount: 42, currentEpisode: 1, elapsedS: 4.2, running: true },
        timestamp: new Date(),
      });
      const msg = JSON.parse(client.sent[0]);
      expect(msg.type).toBe('teleop:session:progress');
      expect(msg.data.sessionId).toBe('s1');
      expect(msg.data.recordingProgress).toMatchObject({ frameCount: 42, currentEpisode: 1 });
    });

    it('broadcasts teleop quality warnings under teleop:quality', () => {
      const wss = setup();
      const client = connect(wss, makeClient());
      client.reset();
      services.teleopOn['teleoperation:event']?.({
        type: 'quality:warning',
        sessionId: 's1',
        qualityFeedback: { sessionId: 's1', currentSmoothnessScore: 40, isJerky: true },
        timestamp: new Date(),
      });
      const msg = JSON.parse(client.sent[0]);
      expect(msg.type).toBe('teleop:quality');
      expect(msg.data.qualityFeedback.isJerky).toBe(true);
    });

    it('broadcasts teleop completion and export events', () => {
      const wss = setup();
      const client = connect(wss, makeClient());
      client.reset();
      services.teleopOn['teleoperation:event']?.({
        type: 'session:completed',
        sessionId: 's1',
        session: { id: 's1', status: 'completed' },
        timestamp: new Date(),
      });
      services.teleopOn['teleoperation:event']?.({
        type: 'session:exported',
        sessionId: 's1',
        timestamp: new Date(),
      });
      expect(JSON.parse(client.sent[0]).type).toBe('teleop:session:completed');
      expect(JSON.parse(client.sent[0]).data.session.status).toBe('completed');
      expect(JSON.parse(client.sent[1]).type).toBe('teleop:session:exported');
    });

    it('does not broadcast teleop session:created events', () => {
      const wss = setup();
      const client = connect(wss, makeClient());
      client.reset();
      services.teleopOn['teleoperation:event']?.({
        type: 'session:created',
        sessionId: 's1',
        timestamp: new Date(),
      });
      expect(client.send).not.toHaveBeenCalled();
    });

    it('broadcasts agent mode block events under their agent: type', () => {
      const wss = setup();
      const client = connect(wss, makeClient());
      client.reset();
      services.agentMode.cb?.({
        type: 'agent:block:started',
        robotId: 'robot-001',
        plan: { id: 'plan-1', cursor: 0, status: 'running', blocks: [{ id: 'b1' }] },
        block: { id: 'b1', kind: 'walk', status: 'running' },
        timestamp: '2026-07-25T10:00:01.000Z',
      });
      const msg = JSON.parse(client.sent[0]);
      expect(msg.type).toBe('agent:block:started');
      expect(msg.robotId).toBe('robot-001');
      expect(msg.block).toEqual({ id: 'b1', kind: 'walk', status: 'running' });
      expect(msg.plan.id).toBe('plan-1');
      expect(msg.timestamp).toBe('2026-07-25T10:00:01.000Z');
      // Fields irrelevant to this event are dropped by JSON.stringify.
      expect('scene' in msg).toBe(false);
      expect('state' in msg).toBe(false);
    });

    it('broadcasts agent mode scene updates to every client', () => {
      const wss = setup();
      const c1 = connect(wss, makeClient());
      const c2 = connect(wss, makeClient());
      c1.reset();
      c2.reset();
      services.agentMode.cb?.({
        type: 'agent:scene:updated',
        robotId: 'robot-001',
        scene: { robotId: 'robot-001', currentView: 'Tisch mit Hut', entities: [], personVisible: false, updatedAt: 'x' },
        timestamp: '2026-07-25T10:00:02.000Z',
      });
      expect(JSON.parse(c1.sent[0]).scene.currentView).toBe('Tisch mit Hut');
      expect(JSON.parse(c2.sent[0]).type).toBe('agent:scene:updated');
    });

    it('broadcasts the memory digest an agent:memory:updated event carries', () => {
      // The digest is the ONLY payload of this event. Left out of the envelope
      // the app was told that durable memory changed without being told what it
      // now holds, so the MemoryPanel kept showing the previous counts.
      const wss = setup();
      const client = connect(wss, makeClient());
      client.reset();
      services.agentMode.cb?.({
        type: 'agent:memory:updated',
        robotId: 'robot-001',
        memory: { robotId: 'robot-001', place: 'AISLE-3', memoryEntries: 3, places: [] },
        timestamp: '2026-08-02T10:00:03.000Z',
      });
      const msg = JSON.parse(client.sent[0]);
      expect(msg.type).toBe('agent:memory:updated');
      expect(msg.memory.memoryEntries).toBe(3);
      // Counts, not content — the digest is fanned out to every client.
      expect(msg.memory.place).toBe('AISLE-3');
    });

    it('broadcasts deployment events with all fields', () => {
      const wss = setup();
      const client = connect(wss, makeClient());
      client.reset();
      services.deployment.cb?.({
        type: 'deployment:stage',
        deploymentId: 'dep1',
        deployment: { id: 'dep1' },
        robotId: 'r1',
        stage: 2,
        totalStages: 5,
        metrics: { latency: 10 },
        timestamp: 11,
      });
      const msg = JSON.parse(client.sent[0]);
      expect(msg.type).toBe('deployment:stage');
      expect(msg.deploymentId).toBe('dep1');
      expect(msg.stage).toBe(2);
      expect(msg.totalStages).toBe(5);
      expect(msg.metrics).toEqual({ latency: 10 });
    });
  });

  // TASK-366: with auth on, an event reaches only a socket that proved who it is.
  describe('with auth enabled', () => {
    const previous = process.env.AUTH_DISABLED;
    beforeEach(() => { process.env.AUTH_DISABLED = 'false'; });
    afterEach(() => { process.env.AUTH_DISABLED = previous; });

    it('sends nothing to an anonymous socket', () => {
      const wss = setup();
      const anonymous = connect(wss, makeClient());
      anonymous.reset();
      services.robot.cb?.({ type: 'robot_telemetry', robotId: 'r1', timestamp: 'now' });
      services.alert.cb?.({ type: 'alert:created', alert: { id: 'a1' }, timestamp: 1 });
      expect(anonymous.sent).toEqual([]);
    });

    it('starts sending once the socket authenticates in-band', async () => {
      const jwt = (await import('jsonwebtoken')).default;
      const token = jwt.sign(
        { userId: 'u1', email: 'u1@test', role: 'member', tenantId: null },
        process.env.JWT_SECRET as string
      );
      const wss = setup();
      const client = connect(wss, makeClient());
      client.emit('message', Buffer.from(JSON.stringify({ type: 'auth', token })));
      expect(JSON.parse(client.sent.at(-1) as string)).toEqual({ type: 'auth', authenticated: true });
      client.reset();
      services.alert.cb?.({ type: 'alert:created', alert: { id: 'a1' }, timestamp: 1 });
      expect(client.sent).toHaveLength(1);
    });

    it('rejects an expired token with an auth error and keeps the socket unidentified', async () => {
      const jwt = (await import('jsonwebtoken')).default;
      const token = jwt.sign(
        { userId: 'u1', email: 'u1@test', role: 'member', tenantId: null, exp: Math.floor(Date.now() / 1000) - 60 },
        process.env.JWT_SECRET as string
      );
      const wss = setup();
      const client = connect(wss, makeClient());
      client.emit('message', Buffer.from(JSON.stringify({ type: 'auth', token })));
      expect(JSON.parse(client.sent.at(-1) as string)).toEqual({
        type: 'auth',
        authenticated: false,
        error: 'invalid_token',
      });
      client.reset();
      services.alert.cb?.({ type: 'alert:created', alert: { id: 'a1' }, timestamp: 1 });
      expect(client.sent).toEqual([]);
    });
  });

  describe('with multi-tenancy on (TASK-368)', () => {
    const previous = process.env.AUTH_DISABLED;
    beforeEach(() => {
      process.env.AUTH_DISABLED = 'false';
      tenancy.enabled = true;
      tenancy.tenants = new Map<string, string | null>([
        ['robot:ra', 'tenant-a'],
        ['robot:rb', 'tenant-b'],
        ['conversation:c-a', 'tenant-a'],
        ['alert:al-a', 'tenant-a'],
        ['processInstance:p-a', 'tenant-a'],
        ['robotTask:rt-a', 'tenant-a'],
        ['incident:i-a', 'tenant-a'],
        ['trainingJob:j-a', 'tenant-a'],
        ['dataset:d-a', 'tenant-a'],
        ['digitalTwin:tw-a', 'tenant-a'],
        ['teleopSession:s-a', 'tenant-a'],
        ['deployment:dep-a', 'tenant-a'],
      ]);
    });
    afterEach(() => {
      process.env.AUTH_DISABLED = previous;
      tenancy.enabled = false;
    });

    /** Let the async tenant lookups settle. */
    const flush = async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve();
    };

    async function sockets() {
      const jwt = (await import('jsonwebtoken')).default;
      const wss = setup();
      const as = (role: string, tenantId: string | null) => {
        const client = connect(wss, makeClient());
        const token = jwt.sign(
          { userId: `${role}-${tenantId}`, email: 'u@test', role, tenantId },
          process.env.JWT_SECRET as string
        );
        client.emit('message', Buffer.from(JSON.stringify({ type: 'auth', token })));
        client.reset();
        return client;
      };
      const a = as('owner', 'tenant-a');
      const b = as('owner', 'tenant-b');
      const admin = as('super-admin', null);
      const anonymous = connect(wss, makeClient());
      anonymous.reset();
      return { a, b, admin, anonymous, all: [a, b, admin, anonymous] };
    }

    const types = (client: ReturnType<typeof makeClient>) =>
      client.sent.map((m) => (JSON.parse(m) as { type: string }).type);

    const families: Array<[string, () => void, string]> = [
      ['A2A task events', () => services.task.cb?.({ type: 'status_update', taskId: 't', contextId: 'c-a' }), 'task_event'],
      ['alerts', () => services.alert.cb?.({ type: 'alert_created', alert: { id: 'al-a', source: 'system' }, timestamp: 1 }), 'alert_created'],
      ['robot alerts', () => services.alert.cb?.({ type: 'alert_created', alert: { id: 'x', source: 'robot', sourceId: 'ra' }, timestamp: 1 }), 'alert_created'],
      ['processes', () => services.process.cb?.({ type: 'step:started', processInstanceId: 'p-a', stepInstance: {} }), 'step:started'],
      ['robot tasks', () => services.robotTask.cb?.({ type: 'task:created', task: { id: 'rt-a', robotId: null } }), 'task:created'],
      ['incidents', () => services.incident.cb?.({ type: 'incident:created', incident: { id: 'i-a' }, timestamp: 1 }), 'incident:created'],
      ['training jobs', () => services.job.cb?.({ type: 'training:job:progress', jobId: 'j-a', timestamp: 'now' }), 'training:job:progress'],
      ['datasets', () => services.dataset.cb?.({ type: 'dataset:import:progress', datasetId: 'd-a', timestamp: 'now' }), 'dataset:import:progress'],
      ['teleop', () => services.teleopOn['teleoperation:event']?.({ type: 'session:progress', sessionId: 's-a' }), 'teleop:session:progress'],
      ['deployments', () => services.deployment.cb?.({ type: 'deployment:progress', deploymentId: 'dep-a', timestamp: 'now' }), 'deployment:progress'],
      ['agent mode', () => services.agentMode.cb?.({ type: 'agent:block:started', robotId: 'ra', timestamp: 'now' }), 'agent:block:started'],
    ];

    it.each(families)('delivers %s only to the owning tenant and super-admins', async (_name, fire, type) => {
      const { a, b, admin, anonymous } = await sockets();
      fire();
      await flush();
      expect(types(a)).toEqual([type]);
      expect(types(admin)).toEqual([type]);
      expect(b.sent).toEqual([]);
      expect(anonymous.sent).toEqual([]);
    });

    it('delivers digital-twin and twin-zone events only within the twin tenant', async () => {
      const { digitalTwinService } = await import('../../services/DigitalTwinService.js');
      const { twinZoneService } = await import('../../services/TwinZoneService.js');
      const { a, b } = await sockets();
      digitalTwinService.emit('digital-twin:event', { type: 'twin:failed', twinId: 'tw-a', sessionId: 's', error: 'x', timestamp: 'now' });
      twinZoneService.emit('twin-zone:event', { type: 'twinZone:deleted', twinId: 'tw-a', zoneId: 'z', timestamp: 'now' });
      await flush();
      expect(types(a)).toEqual(['twin:failed', 'twinZone:deleted']);
      expect(b.sent).toEqual([]);
    });

    it('shows an event whose entity is gone to super-admins only', async () => {
      const { a, b, admin } = await sockets();
      services.dataset.cb?.({ type: 'dataset:deleted', datasetId: 'gone', timestamp: 'now' });
      await flush();
      expect(a.sent).toEqual([]);
      expect(b.sent).toEqual([]);
      expect(types(admin)).toEqual(['dataset:deleted']);
    });

    // TASK-375: the row of a delete event is gone and, after a restart, the
    // lookup cache holds nothing — the tenant the service read before the
    // delete routes it.
    const deletes: Array<[string, () => void, string]> = [
      ['dataset:deleted', () => services.dataset.cb?.({ type: 'dataset:deleted', datasetId: 'gone', deletedRowTenantId: 'tenant-a', timestamp: 'now' }), 'dataset:deleted'],
      ['alert_deleted', () => services.alert.cb?.({ type: 'alert_deleted', alert: { id: 'gone', source: 'system' }, deletedRowTenantId: 'tenant-a', timestamp: 1 }), 'alert_deleted'],
      ['robot_unregistered', () => services.robot.cb?.({ type: 'robot_unregistered', robotId: 'gone', deletedRowTenantId: 'tenant-a', timestamp: 'now' }), 'robot_unregistered'],
    ];

    it.each(deletes)('routes %s by the tenant it carries, with an empty tenant cache', async (_name, fire, type) => {
      const { a, b, admin, anonymous } = await sockets();
      fire();
      await flush();
      expect(types(a)).toEqual([type]);
      expect(types(admin)).toEqual([type]);
      expect(b.sent).toEqual([]);
      expect(anonymous.sent).toEqual([]);
    });

    it('prefers the carried tenant to a lookup and keeps it out of the payload', async () => {
      const { a, b } = await sockets();
      // The lookup would answer tenant-b for this robot; the row the service
      // read before deleting it said tenant-a.
      services.robot.cb?.({ type: 'robot_unregistered', robotId: 'rb', deletedRowTenantId: 'tenant-a', timestamp: 'now' });
      await flush();
      expect(types(a)).toEqual(['robot_unregistered']);
      expect(b.sent).toEqual([]);
      expect(JSON.parse(a.sent[0] as string)).not.toHaveProperty('deletedRowTenantId');
    });

    // A carried `null` is the one value that can reach beyond a key lookup
    // (a tenant-less row is visible to every tenant), so it must never stand
    // in for a key that names a tenant.
    it.each([null, 'tenant-b'])(
      'routes a robot alert_deleted by its robot, not by a carried %s',
      async (carried) => {
        const { a, b, admin, anonymous } = await sockets();
        services.alert.cb?.({
          type: 'alert_deleted',
          alert: { id: 'gone', source: 'robot', sourceId: 'ra', title: 'secret' },
          deletedRowTenantId: carried,
          timestamp: 1,
        });
        await flush();
        expect(types(a)).toEqual(['alert_deleted']);
        expect(types(admin)).toEqual(['alert_deleted']);
        expect(b.sent).toEqual([]);
        expect(anonymous.sent).toEqual([]);
      }
    );

    const nullDeletes: Array<[string, () => void, string]> = [
      ['dataset:deleted', () => services.dataset.cb?.({ type: 'dataset:deleted', datasetId: 'gone', deletedRowTenantId: null, timestamp: 'now' }), 'dataset:deleted'],
      ['alert_deleted', () => services.alert.cb?.({ type: 'alert_deleted', alert: { id: 'gone', source: 'system' }, deletedRowTenantId: null, timestamp: 1 }), 'alert_deleted'],
      ['robot_unregistered', () => services.robot.cb?.({ type: 'robot_unregistered', robotId: 'gone', deletedRowTenantId: null, timestamp: 'now' }), 'robot_unregistered'],
    ];

    // A row without a tenant: what a lookup of that row would have answered,
    // so every identified socket — still never an anonymous one.
    it.each(nullDeletes)('routes %s with a carried null like a tenant-less row', async (_name, fire, type) => {
      const { a, b, admin, anonymous } = await sockets();
      fire();
      await flush();
      expect(types(a)).toEqual([type]);
      expect(types(b)).toEqual([type]);
      expect(types(admin)).toEqual([type]);
      expect(anonymous.sent).toEqual([]);
    });

    it('gives each tenant its own robots of a cross-tenant fleet E-stop', async () => {
      const { a, b, admin } = await sockets();
      services.estop.cb?.({
        id: 'e', scope: 'fleet', action: 'trigger', triggeredAt: 'now', triggeredBy: 'root', reason: 'drill',
        affectedRobots: ['ra', 'rb'],
        result: {
          scope: 'fleet', triggeredAt: 'now', triggeredBy: 'root', reason: 'drill',
          robotResults: [
            { robotId: 'ra', robotName: 'A', success: true },
            { robotId: 'rb', robotName: 'B', success: true },
          ],
          successCount: 2, failureCount: 0,
        },
      });
      await flush();
      const robots = (client: ReturnType<typeof makeClient>) =>
        (JSON.parse(client.sent[0] as string) as { event: EStopEvent }).event.affectedRobots;
      expect(robots(a)).toEqual(['ra']);
      expect(robots(b)).toEqual(['rb']);
      expect(robots(admin)).toEqual(['ra', 'rb']);
    });
  });
  // -------------------------------------------------------------------------
  // Session presence and the operator relay (TASK-414)
  // -------------------------------------------------------------------------
  describe('session presence and the operator relay (TASK-414)', () => {
    const flush = async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve();
    };
    const say = (client: ReturnType<typeof makeClient>, body: unknown) =>
      client.emit('message', Buffer.from(JSON.stringify(body)));
    const messages = (client: ReturnType<typeof makeClient>) =>
      client.sent.map((m) => JSON.parse(m) as { type: string; data?: Record<string, unknown>; error?: string });
    const ofType = (client: ReturnType<typeof makeClient>, type: string) => messages(client).filter((m) => m.type === type);
    const state = {
      inVr: true, link: 'live', rttMs: 38,
      clutch: { left: false, right: true }, grip: { left: 0, right: 0.9 },
      held: null, why: { code: 'following', severity: 'ok', text: 'Following.' },
      head: { p: [0, 0, 0], q: [0, 0, 0, 1] },
      targets: { left: null, right: { p: [0.3, -0.2, -0.3], q: [0, 0, 0, 1] } },
    };

    it('announces a watcher to the tenant with its role and acknowledges the watch', async () => {
      const wss = setup();
      const desk = connect(wss, makeClient());
      desk.reset();
      say(desk, { type: 'teleop:watch', sessionId: 's1', role: 'assistant', displayName: 'Ben' });
      await flush();
      expect(ofType(desk, 'teleop:watched')).toHaveLength(1);
      const [presenceMsg] = ofType(desk, 'teleop:session:presence');
      expect(presenceMsg.data).toMatchObject({ sessionId: 's1', robotId: 'robot-of-s1' });
      expect(presenceMsg.data!.viewers).toEqual([
        expect.objectContaining({ displayName: 'Ben', role: 'assistant' }),
      ]);
    });

    it('rejects a watch for a session that does not exist', async () => {
      const wss = setup();
      const desk = connect(wss, makeClient());
      desk.reset();
      say(desk, { type: 'teleop:watch', sessionId: 'missing', role: 'assistant' });
      await flush();
      expect(ofType(desk, 'teleop:watch:rejected')[0]?.error).toBe('session_not_found');
      expect(ofType(desk, 'teleop:session:presence')).toEqual([]);
    });

    it('a repeated heartbeat with nothing changed broadcasts nothing', async () => {
      const wss = setup();
      const desk = connect(wss, makeClient());
      say(desk, { type: 'teleop:watch', sessionId: 's1', role: 'assistant', displayName: 'Ben' });
      await flush();
      desk.reset();
      say(desk, { type: 'teleop:watch', sessionId: 's1', role: 'assistant', displayName: 'Ben' });
      await flush();
      expect(ofType(desk, 'teleop:session:presence')).toEqual([]);
    });

    it('drops a closed socket at once and tells the others', async () => {
      const wss = setup();
      const quest = connect(wss, makeClient());
      const desk = connect(wss, makeClient());
      say(quest, { type: 'teleop:watch', sessionId: 's1', role: 'operator', displayName: 'Anna' });
      say(desk, { type: 'teleop:watch', sessionId: 's1', role: 'assistant', displayName: 'Ben' });
      await flush();
      desk.reset();
      quest.emit('close');
      const [msg] = ofType(desk, 'teleop:session:presence');
      expect(msg.data!.viewers).toEqual([expect.objectContaining({ displayName: 'Ben' })]);
    });

    it('drops a silent watcher within 25 s, and keeps one that beats every 10 s', async () => {
      const wss = setup();
      const silent = connect(wss, makeClient());
      const beating = connect(wss, makeClient());
      say(silent, { type: 'teleop:watch', sessionId: 's1', role: 'operator', displayName: 'Anna' });
      say(beating, { type: 'teleop:watch', sessionId: 's1', role: 'assistant', displayName: 'Ben' });
      await flush();
      beating.reset();
      for (let t = 0; t < 2; t++) {
        await vi.advanceTimersByTimeAsync(10_000);
        say(beating, { type: 'teleop:watch', sessionId: 's1', role: 'assistant', displayName: 'Ben' });
        await flush();
      }
      // 20 s: both still there.
      expect(ofType(beating, 'teleop:session:presence')).toEqual([]);
      await vi.advanceTimersByTimeAsync(5_000);
      const [msg] = ofType(beating, 'teleop:session:presence');
      expect(msg?.data!.viewers).toEqual([expect.objectContaining({ displayName: 'Ben', role: 'assistant' })]);
    });

    it('unwatch removes the watcher', async () => {
      const wss = setup();
      const desk = connect(wss, makeClient());
      say(desk, { type: 'teleop:watch', sessionId: 's1', role: 'assistant' });
      await flush();
      desk.reset();
      say(desk, { type: 'teleop:unwatch', sessionId: 's1' });
      expect(ofType(desk, 'teleop:session:presence')[0]?.data!.viewers).toEqual([]);
    });

    it('relays the operator state to the tenant, without unknown keys', async () => {
      const wss = setup();
      const quest = connect(wss, makeClient());
      const desk = connect(wss, makeClient());
      say(quest, { type: 'teleop:watch', sessionId: 's1', role: 'operator' });
      await flush();
      desk.reset();
      say(quest, { type: 'teleop:operator', sessionId: 's1', state: { ...state, secret: 'x' } });
      const [msg] = ofType(desk, 'teleop:operator');
      expect(msg.data).toMatchObject({ sessionId: 's1', robotId: 'robot-of-s1' });
      expect(msg.data!.state).toEqual(state);
      expect(typeof msg.data!.at).toBe('string');
    });

    it('rejects the operator state from a socket that is not the declared operator', async () => {
      const wss = setup();
      const quest = connect(wss, makeClient());
      const desk = connect(wss, makeClient());
      say(quest, { type: 'teleop:watch', sessionId: 's1', role: 'operator' });
      say(desk, { type: 'teleop:watch', sessionId: 's1', role: 'assistant' });
      await flush();
      desk.reset();
      quest.reset();
      say(desk, { type: 'teleop:operator', sessionId: 's1', state });
      expect(ofType(desk, 'teleop:operator:rejected')[0]?.error).toBe('not_operator');
      expect(ofType(quest, 'teleop:operator')).toEqual([]);
      // A socket that never watched at all is refused the same way.
      const stranger = connect(wss, makeClient());
      stranger.reset();
      say(stranger, { type: 'teleop:operator', sessionId: 's1', state });
      expect(ofType(stranger, 'teleop:operator:rejected')[0]?.error).toBe('not_operator');
    });

    it('rejects an operator state over 2 KB, and a malformed one', async () => {
      const wss = setup();
      const quest = connect(wss, makeClient());
      say(quest, { type: 'teleop:watch', sessionId: 's1', role: 'operator' });
      await flush();
      quest.reset();
      say(quest, { type: 'teleop:operator', sessionId: 's1', state: { ...state, why: { ...state.why, padding: 'x'.repeat(2100) } } });
      expect(ofType(quest, 'teleop:operator:rejected')[0]?.error).toBe('too_large');
      quest.reset();
      say(quest, { type: 'teleop:operator', sessionId: 's1', state: { ...state, link: 'great' } });
      expect(ofType(quest, 'teleop:operator:rejected')[0]?.error).toBe('invalid');
      expect(ofType(quest, 'teleop:operator')).toEqual([]);
    });

    it('throttles the relay to 5 Hz per session and ends on the latest state', async () => {
      const wss = setup();
      const quest = connect(wss, makeClient());
      const desk = connect(wss, makeClient());
      say(quest, { type: 'teleop:watch', sessionId: 's1', role: 'operator' });
      await flush();
      desk.reset();
      // 20 states in one second (20 Hz) → at most 5 (+1 trailing) go out.
      for (let i = 0; i < 20; i++) {
        say(quest, { type: 'teleop:operator', sessionId: 's1', state: { ...state, rttMs: i } });
        await vi.advanceTimersByTimeAsync(50);
      }
      await vi.advanceTimersByTimeAsync(250);
      const relayed = ofType(desk, 'teleop:operator');
      expect(relayed.length).toBeGreaterThanOrEqual(5);
      expect(relayed.length).toBeLessThanOrEqual(6);
      expect((relayed.at(-1)!.data!.state as { rttMs: number }).rttMs).toBe(19);
    });

    // ---- TASK-417: the assistant asks the headset for Stand up / Balance ----
    describe('mode requests (TASK-417)', () => {
      const ask = (requestId: string, mode = 'stand', sessionId = 's1') =>
        ({ type: 'teleop:mode-request', sessionId, mode, requestId });
      const twoPeople = async () => {
        const wss = setup();
        const quest = connect(wss, makeClient());
        const desk = connect(wss, makeClient());
        const bystander = connect(wss, makeClient());
        say(quest, { type: 'teleop:watch', sessionId: 's1', role: 'operator' });
        say(desk, { type: 'teleop:watch', sessionId: 's1', role: 'assistant' });
        say(bystander, { type: 'teleop:watch', sessionId: 's1', role: 'assistant' });
        await flush();
        quest.reset();
        desk.reset();
        bystander.reset();
        return { wss, quest, desk, bystander };
      };

      it('relays a request to the declared operator socket only', async () => {
        const { quest, desk, bystander } = await twoPeople();
        say(desk, ask('r1', 'balance'));
        const [req] = ofType(quest, 'teleop:mode-request') as Array<Record<string, unknown>>;
        expect(req).toMatchObject({ sessionId: 's1', requestId: 'r1', mode: 'balance', ttlMs: 10_000 });
        expect(ofType(desk, 'teleop:mode-request:sent')).toHaveLength(1);
        expect(ofType(desk, 'teleop:mode-request')).toEqual([]);
        expect(ofType(bystander, 'teleop:mode-request')).toEqual([]);
      });

      it('rejects a request from a socket that is not an assistant of the session', async () => {
        const { wss, quest } = await twoPeople();
        const stranger = connect(wss, makeClient());
        stranger.reset();
        say(stranger, ask('r1'));
        expect(ofType(stranger, 'teleop:mode-request:rejected')[0]?.error).toBe('not_assistant');
        // The operator itself may not ask either.
        say(quest, ask('r2'));
        expect(ofType(quest, 'teleop:mode-request:rejected')[0]?.error).toBe('not_assistant');
        expect(ofType(quest, 'teleop:mode-request')).toEqual([]);
      });

      it('answers no_operator when nobody is in the headset', async () => {
        const wss = setup();
        const desk = connect(wss, makeClient());
        say(desk, { type: 'teleop:watch', sessionId: 's1', role: 'assistant' });
        await flush();
        desk.reset();
        say(desk, ask('r1'));
        expect(ofType(desk, 'teleop:mode-request:rejected')[0]?.error).toBe('no_operator');
      });

      it('rejects a malformed request, and never relays Limp or walking', async () => {
        const { quest, desk } = await twoPeople();
        for (const mode of ['limp', 'zero_torque', 'walk', 'damp']) say(desk, ask('r1', mode));
        say(desk, { ...ask('r2'), requestId: 'has space' });
        say(desk, { ...ask('r3'), padding: 'x'.repeat(600) });
        const rejected = ofType(desk, 'teleop:mode-request:rejected');
        expect(rejected).toHaveLength(6);
        expect(rejected.every((m) => m.error === 'invalid')).toBe(true);
        expect(ofType(quest, 'teleop:mode-request')).toEqual([]);
      });

      it('holds one request per 2 s per session', async () => {
        const { quest, desk, bystander } = await twoPeople();
        say(desk, ask('r1'));
        say(bystander, ask('r2'));
        expect(ofType(bystander, 'teleop:mode-request:rejected')[0]?.error).toBe('rate_limited');
        await vi.advanceTimersByTimeAsync(1_900);
        say(desk, ask('r3'));
        expect(ofType(desk, 'teleop:mode-request:rejected')[0]?.error).toBe('rate_limited');
        await vi.advanceTimersByTimeAsync(200);
        say(desk, ask('r4', 'balance'));
        expect(ofType(quest, 'teleop:mode-request').map((m) => (m as Record<string, unknown>).requestId)).toEqual(['r1', 'r4']);
      });

      it('relays the answer to the asker only, once, and only from the operator it went to', async () => {
        const { wss, quest, desk, bystander } = await twoPeople();
        say(desk, ask('r1'));
        // Another socket cannot answer for the operator.
        const stranger = connect(wss, makeClient());
        say(stranger, { type: 'teleop:mode-request:answer', sessionId: 's1', requestId: 'r1', outcome: 'allowed' });
        say(bystander, { type: 'teleop:mode-request:answer', sessionId: 's1', requestId: 'r1', outcome: 'allowed' });
        expect(ofType(desk, 'teleop:mode-request:answer')).toEqual([]);
        say(quest, { type: 'teleop:mode-request:answer', sessionId: 's1', requestId: 'r1', outcome: 'failed', error: 'not_settled' });
        say(quest, { type: 'teleop:mode-request:answer', sessionId: 's1', requestId: 'r1', outcome: 'allowed' });
        const answers = ofType(desk, 'teleop:mode-request:answer') as Array<Record<string, unknown>>;
        expect(answers).toEqual([
          { type: 'teleop:mode-request:answer', sessionId: 's1', requestId: 'r1', outcome: 'failed', error: 'not_settled' },
        ]);
        expect(ofType(bystander, 'teleop:mode-request:answer')).toEqual([]);
        expect(ofType(quest, 'teleop:mode-request:answer')).toEqual([]);
      });

      it('forgets a request whose asker left', async () => {
        const { quest, desk } = await twoPeople();
        say(desk, ask('r1'));
        desk.emit('close');
        desk.reset();
        say(quest, { type: 'teleop:mode-request:answer', sessionId: 's1', requestId: 'r1', outcome: 'allowed' });
        expect(desk.sent).toEqual([]);
      });

      it('never calls the robot or the base-mode route', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        const { quest, desk } = await twoPeople();
        say(desk, ask('r1', 'balance'));
        say(quest, { type: 'teleop:mode-request:answer', sessionId: 's1', requestId: 'r1', outcome: 'allowed' });
        await vi.advanceTimersByTimeAsync(20_000);
        expect(fetchSpy).not.toHaveBeenCalled();
        // And the module has no way to: it imports neither the route nor an HTTP client.
        const { readFileSync } = await import('node:fs');
        const source = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
        expect(source).not.toMatch(/from '\.\.\/routes\/base-mode|HttpClient|axios|robotManager\.(?!onRobotEvent)/);
      });
    });

    it('stops relaying once the operator left', async () => {
      const wss = setup();
      const quest = connect(wss, makeClient());
      const desk = connect(wss, makeClient());
      say(quest, { type: 'teleop:watch', sessionId: 's1', role: 'operator' });
      await flush();
      say(quest, { type: 'teleop:operator', sessionId: 's1', state });
      say(quest, { type: 'teleop:operator', sessionId: 's1', state: { ...state, rttMs: 99 } }); // queued
      say(quest, { type: 'teleop:unwatch', sessionId: 's1' });
      desk.reset();
      await vi.advanceTimersByTimeAsync(500);
      expect(ofType(desk, 'teleop:operator')).toEqual([]);
    });
  });
});
