/**
 * @file ApprovalRepository.open-statuses.test.ts
 * @description Real-database proof that an escalated request stays open (TASK-290).
 * @feature approvals
 *
 * `ApprovalRepository.test.ts` mocks prisma and asserts the where clause, so it
 * can only ever confirm that the repository sends the string the fix changes —
 * it was green for the entire life of the bug. This file mocks nothing: it
 * pushes the real schema to a temp SQLite database, binds the real client
 * singleton to it and runs the real queries, so the assertions are about rows
 * that actually come back.
 *
 * The seam under test: `escalate()` sets status `escalated` and never moves
 * `slaDeadline`, so a breached request is permanently past its deadline. If
 * `escalated` is not an open status it matches no "open" query — it leaves the
 * overdue set (and so is never re-escalated and stops emitting `sla_breach`),
 * drops out of pending-for-user and pending-for-role, and stops being counted by
 * `countOverdue()` — while the queue on the same screen still lists it.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const USER = 'user-42';
const HOUR = 60 * 60 * 1000;

let tmpDir: string;
let dbPath: string;
let previousDatabaseUrl: string | undefined;
let raw: PrismaClient;
let repo: (typeof import('../ApprovalRepository.js'))['approvalRequestRepository'];

/**
 * Seed one request plus its steps directly, bypassing `create()` — that path
 * always writes status `pending`, and the row this test needs is an escalated
 * one whose deadline is in the past.
 */
async function seedRequest(options: {
  id: string;
  requestNumber: string;
  status: string;
  overdueHours: number;
  steps: Array<{ approverRole: string; assignedTo: string | null; status: string }>;
  completed?: boolean;
}): Promise<void> {
  await raw.approvalRequest.create({
    data: {
      id: options.id,
      requestNumber: options.requestNumber,
      entityType: 'performance_evaluation',
      entityId: `ent-${options.id}`,
      entityData: '{}',
      approvalType: 'single_approval',
      priority: 'normal',
      status: options.status,
      slaHours: 48,
      slaDeadline: new Date(Date.now() - options.overdueHours * HOUR),
      escalatedAt: options.status === 'escalated' ? new Date() : null,
      escalationLevel: options.status === 'escalated' ? 1 : 0,
      requestedBy: 'requester',
      requestReason: 'seeded',
      blocksExecution: true,
      completedAt: options.completed ? new Date() : null,
      steps: {
        create: options.steps.map((step, index) => ({
          stepOrder: index,
          approverRole: step.approverRole,
          assignedTo: step.assignedTo,
          status: step.status,
        })),
      },
    },
  });
}

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'neodem-open-statuses-'));
  dbPath = join(tmpDir, 'test.db');

  const projectRoot = join(__dirname, '..', '..', '..');
  execSync(
    `npx prisma db push --schema=${join(projectRoot, 'prisma', 'schema.prisma')} --skip-generate --accept-data-loss`,
    {
      env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
      cwd: projectRoot,
      stdio: 'pipe',
    }
  );

  // `buildPrisma()` passes no `datasources`, so the singleton reads DATABASE_URL
  // at construction — it must point at the temp database BEFORE the repository
  // module is imported. The cached instance on globalThis is dropped too:
  // vitest reuses a worker across files, and a client another file built would
  // still point at that file's database.
  previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = `file:${dbPath}`;
  delete (globalThis as { prisma?: unknown }).prisma;

  ({ approvalRequestRepository: repo } = await import('../ApprovalRepository.js'));

  raw = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } }, log: [] });

  // Overdue and still pending — the case that always worked.
  await seedRequest({
    id: 'req-pending',
    requestNumber: 'APR-2026-00001',
    status: 'pending',
    overdueHours: 5,
    steps: [{ approverRole: 'supervisor', assignedTo: USER, status: 'awaiting' }],
  });

  // Overdue and escalated: an awaiting step assigned to the user, plus an
  // unassigned awaiting step carrying a role, so both pending-for lookups have
  // something to match. Escalation left `slaDeadline` in the past.
  await seedRequest({
    id: 'req-escalated',
    requestNumber: 'APR-2026-00002',
    status: 'escalated',
    overdueHours: 9,
    steps: [
      { approverRole: 'supervisor', assignedTo: USER, status: 'awaiting' },
      { approverRole: 'manager', assignedTo: null, status: 'awaiting' },
    ],
  });

  // Decided: past its deadline, but closed — must stay out of every result.
  await seedRequest({
    id: 'req-approved',
    requestNumber: 'APR-2026-00003',
    status: 'approved',
    overdueHours: 20,
    completed: true,
    steps: [{ approverRole: 'supervisor', assignedTo: USER, status: 'approved' }],
  });
}, 60000);

afterAll(async () => {
  await raw?.$disconnect();
  if (previousDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = previousDatabaseUrl;
  }
  delete (globalThis as { prisma?: unknown }).prisma;
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('an escalated request stays open', () => {
  it('findOverdue() returns it alongside the pending one, deadline-ordered', async () => {
    const ids = (await repo.findOverdue()).map((r) => r.id);
    expect(ids).toContain('req-escalated');
    // Ordered by slaDeadline asc, so the more overdue escalated row leads.
    expect(ids).toEqual(['req-escalated', 'req-pending']);
    expect(ids).not.toContain('req-approved');
  });

  it('countOverdue() counts it, so metrics.overdueRequests stops under-reporting', async () => {
    expect(await repo.countOverdue()).toBe(2);
  });

  it('findPendingForUser() still shows it to its assigned approver', async () => {
    const ids = (await repo.findPendingForUser(USER)).map((r) => r.id);
    expect(ids).toContain('req-escalated');
    expect(ids).toContain('req-pending');
    expect(ids).not.toContain('req-approved');
  });

  it('findPendingByRole() still shows its unassigned step to the role', async () => {
    const ids = (await repo.findPendingByRole('manager')).map((r) => r.id);
    expect(ids).toEqual(['req-escalated']);
  });

  it('findAll({ overdue: true }) lists it', async () => {
    const result = await repo.findAll({ overdue: true });
    const ids = result.requests.map((r) => r.id);
    expect(ids).toContain('req-escalated');
    expect(result.total).toBe(2);
    expect(ids).not.toContain('req-approved');
  });

  it('findNearingDeadline() excludes it — its deadline is already past', async () => {
    // Included in the open set only so all six queries read identically; a row
    // that has breached can never sit inside a `gt: now` window.
    const ids = (await repo.findNearingDeadline(4)).map((r) => r.id);
    expect(ids).toEqual([]);
  });
});
