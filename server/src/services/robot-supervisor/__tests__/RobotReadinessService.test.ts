/**
 * @file RobotReadinessService.test.ts
 * @description The readiness merge (TASK-409) against a fake supervisor and a
 *              fake agent over HTTP — server reasons in their order, else the
 *              agent's own line — plus the emission cadence (on change, at
 *              least every 5 s while watched, silent 30 s after the last
 *              request with no session open) and registration after Start.
 * @feature robots
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import {
  mergeReason,
  RobotReadinessService,
  sameIgnoringAt,
  type AgentRead,
  type RobotReadiness,
  type RobotReadinessDeps,
  type SupervisorRead,
} from '../RobotReadinessService.js';
import { readAgentReadiness, readSupervisorStatus } from '../index.js';
import { SupervisorClient } from '../SupervisorClient.js';
import { agentReadiness, deadPort, fakeAgent, fakeSupervisor, step, supStatus, TOKEN, type FakeHttp } from './fakes.js';

const ROBOT = 'sim-g1';
const FOLLOWING = { code: 'following', severity: 'ok' as const, text: 'Following.' };

let servers: FakeHttp[] = [];
afterEach(async () => {
  await Promise.all(servers.map((s) => s.close()));
  servers = [];
});

/** A service wired to real HTTP fakes through the production readers. */
async function httpRig(opts: { status: ReturnType<typeof supStatus>; agent: 'up' | 'down'; supervisor?: 'up' | 'down' | 'none' }) {
  const supState = { status: opts.status };
  const agentState = { readiness: agentReadiness(ROBOT, FOLLOWING) as ReturnType<typeof agentReadiness> | null };
  let supUrl: string;
  if (opts.supervisor === 'down') {
    supUrl = `http://127.0.0.1:${await deadPort()}`;
  } else {
    const sup = await fakeSupervisor(supState);
    servers.push(sup);
    supUrl = sup.url;
  }
  let agentUrl: string;
  if (opts.agent === 'up') {
    const agent = await fakeAgent(agentState);
    servers.push(agent);
    agentUrl = agent.url;
  } else {
    agentUrl = `http://127.0.0.1:${await deadPort()}`;
  }
  const client = new SupervisorClient(supUrl, TOKEN);
  const supervised = opts.supervisor !== 'none';
  const service = new RobotReadinessService({
    supervisedRobots: () => (supervised ? [ROBOT] : []),
    readSupervisor: () => readSupervisorStatus(client),
    registeredAgentUrl: async () => agentUrl,
    supervisorAgentUrl: () => null,
    readAgent: readAgentReadiness,
    register: async () => undefined,
  });
  return { service, supState, agentState };
}

describe('readiness merge (fake supervisor + fake agent over HTTP)', () => {
  it('all ok → the agent reason, source agent', async () => {
    const { service } = await httpRig({ status: supStatus('ready', 'ok'), agent: 'up' });
    const snap = await service.poll(ROBOT);
    expect(snap.reason).toEqual({ ...FOLLOWING, source: 'agent' });
    expect(snap.bringup?.overall).toBe('ready');
    expect(snap.agent).toMatchObject({ reachable: true, error: null });
    expect(snap.agent.readiness?.reason.code).toBe('following');
    expect(snap.supervisor).toEqual({ reachable: true, error: null });
    service.stop();
  });

  it('stopped bringup → bringup_stopped', async () => {
    const { service } = await httpRig({ status: supStatus('stopped', 'idle'), agent: 'down' });
    const snap = await service.poll(ROBOT);
    expect(snap.reason).toEqual({
      code: 'bringup_stopped',
      severity: 'block',
      text: 'Robot side is stopped. Press Start.',
      source: 'server',
    });
    service.stop();
  });

  it('failed link step → its detail', async () => {
    const status = supStatus('error', 'idle', {
      preflight: step('preflight', 'ok'),
      link: step('link', 'failed', { detail: 'robot cable unplugged or robot off', code: 'no_carrier' }),
    });
    const { service } = await httpRig({ status, agent: 'down' });
    const snap = await service.poll(ROBOT);
    expect(snap.reason).toEqual({
      code: 'bringup_failed:link',
      severity: 'block',
      text: 'robot cable unplugged or robot off',
      source: 'server',
    });
    service.stop();
  });

  it('unreachable agent with a ready bringup → agent_unreachable', async () => {
    const { service } = await httpRig({ status: supStatus('ready', 'ok'), agent: 'down' });
    const snap = await service.poll(ROBOT);
    expect(snap.reason).toMatchObject({ code: 'agent_unreachable', text: 'Robot agent is not answering.', source: 'server' });
    expect(snap.agent.reachable).toBe(false);
    expect(snap.agent.error).toBeTruthy();
    service.stop();
  });

  it('no supervisor configured → bringup null, the agent reason still flows', async () => {
    const { service } = await httpRig({ status: supStatus('ready', 'ok'), agent: 'up', supervisor: 'none' });
    const snap = await service.poll(ROBOT);
    expect(snap.bringup).toBeNull();
    expect(snap.supervisor).toBeNull();
    expect(snap.reason.source).toBe('agent');
    service.stop();
  });

  it('supervisor down + agent down → supervisor_unreachable', async () => {
    const { service } = await httpRig({ status: supStatus('ready', 'ok'), agent: 'down', supervisor: 'down' });
    const snap = await service.poll(ROBOT);
    expect(snap.bringup).toBeNull();
    expect(snap.supervisor?.reachable).toBe(false);
    expect(snap.reason.code).toBe('supervisor_unreachable');
    service.stop();
  });
});

describe('mergeReason order', () => {
  const agentUp: RobotReadiness['agent'] = { reachable: true, error: null, readiness: agentReadiness(ROBOT, FOLLOWING) };
  const agentDown: RobotReadiness['agent'] = { reachable: false, error: 'ECONNREFUSED', readiness: null };
  const supOk = { reachable: true, error: null };

  it('foreign step names the process and pid', () => {
    const s = supStatus('error', 'idle', {
      bridge: step('bridge', 'foreign', { foreign: { pid: 4242, cmdline: null, since: null, port: 16001 }, actions: ['adopt', 'leave'] }),
    });
    expect(mergeReason(s, supOk, agentDown)).toMatchObject({
      code: 'bringup_foreign:bridge',
      text: 'An old bridge process is running (pid 4242). Adopt or leave it.',
    });
  });

  it('stopped wins over a failed step, failed over foreign', () => {
    const both = supStatus('stopped', 'idle', {
      link: step('link', 'failed', { detail: 'x' }),
      bridge: step('bridge', 'foreign', { foreign: { pid: 1, cmdline: null, since: null, port: 1 } }),
    });
    expect(mergeReason(both, supOk, agentDown).code).toBe('bringup_stopped');
    expect(mergeReason({ ...both, overall: 'error' }, supOk, agentDown).code).toBe('bringup_failed:link');
  });

  it('a start in progress says so instead of "agent not answering"', () => {
    const s = supStatus('starting', 'idle', { preflight: step('preflight', 'ok'), link: step('link', 'running') });
    expect(mergeReason(s, supOk, agentDown)).toMatchObject({ code: 'bringup_busy', severity: 'warn', text: 'Robot side is starting: link…' });
  });

  it('a degraded bringup with a reachable agent passes the agent line', () => {
    const s = supStatus('degraded', 'ok', { camera: step('camera', 'warn', { detail: 'no camera' }) });
    expect(mergeReason(s, supOk, agentUp)).toEqual({ ...FOLLOWING, source: 'agent' });
  });

  it('clips a long step detail to one HUD line', () => {
    const s = supStatus('error', 'idle', { link: step('link', 'failed', { detail: 'x'.repeat(200) }) });
    expect(mergeReason(s, supOk, agentDown).text.length).toBeLessThanOrEqual(72);
  });

  it('an agent without a readiness route → agent_no_readiness', () => {
    expect(mergeReason(null, null, { reachable: true, error: 'HTTP 404', readiness: null }).code).toBe('agent_no_readiness');
  });
});

describe('sameIgnoringAt', () => {
  it('ignores every at key, nested ones included', () => {
    expect(sameIgnoringAt({ at: '1', a: { at: '2', b: [1, { at: 3 }] } }, { at: '9', a: { at: '8', b: [1, { at: 4 }] } })).toBe(true);
    expect(sameIgnoringAt({ a: 1 }, { a: 2 })).toBe(false);
    expect(sameIgnoringAt({ a: [1] }, { a: [1, 2] })).toBe(false);
  });
});

// ============================================================================
// Cadence (fake timers, in-process fakes)
// ============================================================================

describe('emission cadence', () => {
  let sup: SupervisorRead;
  let agent: AgentRead;
  let reads: number;

  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-10-17T10:00:00Z') });
    sup = { kind: 'ok', status: supStatus('ready', 'ok') };
    agent = { kind: 'ok', readiness: agentReadiness(ROBOT, FOLLOWING) };
    reads = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function rig(extra: Partial<RobotReadinessDeps> = {}) {
    const service = new RobotReadinessService({
      supervisedRobots: () => [ROBOT],
      readSupervisor: async () => {
        reads++;
        // A fresh `at` every read — it must not count as a change.
        return sup.kind === 'ok' ? { kind: 'ok', status: { ...sup.status, at: new Date().toISOString() } } : sup;
      },
      registeredAgentUrl: async () => 'http://agent',
      supervisorAgentUrl: () => 'http://agent',
      readAgent: async () =>
        agent.kind === 'ok' ? { kind: 'ok', readiness: { ...agent.readiness, at: new Date().toISOString() } } : agent,
      register: async () => undefined,
      ...extra,
    });
    const events: RobotReadiness[] = [];
    service.onReadiness((s) => events.push(s));
    return { service, events };
  }

  it('emits on change, else at least every 5 s while watched', async () => {
    const { service, events } = rig();
    await service.getReadiness(ROBOT);
    expect(events).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(3_000);
    expect(reads).toBe(4); // polled at 1 Hz
    expect(events).toHaveLength(1); // nothing changed

    sup = { kind: 'ok', status: supStatus('stopping', 'ok') };
    await vi.advanceTimersByTimeAsync(1_000);
    expect(events).toHaveLength(2);
    expect(events[1].reason.code).toBe('bringup_busy');

    // Unchanged from here: the heartbeat every 5 s.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(events).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(events).toHaveLength(4);
    service.stop();
  });

  it('stops 30 s after the last request when no session is open', async () => {
    const { service, events } = rig();
    await service.getReadiness(ROBOT);
    await vi.advanceTimersByTimeAsync(20_000);
    service.touch(ROBOT); // a second request extends the window
    await vi.advanceTimersByTimeAsync(29_000);
    expect(service.isWatched(ROBOT)).toBe(true);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(service.isWatched(ROBOT)).toBe(false);
    const readsAtEnd = reads;
    const eventsAtEnd = events.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(reads).toBe(readsAtEnd);
    expect(events.length).toBe(eventsAtEnd);
    service.stop();
  });

  it('keeps polling while a teleop session is open, then stops', async () => {
    const { service, events } = rig();
    service.setSession(ROBOT, 'sess-1', true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(reads).toBeGreaterThanOrEqual(59);
    expect(events.length).toBeGreaterThanOrEqual(12);
    service.setSession(ROBOT, 'sess-1', false);
    await vi.advanceTimersByTimeAsync(1_000);
    const readsAtEnd = reads;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(reads).toBe(readsAtEnd);
    service.stop();
  });

  it('registers a missing robot once the agent step is ok, exactly once', async () => {
    const register = vi.fn(async (_url: string, _tenantId: string | null) => undefined);
    let registered: string | null = null;
    sup = { kind: 'ok', status: supStatus('starting', 'ok', { agent: step('agent', 'running') }) };
    agent = { kind: 'unreachable', error: 'ECONNREFUSED' };
    const { service } = rig({
      register: async (url, tenant) => {
        await register(url, tenant);
        registered = url;
      },
      registeredAgentUrl: async () => registered,
      supervisorAgentUrl: (_id, status) => (status ? `http://127.0.0.1:${status.agentPort}` : null),
    });
    service.expectRegistration(ROBOT, 'tenant-a');
    await vi.advanceTimersByTimeAsync(3_000);
    expect(register).not.toHaveBeenCalled(); // agent step still running

    sup = { kind: 'ok', status: supStatus('ready', 'ok') };
    await vi.advanceTimersByTimeAsync(5_000);
    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith('http://127.0.0.1:41299', 'tenant-a');
    service.stop();
  });

  it('does not register a robot that already has a record', async () => {
    const register = vi.fn(async () => undefined);
    const { service } = rig({ register });
    service.expectRegistration(ROBOT, null);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(register).not.toHaveBeenCalled();
    service.stop();
  });

  it('caches the agent part for base-mode while fresh', async () => {
    const { service } = rig();
    await service.getReadiness(ROBOT);
    expect(service.cachedAgentReadiness(ROBOT)?.readiness?.sidecar.reachable).toBe(true);
    service.stop();
    await vi.advanceTimersByTimeAsync(11_000);
    expect(service.cachedAgentReadiness(ROBOT)).toBeNull();
  });
});
