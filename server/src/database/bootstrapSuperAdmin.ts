/**
 * @file bootstrapSuperAdmin.ts
 * @description Creates the platform's first super-admin from
 *              BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD (TASK-367).
 * @feature auth
 *
 * With auth on, nothing else can make one: `POST /api/auth/register` creates a
 * tenant-less `viewer` (and answers 403 under multi-tenancy), the Team page
 * adds users only to the caller's own tenant, and `/api/tenants/*` — the only
 * way to onboard a tenant — is super-admin only. A fresh production install
 * with `AUTH_DISABLED=false` therefore had no way in short of writing a row
 * into Postgres by hand, and the demo seed Job's `POST /api/tenants/onboard`
 * answered 401.
 *
 * Create-only, by email, like the other boot seeds: an existing account is
 * never touched — its password is not reset, and an existing non-admin
 * account is not promoted (that would turn "whoever registered this email
 * first" into a platform admin). Remove the variables once the account exists;
 * keeping them is harmless.
 */

import bcrypt from 'bcryptjs';
import { prisma } from './index.js';
import { logger } from '../utils/logger.js';

export const BOOTSTRAP_ADMIN_EMAIL_ENV = 'BOOTSTRAP_ADMIN_EMAIL';
export const BOOTSTRAP_ADMIN_PASSWORD_ENV = 'BOOTSTRAP_ADMIN_PASSWORD';
export const BOOTSTRAP_ADMIN_NAME_ENV = 'BOOTSTRAP_ADMIN_NAME';

/** Same policy `AuthService` enforces on register and change-password. */
const PASSWORD_POLICY = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BCRYPT_ROUNDS = 12;

export type BootstrapOutcome = 'skipped' | 'created' | 'exists' | 'conflict';

/**
 * Run once at startup, after the database is connected. Throws on a set but
 * unusable configuration, so a typo in the secret fails the rollout instead of
 * leaving an install nobody can sign in to.
 */
export async function bootstrapSuperAdmin(env: NodeJS.ProcessEnv = process.env): Promise<BootstrapOutcome> {
  const email = env[BOOTSTRAP_ADMIN_EMAIL_ENV]?.trim().toLowerCase() ?? '';
  const password = env[BOOTSTRAP_ADMIN_PASSWORD_ENV] ?? '';

  if (!email && !password) return 'skipped';
  if (env.AUTH_DISABLED === 'true') {
    // Every request is already the dev super-admin; a real account would only
    // be a password nobody needs.
    logger.info('[BOOTSTRAP_ADMIN] AUTH_DISABLED=true — not creating a super-admin');
    return 'skipped';
  }
  if (!email || !password) {
    throw new Error(
      `${BOOTSTRAP_ADMIN_EMAIL_ENV} and ${BOOTSTRAP_ADMIN_PASSWORD_ENV} must be set together`
    );
  }
  if (!EMAIL.test(email)) {
    throw new Error(`${BOOTSTRAP_ADMIN_EMAIL_ENV} is not an email address`);
  }
  if (!PASSWORD_POLICY.test(password)) {
    throw new Error(
      `${BOOTSTRAP_ADMIN_PASSWORD_ENV} must be at least 8 characters with uppercase, lowercase, and a number`
    );
  }

  const existing = await prisma.user.findUnique({ where: { email }, select: { role: true } });
  if (existing) {
    if (existing.role === 'super-admin') {
      logger.info({ email }, '[BOOTSTRAP_ADMIN] super-admin already exists — leaving it alone');
      return 'exists';
    }
    logger.warn(
      { email, role: existing.role },
      '[BOOTSTRAP_ADMIN] this email belongs to an existing non-admin account — NOT promoting it; pick another address'
    );
    return 'conflict';
  }

  await prisma.user.create({
    data: {
      email,
      name: env[BOOTSTRAP_ADMIN_NAME_ENV]?.trim() || 'Platform Admin',
      passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
      role: 'super-admin',
      // Platform-level: belongs to no tenant (TASK-162).
      tenantId: null,
      // The password came from the operator's secret, and the demo seed signs
      // in with it non-interactively; a forced change would lock that out.
      forcePasswordChange: false,
    },
  });
  logger.info({ email }, '[BOOTSTRAP_ADMIN] created the platform super-admin');
  return 'created';
}
