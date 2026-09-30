/**
 * @file AlertRepository.integration.test.ts
 * @description Real SQLite checks that `Alert.sourceId` is polymorphic
 *   (TASK-337): alerts that point at a task, incident, twin zone or workflow
 *   are written, and robot alerts still find their robot.
 * @feature alerts
 */
import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AlertRepository as AlertRepositoryType, CreateAlertInput } from '../AlertRepository.js';

vi.mock('../../config/features.js', () => ({ MULTI_TENANCY_ENABLED: false, DEFAULT_TENANT_ID: 'default' }));

let raw: PrismaClient;
let repo: AlertRepositoryType;
let tmp: string;
let previousUrl: string | undefined;

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'neodem-alerts-'));
  const url = `file:${join(tmp, 'test.db')}`;
  previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = url;
  delete (globalThis as { prisma?: unknown }).prisma;
  execFileSync(join(process.cwd(), 'node_modules/.bin/prisma'), ['db', 'push', '--skip-generate', '--schema', join(process.cwd(), 'prisma/schema.prisma')], {
    cwd: process.cwd(), env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe',
  });
  raw = new PrismaClient({ datasources: { db: { url } } });
  await raw.$executeRawUnsafe('PRAGMA foreign_keys = ON');
  await raw.robot.create({ data: { id: 'robot-1', name: 'G1 Alpha', model: 'G1' } });
  const { alertRepository } = await import('../AlertRepository.js');
  repo = alertRepository;
}, 120000);

beforeEach(async () => {
  await raw.alert.deleteMany();
});

afterAll(async () => {
  await raw?.$disconnect();
  const { prisma } = await import('../../database/index.js');
  await prisma.$disconnect();
  delete (globalThis as { prisma?: unknown }).prisma;
  if (previousUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousUrl;
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

// The payloads each caller sends, with the ids the Robot foreign key rejected.
const nonRobotAlerts: Array<[string, CreateAlertInput]> = [
  ['task (AlertService.createTaskAlert)', { severity: 'warning', title: 'Task failed', message: 'm', source: 'task', sourceId: 'task-42' }],
  ['incident (IncidentService)', { severity: 'error', title: 'Incident Detected: INC-1', message: 'm', source: 'system', sourceId: 'incident-7' }],
  ['workflow (NotificationWorkflowService)', { severity: 'error', title: 'Overdue Incident Notifications', message: 'm', source: 'system', sourceId: 'notification-workflow' }],
  ['twin zone (SafetyService zone E-stop)', { severity: 'critical', title: 'Zone Emergency Stop - Dock', message: 'm', source: 'system', sourceId: 'zone-3' }],
];

describe('Alert.sourceId is polymorphic', () => {
  it.each(nonRobotAlerts)('writes the %s alert and finds it by sourceId', async (_label, input) => {
    const created = await repo.create(input);

    expect(created.sourceId).toBe(input.sourceId);
    expect(created.source).toBe(input.source);
    const found = await repo.findActive({ sourceId: input.sourceId });
    expect(found.map((a) => a.id)).toEqual([created.id]);
  });

  it('keeps a robot alert pointing at its robot', async () => {
    const created = await repo.create({ severity: 'error', title: 'Robot Offline', message: 'm', source: 'robot', sourceId: 'robot-1' });

    const [found] = await repo.findActive({ source: 'robot', sourceId: 'robot-1' });
    expect(found.id).toBe(created.id);
    const robot = await raw.robot.findUnique({ where: { id: found.sourceId! } });
    expect(robot?.name).toBe('G1 Alpha');
  });

  it('keeps a robot alert when its robot is deleted, for the stale-alert sweep to resolve', async () => {
    await raw.robot.create({ data: { id: 'robot-gone', name: 'G1 Gone', model: 'G1' } });
    const created = await repo.create({ severity: 'error', title: 'Robot Error', message: 'm', source: 'robot', sourceId: 'robot-gone' });

    await raw.robot.delete({ where: { id: 'robot-gone' } });

    const alert = await repo.findById(created.id);
    expect(alert?.sourceId).toBe('robot-gone');
  });
});
