/**
 * @file write-route-authorization.test.ts
 * @description Drives a real viewer JWT at every write verb of a real
 * `createApp()` — no mocked auth middleware. Fail-closed since TASK-283: a
 * write route must refuse a viewer, or be declared as an exception.
 * @feature auth
 */

// `rateLimitDisabled` is captured when app.ts is imported (app.ts:115) and this
// suite fires one request per enforced write route — comfortably enough to trip
// the /api/ limiter. A hoisted block is the only thing that runs before the
// static imports below.
import { vi } from 'vitest';

vi.hoisted(() => {
  process.env.RATE_LIMIT_DISABLED = 'true';
});

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Test } from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp, UNGUARDED_WRITE_MOUNTS } from '../app.js';
import {
  POST_SHAPED_READS,
  SAFETY_HALT_WRITES,
  SELF_SERVICE_WRITES,
  isSafetyHalt,
} from '../middleware/auth.middleware.js';
import { robotManager } from '../services/RobotManager.js';
import { safetyService } from '../services/SafetyService.js';
import { settingsService } from '../services/SettingsService.js';

const app = createApp();

/**
 * The total number of distinct write verbs `createApp()` registers.
 *
 * Asserted exactly, and deliberately so: the stack walk below is the only thing
 * standing between a new unguarded route and production, and a walk that
 * silently stops descending would shrink the enforced set to nothing while
 * still reporting a pass. If you add or remove a write route, this number moves
 * with it — update it in the same commit, having checked the new route is
 * guarded.
 */
const EXPECTED_WRITE_ROUTES = 349;

/** Writes on `UNGUARDED_WRITE_MOUNTS`: 13 on /api/auth, 12 on the two worker mounts. */
const EXPECTED_UNGUARDED_WRITES = 25;
const EXPECTED_AUTH_WRITES = 13;

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// ---------------------------------------------------------------------------
// Enumerate the live Express router stack (Express 4.21)
// ---------------------------------------------------------------------------

interface RouteLayer {
  route?: { path: string | string[]; methods: Record<string, boolean> };
  name?: string;
  handle?: { stack?: RouteLayer[] };
  regexp?: RegExp & { fast_slash?: boolean };
}

interface RouteEntry {
  method: string;
  path: string;
}

/**
 * Decode a mounted router's path back out of the regexp Express compiled it
 * into. `/api/robots` compiles to `^\/api\/robots\/?(?=\/|$)`.
 */
function mountPathOf(layer: RouteLayer): string {
  const re = layer.regexp;
  if (!re || re.fast_slash) return '';
  return re.source
    .replace(/^\^/, '')
    .replace(/\\\/\?\(\?=\\\/\|\$\)$/, '')
    .replace(/\$$/, '')
    .replace(/\\\//g, '/');
}

function normalize(path: string): string {
  const collapsed = path.replace(/\/{2,}/g, '/');
  return collapsed.length > 1 ? collapsed.replace(/\/$/, '') : collapsed;
}

/**
 * Walk the stack depth-first. The recursion into `layer.handle.stack` is what
 * picks up routers mounted inside routers — `skills.routes.ts` mounts
 * `/chains` and `training.routes.ts` mounts `/workers` — whose verbs a
 * single-level walk would drop without a word.
 */
function collect(stack: RouteLayer[], prefix: string, out: RouteEntry[]): void {
  for (const layer of stack) {
    if (layer.route) {
      const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
      for (const routePath of paths) {
        if (typeof routePath !== 'string') continue;
        for (const [method, enabled] of Object.entries(layer.route.methods)) {
          if (!enabled) continue;
          out.push({ method: method.toUpperCase(), path: normalize(prefix + routePath) });
        }
      }
    } else if (layer.handle?.stack) {
      collect(layer.handle.stack, prefix + mountPathOf(layer), out);
    }
  }
}

const stack = (app as unknown as { _router: { stack: RouteLayer[] } })._router.stack;
const inventory: RouteEntry[] = [];
collect(stack, '', inventory);

const seen = new Set<string>();
const writes = inventory.filter((entry) => {
  if (!WRITE_METHODS.has(entry.method)) return false;
  const key = `${entry.method} ${entry.path}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});

/** `/api/robots/:id/command` → `/api/robots/test-id/command`. */
function concrete(path: string): string {
  return path.replace(/:[^/]+/g, 'test-id');
}

/** Declared open in `app.ts` — see `UNGUARDED_WRITE_MOUNTS` for why each one is. */
function onUnguardedMount(entry: RouteEntry): boolean {
  return UNGUARDED_WRITE_MOUNTS.some(
    (mount) => entry.path === mount || entry.path.startsWith(`${mount}/`)
  );
}

function isSelfService(path: string): boolean {
  return SELF_SERVICE_WRITES.some((pattern) => pattern.test(path));
}

function isPostShapedRead(path: string): boolean {
  return POST_SHAPED_READS.some((pattern) => pattern.test(path));
}

/**
 * A halt, classified the way the sweep below actually fires: with an empty
 * body. `POST /api/safety/fleet/estop` is exempt on its path alone, so it
 * cannot answer 403 and belongs in the halt class. `POST /api/robots/:id/command`
 * is exempt only for an `emergency_stop` body, so with an empty one it stays
 * enforced — which is exactly the behaviour that must not regress.
 */
function isHalt(path: string): boolean {
  return isSafetyHalt(path, {});
}

/** Any of the three allowlists the guard consults. */
function isExempt(path: string): boolean {
  return isSelfService(path) || isPostShapedRead(path) || isHalt(path);
}

const unguardedWrites = writes.filter(onUnguardedMount);
const guardedWrites = writes.filter((entry) => !onUnguardedMount(entry));
// The exempt classes are asserted by pattern rather than fired: an allowlisted
// request reaches its real handler, and those handlers reach Prisma.
const selfServiceWrites = guardedWrites.filter((entry) => isSelfService(concrete(entry.path)));
const postShapedReadWrites = guardedWrites.filter((entry) =>
  isPostShapedRead(concrete(entry.path))
);
const safetyHaltWrites = guardedWrites.filter((entry) => isHalt(concrete(entry.path)));
// Everything else. No skip list: whatever lands here must answer 403 to a viewer.
const enforcedWrites = guardedWrites.filter((entry) => !isExempt(concrete(entry.path)));

function fire(method: string, path: string): Test {
  switch (method) {
    case 'POST':
      return request(app).post(path);
    case 'PUT':
      return request(app).put(path);
    case 'PATCH':
      return request(app).patch(path);
    case 'DELETE':
      return request(app).delete(path);
    default:
      throw new Error(`Unsupported write method: ${method}`);
  }
}

let viewerToken: string;
let memberToken: string;

beforeAll(() => {
  viewerToken = jwt.sign(
    { userId: 'viewer-user', email: 'viewer@example.com', name: 'Viewer User', role: 'viewer' },
    process.env.JWT_SECRET!,
    { expiresIn: '1h' }
  );
  memberToken = jwt.sign(
    { userId: 'member-user', email: 'member@example.com', name: 'Member User', role: 'member' },
    process.env.JWT_SECRET!,
    { expiresIn: '1h' }
  );
});

beforeEach(() => {
  // vitest.config.ts forces AUTH_DISABLED=true for the whole server suite, and
  // both auth layers short-circuit on it. This is the only suite that turns it
  // off, so it is the only one that exercises a role check through a router.
  vi.stubEnv('AUTH_DISABLED', 'false');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// The two routes the defect was reported against
// ---------------------------------------------------------------------------

describe('the fleet writes a viewer could reach', () => {
  it('refuses a viewer unregistering a robot', async () => {
    const unregister = vi.spyOn(robotManager, 'unregisterRobot');
    const result = await request(app)
      .delete('/api/robots/test-id')
      .set('Authorization', `Bearer ${viewerToken}`);

    expect(result.status).toBe(403);
    expect(result.body.error).toBe('Forbidden');
    expect(unregister).not.toHaveBeenCalled();
  });

  it('refuses a viewer sending a physical command', async () => {
    const sendCommand = vi.spyOn(robotManager, 'sendCommand');
    const result = await request(app)
      .post('/api/robots/test-id/command')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ type: 'move', payload: { x: 1, y: 1 } });

    expect(result.status).toBe(403);
    expect(result.body.error).toBe('Forbidden');
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it('still lets a member unregister a robot', async () => {
    const unregister = vi.spyOn(robotManager, 'unregisterRobot').mockResolvedValue(true);
    const result = await request(app)
      .delete('/api/robots/test-id')
      .set('Authorization', `Bearer ${memberToken}`);

    expect(result.status).not.toBe(403);
    expect(unregister).toHaveBeenCalledWith('test-id');
  });

  it('still lets a member send a physical command', async () => {
    const sendCommand = vi
      .spyOn(robotManager, 'sendCommand')
      .mockResolvedValue({ id: 'cmd-1' } as never);
    const result = await request(app)
      .post('/api/robots/test-id/command')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ type: 'move', payload: { x: 1, y: 1 } });

    expect(result.status).not.toBe(403);
    expect(sendCommand).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Self-service exceptions
// ---------------------------------------------------------------------------

describe('self-service writes', () => {
  it('lets a viewer update their own settings', async () => {
    const update = vi
      .spyOn(settingsService, 'updateSettings')
      .mockResolvedValue({ theme: 'dark' } as never);
    const result = await request(app)
      .put('/api/settings')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ theme: 'dark' });

    expect(result.status).toBe(200);
    expect(update).toHaveBeenCalledWith('viewer-user', { theme: 'dark' });
  });

  it('does not let a viewer run a GDPR admin erasure', async () => {
    const result = await request(app)
      .post('/api/gdpr/admin/requests/test-id/execute-erasure')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({});

    expect(result.status).toBe(403);
    expect(result.body.error).toBe('Forbidden');
  });

  it('exempts only the GDPR subject half and the two settings writes', () => {
    expect(selfServiceWrites.map((e) => `${e.method} ${e.path}`).sort()).toEqual([
      'DELETE /api/gdpr/consents/:type',
      'DELETE /api/gdpr/requests/:id',
      'POST /api/gdpr/consents',
      'POST /api/gdpr/requests/access',
      'POST /api/gdpr/requests/adm-review',
      'POST /api/gdpr/requests/erasure',
      'POST /api/gdpr/requests/objection',
      'POST /api/gdpr/requests/portability',
      'POST /api/gdpr/requests/rectification',
      'POST /api/gdpr/requests/restriction',
      'POST /api/settings/reset',
      'PUT /api/settings',
    ]);
  });

  it.each(SELF_SERVICE_WRITES.map((pattern) => [String(pattern), pattern] as const))(
    'allowlist entry %s still matches a live write route',
    (_label, pattern) => {
      const matched = writes.filter((entry) => pattern.test(concrete(entry.path)));
      expect(matched.length).toBeGreaterThan(0);
    }
  );
});

// ---------------------------------------------------------------------------
// Writes that perform no write
// ---------------------------------------------------------------------------

describe('POST-shaped reads', () => {
  it('exempts the cron calculator and the camera ticket, and nothing else', () => {
    expect(postShapedReadWrites.map((e) => `${e.method} ${e.path}`).sort()).toEqual([
      'POST /api/patrol/cron/validate',
      'POST /api/robots/:id/camera/:name/ticket',
    ]);
  });

  it('lets a viewer mint a camera stream ticket', async () => {
    // The stream itself is a GET this guard never touches, but it is unreadable
    // without this ticket: refuse the mint and a viewer's cockpit answers "The
    // server refused a stream ticket for this camera."
    const lookup = vi
      .spyOn(robotManager, 'getRegisteredRobot')
      .mockResolvedValue({ baseUrl: 'http://robot:41243' } as never);
    const result = await request(app)
      .post('/api/robots/test-id/camera/head_camera/ticket')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({});

    expect(result.status).toBe(200);
    expect(typeof result.body.ticket).toBe('string');
    expect(lookup).toHaveBeenCalledWith('test-id');
  });

  it('lets a viewer validate a schedule', async () => {
    // Safe to fire, unlike the self-service handlers: this one is a pure
    // function of the body and reaches no service that touches storage.
    const result = await request(app)
      .post('/api/patrol/cron/validate')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ cronExpression: '0 9 * * *' });

    expect(result.status).toBe(200);
    expect(result.body.valid).toBe(true);
  });

  it.each(POST_SHAPED_READS.map((pattern) => [String(pattern), pattern] as const))(
    'entry %s still matches a live write route',
    (_label, pattern) => {
      const matched = writes.filter((entry) => pattern.test(concrete(entry.path)));
      expect(matched.length).toBeGreaterThan(0);
    }
  );
});

// ---------------------------------------------------------------------------
// Stops a viewer may fire — and the resumes they may not
// ---------------------------------------------------------------------------

describe('safety halts', () => {
  it('lets a viewer stop one robot', async () => {
    const sendCommand = vi
      .spyOn(robotManager, 'sendCommand')
      .mockResolvedValue({ id: 'cmd-estop' } as never);
    const result = await request(app)
      .post('/api/robots/test-id/command')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ type: 'emergency_stop', priority: 'critical' });

    expect(result.status).toBe(200);
    expect(sendCommand).toHaveBeenCalledWith(
      'test-id',
      expect.objectContaining({ type: 'emergency_stop' })
    );
  });

  it('lets a viewer stop the fleet', async () => {
    const trigger = vi
      .spyOn(safetyService, 'triggerFleetEStop')
      .mockResolvedValue({ triggered: 1, failed: 0 } as never);
    const result = await request(app)
      .post('/api/safety/fleet/estop')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ reason: 'Hazard on the floor' });

    expect(result.status).toBe(200);
    expect(trigger).toHaveBeenCalled();
  });

  it('does not let a viewer resume the fleet', async () => {
    const reset = vi.spyOn(safetyService, 'resetFleetEStop');
    const result = await request(app)
      .post('/api/safety/fleet/estop/reset')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({});

    expect(result.status).toBe(403);
    expect(result.body.error).toBe('Forbidden');
    expect(reset).not.toHaveBeenCalled();
  });

  it('does not let a viewer resume one robot', async () => {
    const reset = vi.spyOn(safetyService, 'resetRobotEStop');
    const result = await request(app)
      .post('/api/safety/robots/test-id/estop/reset')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({});

    expect(result.status).toBe(403);
    expect(result.body.error).toBe('Forbidden');
    expect(reset).not.toHaveBeenCalled();
  });

  it('opens the fleet stop by path and the command endpoint by body only', () => {
    expect(safetyHaltWrites.map((e) => `${e.method} ${e.path}`)).toEqual([
      'POST /api/safety/fleet/estop',
    ]);
    // The command endpoint drives the robot, so it stays in the enforced sweep:
    // exempting it by path would let a viewer send `move`.
    expect(enforcedWrites).toContainEqual({ method: 'POST', path: '/api/robots/:id/command' });
    expect(isSafetyHalt('/api/robots/test-id/command', { type: 'emergency_stop' })).toBe(true);
    expect(isSafetyHalt('/api/robots/test-id/command', { type: 'move' })).toBe(false);
    expect(isSafetyHalt('/api/robots/test-id/command', {})).toBe(false);
    // No reset, anywhere.
    expect(isSafetyHalt('/api/safety/fleet/estop/reset', {})).toBe(false);
    expect(isSafetyHalt('/api/safety/robots/test-id/estop/reset', {})).toBe(false);
  });

  it.each(SAFETY_HALT_WRITES.map((pattern) => [String(pattern), pattern] as const))(
    'entry %s still matches a live write route',
    (_label, pattern) => {
      const matched = writes.filter((entry) => pattern.test(concrete(entry.path)));
      expect(matched.length).toBeGreaterThan(0);
    }
  );
});

// ---------------------------------------------------------------------------
// Untouched behaviour
// ---------------------------------------------------------------------------

describe('routes outside the guard', () => {
  it('leaves an unauthenticated login exactly as it was', async () => {
    const result = await request(app).post('/api/auth/login').send({});

    expect(result.status).not.toBe(403);
    expect(result.status).toBeLessThan(500);
    expect(result.body.error).toBeDefined();
  });

  it('declares every open write route, and only the session and worker ones', () => {
    expect(unguardedWrites).toHaveLength(EXPECTED_UNGUARDED_WRITES);
    expect(unguardedWrites.filter((e) => e.path.startsWith('/api/auth/'))).toHaveLength(
      EXPECTED_AUTH_WRITES
    );
    // The worker mounts authenticate with a shared token that carries no role,
    // so `memberOrAbove` would reject every claim. They stay on workerAuth.
    expect(unguardedWrites).toContainEqual({ method: 'POST', path: '/api/training/workers/claim' });
    expect(unguardedWrites).toContainEqual({ method: 'POST', path: '/api/twin/workers/claim' });
  });
});

// ---------------------------------------------------------------------------
// The enforcement mechanism: the enumerated stack, not a hand-written list
// ---------------------------------------------------------------------------

describe('write-route inventory', () => {
  it('enumerated the real router stack, nested routers included', () => {
    expect(writes).toHaveLength(EXPECTED_WRITE_ROUTES);
    expect(guardedWrites).toContainEqual({ method: 'DELETE', path: '/api/robots/:id' });
    expect(guardedWrites).toContainEqual({ method: 'POST', path: '/api/robots/:id/command' });
    expect(guardedWrites).toContainEqual({ method: 'PUT', path: '/api/settings' });
    // Registered on routers mounted inside routers (skills.routes.ts `/chains`,
    // training.routes.ts `/workers`) — present only if the walk recursed.
    expect(writes).toContainEqual({ method: 'POST', path: '/api/skills/chains/:id/execute' });
    expect(writes).toContainEqual({ method: 'PUT', path: '/api/skills/chains/:id' });
    expect(writes).toContainEqual({ method: 'POST', path: '/api/training/workers/heartbeat' });
  });

  it('classifies every write route, with nothing falling between the classes', () => {
    expect(
      enforcedWrites.length +
        selfServiceWrites.length +
        postShapedReadWrites.length +
        safetyHaltWrites.length +
        unguardedWrites.length
    ).toBe(writes.length);
    expect(enforcedWrites.length).toBeGreaterThan(300);
  });

  it.each(enforcedWrites.map((entry) => [entry.method, entry.path] as const))(
    'refuses a viewer on %s %s',
    async (method, path) => {
      const result = await fire(method, concrete(path))
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({});

      expect(result.status).toBe(403);
      expect(result.body.error).toBe('Forbidden');
    }
  );
});
