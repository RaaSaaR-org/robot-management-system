/**
 * @file bootstrapSuperAdmin.test.ts
 * @description The first super-admin of an auth-on install (TASK-367): created
 * once from the environment, never reset, never a promotion.
 * @feature auth
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), create: vi.fn() },
}));
vi.mock('../index.js', () => ({ prisma: prismaMock }));
vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { bootstrapSuperAdmin } from '../bootstrapSuperAdmin.js';

const ENV = {
  AUTH_DISABLED: 'false',
  BOOTSTRAP_ADMIN_EMAIL: ' Root@Emai.dev ',
  BOOTSTRAP_ADMIN_PASSWORD: 'RootPass2026',
};

beforeEach(() => {
  prismaMock.user.findUnique.mockReset().mockResolvedValue(null);
  prismaMock.user.create.mockReset().mockResolvedValue({});
});

describe('bootstrapSuperAdmin', () => {
  it('does nothing when neither variable is set', async () => {
    expect(await bootstrapSuperAdmin({ AUTH_DISABLED: 'false' })).toBe('skipped');
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it('creates a tenant-less super-admin with a hashed password', async () => {
    expect(await bootstrapSuperAdmin(ENV)).toBe('created');
    const data = prismaMock.user.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      email: 'root@emai.dev',
      name: 'Platform Admin',
      role: 'super-admin',
      tenantId: null,
      forcePasswordChange: false,
    });
    expect(data.passwordHash).not.toContain('RootPass2026');
    expect(await bcrypt.compare('RootPass2026', data.passwordHash)).toBe(true);
  });

  it('leaves an existing super-admin alone — no password reset', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ role: 'super-admin' });
    expect(await bootstrapSuperAdmin(ENV)).toBe('exists');
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it('never promotes an existing non-admin account with that email', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ role: 'viewer' });
    expect(await bootstrapSuperAdmin(ENV)).toBe('conflict');
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it('is skipped under AUTH_DISABLED=true', async () => {
    expect(await bootstrapSuperAdmin({ ...ENV, AUTH_DISABLED: 'true' })).toBe('skipped');
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it.each([
    [{ BOOTSTRAP_ADMIN_EMAIL: 'root@emai.dev' }, /must be set together/],
    [{ BOOTSTRAP_ADMIN_EMAIL: 'not-an-email', BOOTSTRAP_ADMIN_PASSWORD: 'RootPass2026' }, /not an email/],
    [{ BOOTSTRAP_ADMIN_EMAIL: 'root@emai.dev', BOOTSTRAP_ADMIN_PASSWORD: 'short' }, /at least 8/],
  ])('refuses to start on an unusable configuration (%o)', async (vars, message) => {
    await expect(bootstrapSuperAdmin({ AUTH_DISABLED: 'false', ...vars })).rejects.toThrow(message);
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });
});
