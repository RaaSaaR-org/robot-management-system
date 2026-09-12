/**
 * @file approval-open-statuses.test.ts
 * @description Pins the client's open-approval list to the server's (TASK-290).
 * @feature approvals
 *
 * "Open approval" is declared once per package — the app cannot import from
 * `server/` (separate tsconfigs, no path alias, jsdom tests without Node types)
 * and a shared types package was explicitly rejected by the epic (TASK-281). The
 * duplication is therefore deliberate, and THIS test is the enforcement: if the
 * two lists ever drift, the seam that dropped escalated requests out of the
 * queue on one side but not the other comes straight back.
 *
 * It has to live server-side: the app's tsconfig carries no Node types, which is
 * why `app/src/__tests__/design-drift.test.ts` reads files through
 * `import.meta.glob` — and that glob cannot leave the Vite root.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { OPEN_APPROVAL_STATUSES } from '../types/approval.types.js';

const APP_TYPES = path.resolve(
  __dirname,
  '../../../app/src/features/approvals/types/approval.types.ts'
);

/** Pull the array literal out of the app's `OPEN_APPROVAL_STATUSES` export. */
function readAppOpenStatuses(source: string): string[] {
  const match = source.match(
    /export const OPEN_APPROVAL_STATUSES\s*:\s*ApprovalStatus\[\]\s*=\s*\[([^\]]*)\]/
  );
  if (!match) {
    throw new Error(
      'OPEN_APPROVAL_STATUSES not found in the app approval types — if it was ' +
        'renamed or removed, the client no longer shares the server definition.'
    );
  }
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe('open-approval statuses agree across packages', () => {
  it('the app declares exactly the server list, in the same order', () => {
    const appStatuses = readAppOpenStatuses(readFileSync(APP_TYPES, 'utf8'));
    expect(appStatuses).toEqual(OPEN_APPROVAL_STATUSES);
  });

  it('treats an escalated request as open on both sides', () => {
    // The whole point of the task: escalation is the SLA-breach path, so a
    // breached request has to stay actionable rather than vanish from the queue.
    const appStatuses = readAppOpenStatuses(readFileSync(APP_TYPES, 'utf8'));
    expect(OPEN_APPROVAL_STATUSES).toContain('escalated');
    expect(appStatuses).toContain('escalated');
  });

  it('excludes the terminal statuses on both sides', () => {
    const appStatuses = readAppOpenStatuses(readFileSync(APP_TYPES, 'utf8'));
    for (const terminal of ['approved', 'rejected', 'cancelled', 'expired']) {
      expect(OPEN_APPROVAL_STATUSES).not.toContain(terminal);
      expect(appStatuses).not.toContain(terminal);
    }
  });
});
