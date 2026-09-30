/**
 * @file socket-binding.test.ts
 * @description The registry's `bound` count is shared by every motion socket
 *              kind (TASK-316): keyboard teleop's `adjustBoundCount` and the
 *              bilateral `LeaseSocketBinding` add up instead of overwriting.
 * @feature robot
 * @status test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ControlLeaseRegistry, hashLeaseId } from '../control-lease.js';
import { LeaseSocketBinding, adjustBoundCount } from '../socket-binding.js';

const SECRET = 'lease-secret';

describe('shared bound count (TASK-316)', () => {
  let dir: string;
  let registry: ControlLeaseRegistry;

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'socket-binding-'));
    registry = new ControlLeaseRegistry({
      robotId: 'robot-1',
      filePath: path.join(dir, 'hw.json'),
      enforced: () => true,
    });
    const r = registry.install({
      generation: 1,
      leaseIdHash: hashLeaseId(SECRET),
      sessionId: 's',
      userId: 'user-ada',
      displayName: 'Ada',
      tenantId: null,
      ttlMs: 60_000,
    });
    expect(r.ok).toBe(true);
  });

  afterEach(() => {
    registry.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('adds a keyboard socket and a bilateral binding instead of overwriting', () => {
    adjustBoundCount(registry, 1, +1); // a keyboard teleop socket binds
    const bilateral = new LeaseSocketBinding(registry);
    expect(bilateral.bind({ leaseId: SECRET, generation: 1 }).ok).toBe(true);
    expect(registry.observe().bound).toBe(2);

    bilateral.dispose();
    expect(registry.observe().bound).toBe(1);
    adjustBoundCount(registry, 1, -1);
    expect(registry.observe().bound).toBe(0);
  });

  it('a repeated bind to the same generation counts once', () => {
    const b = new LeaseSocketBinding(registry);
    b.bind({ leaseId: SECRET, generation: 1 });
    b.bind({ leaseId: SECRET, generation: 1 });
    expect(registry.observe().bound).toBe(1);
    b.dispose();
    expect(registry.observe().bound).toBe(0);
  });
});
