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
import { agentReadiness, deadPort, fakeAgent, fakeSupervisor, questStatus, step, supStatus, TOKEN, type FakeHttp } from './fakes.js';
import { readQuestStatus } from '../index.js';
import type { QuestStatus } from '../SupervisorClient.js';

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

describe('the Quest in the snapshot (TASK-412)', () => {
  it('carries the supervisor\'s /quest and never changes the reason', async () => {
    const supState = { status: supStatus('ready', 'ok'), quest: questStatus(false) };
    const sup = await fakeSupervisor(supState);
    const agent = await fakeAgent({ readiness: agentReadiness(ROBOT, FOLLOWING) });
    servers.push(sup, agent);
    const client = new SupervisorClient(sup.url, TOKEN);
    const service = new RobotReadinessService({
      supervisedRobots: () => [ROBOT],
      readSupervisor: () => readSupervisorStatus(client),
      registeredAgentUrl: async () => agent.url,
      supervisorAgentUrl: () => null,
      readAgent: readAgentReadiness,
      readQuest: () => readQuestStatus(client),
      register: async () => undefined,
    });
    const snap = await service.poll(ROBOT);
    expect(snap.quest).toEqual(questStatus(false));
    expect(snap.reason).toEqual({ ...FOLLOWING, source: 'agent' });
    service.stop();
  });

  it('is null without a supervisor, with a supervisor that is down, or one without /quest', async () => {
    const none = await httpRig({ status: supStatus('ready', 'ok'), agent: 'up', supervisor: 'none' });
    expect((await none.service.poll(ROBOT)).quest).toBeNull();
    none.service.stop();
    const sup = await fakeSupervisor({ status: supStatus('ready', 'ok') });
    servers.push(sup);
    expect(await readQuestStatus(new SupervisorClient(sup.url, TOKEN))).toBeNull();
    expect(await readQuestStatus(new SupervisorClient(`http://127.0.0.1:${await deadPort()}`, TOKEN))).toBeNull();
    expect(await readQuestStatus(undefined)).toBeNull();
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

  it('an agent that sent no usable readiness report → agent_no_readiness', () => {
    expect(mergeReason(null, null, { reachable: true, error: 'HTTP 500', readiness: null }).code).toBe('agent_no_readiness');
  });

  it('an outdated agent (health ok, no readiness route) → agent_outdated, block', () => {
    expect(mergeReason(supStatus('ready', 'ok'), supOk, { reachable: true, error: 'HTTP 404', readiness: null, outdated: true })).toEqual({
      code: 'agent_outdated',
      severity: 'block',
      text: 'The robot agent runs older code than NeoDEM. Restart the robot side.',
      source: 'server',
    });
  });

  it('the supervisor\'s staleCode on an owned step → agent_outdated, ahead of the agent line', () => {
    const stale = { startedAt: '2026-10-17T15:21:00.000Z', codeAt: '2026-10-18T09:00:00.000Z' };
    const s = supStatus('ready', 'ok', { agent: step('agent', 'warn', { code: 'stale_code', checks: { staleCode: stale } }) });
    expect(mergeReason(s, supOk, agentUp)).toMatchObject({
      code: 'agent_outdated',
      severity: 'block',
      text: 'The robot agent runs older code than NeoDEM. Restart the robot side.',
    });
  });

  it('a stale foreign agent → agent_outdated naming its pid, ahead of the failed preflight', () => {
    const stale = { startedAt: '2026-10-17T15:21:00.000Z', codeAt: '2026-10-18T09:00:00.000Z' };
    const s = supStatus('error', 'idle', {
      preflight: step('preflight', 'failed', { code: 'foreign_process', detail: 'Old processes hold :41299 agent — see the rows. More.' }),
      agent: step('agent', 'foreign', {
        code: 'stale_code',
        foreign: { pid: 4242, cmdline: null, since: stale.startedAt, port: 41299, cwd: '/old/robot-agent', robotId: null, staleCode: stale },
        actions: ['leave'],
      }),
    });
    const r = mergeReason(s, supOk, agentDown);
    expect(r).toMatchObject({ code: 'agent_outdated', severity: 'block' });
    expect(r.text).toBe('An old robot agent (pid 4242) runs older code. Stop it, then Start.');
    expect(r.text.length).toBeLessThanOrEqual(72);
  });

  it('the cable and foreign texts keep their meaning at 72 characters, never cut mid-word', () => {
    const cable = supStatus('error', 'idle', {
      link: step('link', 'failed', { detail: 'Robot cable unplugged or robot off (enp131s0 no carrier). Interface operstate: down.' }),
    });
    expect(mergeReason(cable, supOk, agentDown).text).toBe('Robot cable unplugged or robot off (enp131s0 no carrier).');
    const foreign = supStatus('error', 'idle', {
      preflight: step('preflight', 'failed', {
        detail: 'Old processes hold :6001 bridge, :41245 agent — see the rows. The supervisor did not start them and never kills them: adopt one (use it as is) or leave it and stop it by hand, then start again.',
      }),
    });
    expect(mergeReason(foreign, supOk, agentDown).text).toBe('Old processes hold :6001 bridge, :41245 agent — see the rows.');
  });

  it('clips a long sentence at a word boundary', () => {
    const s = supStatus('error', 'idle', { link: step('link', 'failed', { detail: 'word '.repeat(40) }) });
    const text = mergeReason(s, supOk, agentDown).text;
    expect(text.length).toBeLessThanOrEqual(72);
    expect(text).toMatch(/ word…$/);
  });
});

describe('outdated agent over HTTP (TASK-419)', () => {
  it('health ok + readiness 404 → agent_outdated', async () => {
    const agent = await fakeAgent({ readiness: null, outdated: true });
    servers.push(agent);
    expect(await readAgentReadiness(agent.url, ROBOT)).toEqual({ kind: 'outdated' });
    const service = new RobotReadinessService({
      supervisedRobots: () => [],
      readSupervisor: async () => ({ kind: 'error', error: 'none' }),
      registeredAgentUrl: async () => agent.url,
      supervisorAgentUrl: () => null,
      readAgent: readAgentReadiness,
      register: async () => undefined,
    });
    const snap = await service.poll(ROBOT);
    expect(snap.reason).toMatchObject({ code: 'agent_outdated', severity: 'block', source: 'server' });
    expect(snap.agent).toMatchObject({ reachable: true, readiness: null, outdated: true });
    service.stop();
  });

  it('a current agent that does not serve this robot (404 ROBOT_NOT_FOUND) is not outdated', async () => {
    const agent = await fakeAgent({ readiness: null, fail: 404 });
    servers.push(agent);
    expect(await readAgentReadiness(agent.url, ROBOT)).toEqual({ kind: 'bad_status', status: 404 });
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

  it('reads the Quest every 2 s while watched, not on every 1 Hz poll, and emits its change', async () => {
    let quest: QuestStatus = questStatus(false);
    let questReads = 0;
    const { service, events } = rig({
      readQuest: async () => {
        questReads++;
        return quest;
      },
    });
    await service.getReadiness(ROBOT);
    expect(questReads).toBe(1);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(reads).toBe(5);
    expect(questReads).toBe(3); // t = 0, 2, 4
    expect(events).toHaveLength(1);

    quest = questStatus(true);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(events.at(-1)?.quest?.reversed).toEqual([{ remote: 'tcp:1420', local: 'tcp:1420' }]);
    expect(events.at(-1)?.reason.code).toBe('following');

    // Not watched any more: no reads at all.
    service.stop();
    const before = questReads;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(questReads).toBe(before);
  });

  it('does not hold the poll back on a slow Quest read; the next poll carries it', async () => {
    let answer: ((q: QuestStatus | null) => void) | undefined;
    let questReads = 0;
    const { service } = rig({
      readQuest: () => {
        questReads++;
        return new Promise<QuestStatus | null>((resolve) => (answer = resolve));
      },
    });
    let first: RobotReadiness | undefined;
    void service.getReadiness(ROBOT).then((s) => (first = s));
    // Only the short grace, not the read's 5 s timeout.
    await vi.advanceTimersByTimeAsync(250);
    expect(first?.quest).toBeNull();
    expect(first?.reason.code).toBe('following');

    // Still running over the next ticks: no second read is started meanwhile.
    await vi.advanceTimersByTimeAsync(3_000);
    expect(questReads).toBe(1);

    answer?.(questStatus(true));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(service.cached(ROBOT)?.quest?.reversed).toEqual([{ remote: 'tcp:1420', local: 'tcp:1420' }]);
    service.stop();
  });

  it('drops a Quest read that started before Connect / Open', async () => {
    const answers: Array<(q: QuestStatus | null) => void> = [];
    const { service } = rig({
      readQuest: () => new Promise<QuestStatus | null>((resolve) => answers.push(resolve)),
    });
    void service.getReadiness(ROBOT);
    await vi.advanceTimersByTimeAsync(250);
    service.invalidateQuest(ROBOT);
    await vi.advanceTimersByTimeAsync(1_000); // the next poll starts a fresh read
    expect(answers).toHaveLength(2);
    answers[1](questStatus(true));
    answers[0](questStatus(false)); // the old read answers last
    await vi.advanceTimersByTimeAsync(1_000);
    expect(service.cached(ROBOT)?.quest?.reversed).toEqual([{ remote: 'tcp:1420', local: 'tcp:1420' }]);
    service.stop();
  });

  it('keeps the heartbeat within 5 s when an emission falls off the tick phase', async () => {
    const { service, events } = rig();
    service.touch(ROBOT); // the 1 Hz tick starts here, at t = 0
    await vi.advanceTimersByTimeAsync(500);
    expect(events).toHaveLength(0);
    // A GET half-way between ticks polls and emits off-phase (t = 0.5 s).
    await service.getReadiness(ROBOT);
    expect(events).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(20_000);
    const times = events.map((e) => Date.parse(e.at));
    expect(times.length).toBeGreaterThanOrEqual(5);
    for (let i = 1; i < times.length; i++) {
      expect(times[i] - times[i - 1]).toBeLessThanOrEqual(5_000);
    }
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
