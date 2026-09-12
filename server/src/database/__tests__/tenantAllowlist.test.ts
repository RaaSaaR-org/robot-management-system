/**
 * @file tenantAllowlist.test.ts
 * @description Ratchet for the tenant-isolation allowlist (TASK-285). Derives the
 * expected set from Prisma's DMMF — every model that carries a `tenantId` column —
 * and asserts it equals `TENANT_SCOPED_MODELS` in `client.ts`. Adding a `tenantId`
 * column without listing the model (or listing a model whose column was dropped)
 * fails here rather than leaking across tenants in production.
 *
 * The DMMF is used rather than a `schema.prisma` regex parser because the generated
 * client is the same artifact the extension runs against, and there is no regex to rot.
 *
 * What this test CANNOT see: a model with no `tenantId` column at all records no
 * ownership, so it can never appear in either set. A green run here means "every
 * model that can be scoped is scoped", not "isolation is complete" — closing a
 * model that has no column is a migration (TASK-286 did exactly that for
 * `SensorScan`, `MotionClip` and `VlaSession`), not an edit to the allowlist.
 *
 * @feature multi-tenancy
 */

import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import { TENANT_SCOPED_MODELS } from '../client.js';

/**
 * Models that carry a `tenantId` column and must deliberately NOT be
 * auto-filtered by the extension — for example a model only ever written under
 * `runAsPlatform`, where injecting the caller's tenantId would be wrong.
 *
 * Empty today. It exists so that a future exception is a deliberate, reviewed
 * edit with a comment next to it, not a silent omission from the allowlist.
 */
const EXCEPTIONS = new Set<string>([]);

function modelsWithTenantId(): string[] {
  return Prisma.dmmf.datamodel.models
    .filter((model) => model.fields.some((field) => field.name === 'tenantId'))
    .map((model) => model.name);
}

describe('TENANT_SCOPED_MODELS vs the Prisma schema', () => {
  it('scopes every model that carries a tenantId column', () => {
    const missing = modelsWithTenantId()
      .filter((name) => !TENANT_SCOPED_MODELS.has(name) && !EXCEPTIONS.has(name))
      .sort();

    expect(
      missing,
      `These models carry a tenantId column but are not in TENANT_SCOPED_MODELS ` +
        `(server/src/database/client.ts). Add them, or add them to EXCEPTIONS with ` +
        `a comment saying why they must not be auto-filtered.`
    ).toEqual([]);
  });

  it('lists no model that has lost its tenantId column', () => {
    const withColumn = new Set(modelsWithTenantId());
    const stale = [...TENANT_SCOPED_MODELS].filter((name) => !withColumn.has(name)).sort();

    expect(
      stale,
      `These models are in TENANT_SCOPED_MODELS but have no tenantId column — ` +
        `the extension will fail at runtime on every query against them.`
    ).toEqual([]);
  });

  it('covers the digital twin trio (TASK-285)', () => {
    expect(TENANT_SCOPED_MODELS.has('DigitalTwin')).toBe(true);
    expect(TENANT_SCOPED_MODELS.has('ScanSession')).toBe(true);
    expect(TENANT_SCOPED_MODELS.has('SimScene')).toBe(true);
  });

  it('covers the perception & VLA trio (TASK-286)', () => {
    // These three had no `tenantId` column at all until TASK-286 added it, so
    // the DMMF-derived test above was structurally blind to them. It is not any
    // more: they carry the column, so the first test now forces them to stay in
    // the allowlist, and this case names them so the reason is legible.
    const withColumn = new Set(modelsWithTenantId());
    for (const name of ['SensorScan', 'MotionClip', 'VlaSession']) {
      expect(withColumn.has(name), `${name} must carry a tenantId column`).toBe(true);
      expect(TENANT_SCOPED_MODELS.has(name)).toBe(true);
    }
  });

  it('derives 33 scoped models', () => {
    // A count, not a list: it catches a model quietly *added* to the allowlist
    // with a column nobody reviewed, which neither test above would notice.
    // Moving this number is fine — it is a prompt to say why in the PR.
    expect(TENANT_SCOPED_MODELS.size).toBe(33);
    expect(modelsWithTenantId()).toHaveLength(33);
  });
});
