/**
 * @file route-failure-envelope.test.ts
 * @description The contract every route catch now answers through: a Prisma
 *   failure becomes a mapped sentence, an AppError keeps its curated message
 *   and status, and anything else answers with the caller's fallback — never
 *   the caught text. The negative assertions are the point: without them the
 *   test passes on the leaking code it replaces.
 * @feature core
 */

import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { Prisma } from '@prisma/client';

const { mockAuthService } = vi.hoisted(() => ({
  mockAuthService: { register: vi.fn() },
}));

// auth.routes pulls its whole service graph in at module load; only register
// is exercised here, so the rest is stubbed to keep the router out of a
// database.
vi.mock('../../services/AuthService.js', () => ({ authService: mockAuthService }));
vi.mock('../../services/MFAService.js', () => ({ mfaService: {} }));
vi.mock('../../middleware/auth.middleware.js', () => ({
  authMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import { sendFailure } from '../../utils/routeErrors.js';
import { NotFoundError } from '../../utils/errors.js';
import { authRoutes } from '../auth.routes.js';

/** The same factory ServiceAccountService.test.ts uses to build a real P2002. */
function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    'Unique constraint failed on the fields: (`name`)\n' +
      '   at /Users/somebody/robot-management-system/server/node_modules/@prisma/client/runtime/library.js:121:5',
    { code: 'P2002', clientVersion: '5.0.0' }
  );
}

function appWith(error: unknown, fallback = 'Failed to save the thing', status = 500) {
  const app = express();
  app.get('/boom', (_req, res) => sendFailure(res, error, fallback, status));
  return app;
}

describe('sendFailure', () => {
  it('maps a P2002 to 409 without leaking the query or a file path', async () => {
    const raw = p2002();
    const res = await request(appWith(raw)).get('/boom');

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('That value is already taken. Choose a different one.');

    const body = JSON.stringify(res.body);
    expect(body).not.toContain(raw.message);
    expect(body).not.toContain('Unique constraint failed');
    expect(body).not.toContain('node_modules');
    expect(body).not.toContain('/Users/');
  });

  it('maps a PrismaClientValidationError to 400', async () => {
    const res = await request(
      appWith(new Prisma.PrismaClientValidationError('Argument `where` is missing', {
        clientVersion: '5.0.0',
      }))
    ).get('/boom');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('The request does not match what the database expects.');
    expect(JSON.stringify(res.body)).not.toContain('Argument');
  });

  it('keeps the curated message and status of an AppError a service threw', async () => {
    const res = await request(appWith(new NotFoundError('Robot', 'r-1'))).get('/boom');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Robot 'r-1' not found");
  });

  it('answers a plain Error with the caller fallback, never its message', async () => {
    const res = await request(
      appWith(new Error('connect ECONNREFUSED 127.0.0.1:5432'), 'Failed to add the teammate', 400)
    ).get('/boom');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Failed to add the teammate');
    expect(JSON.stringify(res.body)).not.toContain('ECONNREFUSED');
  });

  it('answers a non-Error throw with the fallback too', async () => {
    const res = await request(appWith('a bare string')).get('/boom');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Failed to save the thing');
    expect(JSON.stringify(res.body)).not.toContain('bare string');
  });

  it('keeps the extra body fields a route already promised its clients', async () => {
    const app = express();
    app.get('/boom', (_req, res) =>
      sendFailure(res, new Error('raw'), 'Failed to import', 400, {
        message: 'Failed to import',
        code: 'IMPORT_ERROR',
      })
    );

    const res = await request(app).get('/boom');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      message: 'Failed to import',
      code: 'IMPORT_ERROR',
      error: 'Failed to import',
    });
  });
});

describe('POST /api/auth/register', () => {
  /**
   * AuthService's duplicate-email pre-check races: two signups for the same
   * address both pass it and the second one hits the `@unique` index. Prisma
   * opens that message with "Invalid `prisma.user.create()` invocation in
   * <absolute path>", so the old `message.includes('Invalid')` guard read it
   * as a validation failure and echoed the query and the server path at 400.
   */
  function duplicateEmailOnCreate(): Prisma.PrismaClientKnownRequestError {
    return new Prisma.PrismaClientKnownRequestError(
      'Invalid `prisma.user.create()` invocation in\n' +
        '/Users/somebody/robot-management-system/server/src/repositories/UserRepository.ts:172:31\n\n' +
        '  171 async create(data: CreateUserInput): Promise<User> {\n' +
        '→ 172   const user = await prisma.user.create(\n' +
        'Unique constraint failed on the fields: (`email`)',
      { code: 'P2002', clientVersion: '6.19.1' }
    );
  }

  function authApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/auth', authRoutes);
    return app;
  }

  it('answers a racing duplicate email without echoing the Prisma dump', async () => {
    const raw = duplicateEmailOnCreate();
    mockAuthService.register.mockRejectedValue(raw);

    const res = await request(authApp())
      .post('/api/auth/register')
      .send({ email: 'taken@example.com', password: 'Passw0rdy', name: 'Ada' });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('That value is already taken. Choose a different one.');

    const body = JSON.stringify(res.body);
    expect(body).not.toContain(raw.message);
    expect(body).not.toContain('Invalid');
    expect(body).not.toContain('prisma.');
    expect(body).not.toContain('UserRepository');
    expect(body).not.toContain('/Users/');
  });

  it('still answers a weak password with the sentence AuthService wrote', async () => {
    mockAuthService.register.mockRejectedValue(
      new Error('Password must be at least 8 characters with uppercase, lowercase, and number')
    );

    const res = await request(authApp())
      .post('/api/auth/register')
      .send({ email: 'new@example.com', password: 'short', name: 'Ada' });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe(
      'Password must be at least 8 characters with uppercase, lowercase, and number'
    );
  });
});
