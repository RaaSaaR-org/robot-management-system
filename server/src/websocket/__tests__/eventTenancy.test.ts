/**
 * @file eventTenancy.test.ts
 * @description Which entity's tenant routes each WebSocket event family, and
 * how a cross-tenant E-stop is cut per socket (TASK-368).
 * @feature websocket
 */

import { describe, it, expect } from 'vitest';
import { eStopEventFor, eventTenantKey, parseTenantKey, tenantKey } from '../eventTenancy.js';
import type { EStopEvent } from '../../services/SafetyService.js';
import type { SocketIdentity } from '../socketIdentity.js';

const k = eventTenantKey;
// The routing reads only ids; the rest of each payload is irrelevant here.
const as = <T>(value: unknown): T => value as T;

describe('tenantKey', () => {
  it('round-trips an id that itself contains a colon', () => {
    expect(parseTenantKey(tenantKey('alert', 'a:1'))).toEqual({ entity: 'alert', id: 'a:1' });
  });
});

describe('eventTenantKey', () => {
  it('routes A2A task events by conversation, else by the task', () => {
    expect(k.a2aTask(as({ type: 'status_update', taskId: 't1', contextId: 'c1' }))).toBe('conversation:c1');
    expect(k.a2aTask(as({ type: 'status_update', taskId: 't1' }))).toBe('a2aTask:t1');
  });

  it('routes a robot alert by its robot and any other alert by its row', () => {
    expect(k.alert(as({ alert: { id: 'a1', source: 'robot', sourceId: 'r1' } }))).toBe('robot:r1');
    expect(k.alert(as({ alert: { id: 'a1', source: 'system' } }))).toBe('alert:a1');
    expect(k.alert(as({ alert: { id: 'a1', source: 'robot' } }))).toBe('alert:a1');
  });

  it('routes process and step events by the process instance', () => {
    expect(k.process(as({ type: 'process:created', processInstance: { id: 'p1' } }))).toBe('processInstance:p1');
    expect(k.process(as({ type: 'step:started', processInstanceId: 'p2', stepInstance: {} }))).toBe(
      'processInstance:p2'
    );
  });

  it('routes robot task events by the task, assigned or not', () => {
    expect(k.robotTask(as({ type: 'task:created', task: { id: 'rt1', robotId: null } }))).toBe('robotTask:rt1');
    expect(k.robotTask(as({ type: 'task:progress', taskId: 'rt2', robotId: null }))).toBe('robotTask:rt2');
  });

  it('routes incidents and their notifications by the incident', () => {
    expect(k.incident(as({ incident: { id: 'i1' } }))).toBe('incident:i1');
    expect(k.incident(as({ notification: { id: 'n1', incidentId: 'i2' } }))).toBe('incident:i2');
  });

  it('routes training jobs, datasets and deployments by their own row', () => {
    expect(k.trainingJob(as({ jobId: 'j1' }))).toBe('trainingJob:j1');
    expect(k.dataset(as({ datasetId: 'd1' }))).toBe('dataset:d1');
    expect(k.deployment(as({ deploymentId: 'dep1', robotId: 'r1' }))).toBe('deployment:dep1');
  });

  it('routes twin, scan-session and zone events by the twin', () => {
    expect(k.twin(as({ type: 'session:progress', sessionId: 's1', twinId: 'tw1' }))).toBe('digitalTwin:tw1');
    expect(k.twin(as({ type: 'twinZone:deleted', twinId: 'tw2', zoneId: 'z1' }))).toBe('digitalTwin:tw2');
  });

  it("routes teleop events by the session's robot, else by the session", () => {
    expect(k.teleop(as({ sessionId: 's1', session: { robotId: 'r1' } }))).toBe('robot:r1');
    expect(k.teleop(as({ sessionId: 's1' }))).toBe('teleopSession:s1');
  });

  it('answers null when the event names nothing to route by', () => {
    expect(k.dataset(as({ datasetId: '' }))).toBeNull();
    expect(k.incident(as({}))).toBeNull();
  });
});

describe('eStopEventFor', () => {
  const UNRESOLVED = '\u0000unresolved';
  const ownerA: SocketIdentity = { userId: 'a', role: 'owner', tenantId: 'tenant-a' };
  const ownerB: SocketIdentity = { userId: 'b', role: 'owner', tenantId: 'tenant-b' };
  const ownerC: SocketIdentity = { userId: 'c', role: 'owner', tenantId: 'tenant-c' };
  const admin: SocketIdentity = { userId: 'root', role: 'super-admin', tenantId: null };
  const tenants = new Map<string, string | null>([
    ['ra', 'tenant-a'],
    ['rb', 'tenant-b'],
    ['rn', null],
  ]);
  const fleetStop: EStopEvent = {
    id: 'e1',
    scope: 'fleet',
    action: 'trigger',
    triggeredAt: 'now',
    triggeredBy: 'root',
    reason: 'drill',
    affectedRobots: ['ra', 'rb'],
    result: {
      scope: 'fleet',
      triggeredAt: 'now',
      triggeredBy: 'root',
      reason: 'drill',
      robotResults: [
        { robotId: 'ra', robotName: 'A', success: true },
        { robotId: 'rb', robotName: 'B', success: false, error: 'offline' },
      ],
      successCount: 1,
      failureCount: 1,
    },
  };

  it('gives a super-admin the whole event', () => {
    expect(eStopEventFor(fleetStop, admin, tenants, UNRESOLVED)).toBe(fleetStop);
  });

  it("cuts a cross-tenant stop down to the socket's own robots", () => {
    const part = eStopEventFor(fleetStop, ownerA, tenants, UNRESOLVED);
    expect(part?.affectedRobots).toEqual(['ra']);
    expect(part?.result).toMatchObject({
      robotResults: [{ robotId: 'ra' }],
      successCount: 1,
      failureCount: 0,
    });
    expect(JSON.stringify(part)).not.toContain('rb');
  });

  it('sends nothing to a tenant none of whose robots were stopped', () => {
    expect(eStopEventFor(fleetStop, ownerC, tenants, UNRESOLVED)).toBeNull();
  });

  it('shows a robot without a tenant to every tenant, and an unknown robot to nobody but admins', () => {
    const stop = { ...fleetStop, affectedRobots: ['rn', 'ghost'], result: { ...fleetStop.result, robotResults: [] } };
    expect(eStopEventFor(stop, ownerB, tenants, UNRESOLVED)?.affectedRobots).toEqual(['rn']);
  });

  it('shows a stop that affected no robot to super-admins only', () => {
    const empty = { ...fleetStop, affectedRobots: [] };
    expect(eStopEventFor(empty, ownerA, tenants, UNRESOLVED)).toBeNull();
    expect(eStopEventFor(empty, admin, tenants, UNRESOLVED)).toBe(empty);
  });
});
