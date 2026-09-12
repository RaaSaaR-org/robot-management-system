/**
 * @file auth.types.test.ts
 * @description The client role matrix is one half of a rule the server states
 *   too (TASK-284). These assertions are what breaks if someone later narrows
 *   the client matrix out of step with the server's route guards.
 * @feature auth
 */

import { describe, expect, it } from 'vitest';
import { ROLE_PERMISSIONS, hasPermission } from '../auth.types';
import type { User } from '../auth.types';

function userWithRole(role: User['role']): User {
  return {
    id: 'u1',
    email: 'u1@example.com',
    name: 'Test User',
    role,
    createdAt: '2026-09-12T00:00:00.000Z',
    updatedAt: '2026-09-12T00:00:00.000Z',
  };
}

describe('the role permission matrix', () => {
  it('gives a member robots:write, mirroring the server’s memberOrAbove guard', () => {
    // server/src/middleware/auth.middleware.ts:411 admits super-admin, owner
    // and member to the destructive robot routes. If that guard is narrowed to
    // ownerOnly, this entry must go with it — otherwise the UI offers a member
    // an Unregister the API answers with 403.
    expect(ROLE_PERMISSIONS.member).toContain('robots:write');
    expect(hasPermission(userWithRole('member'), 'robots:write')).toBe(true);
    expect(hasPermission(userWithRole('member'), 'robots:command')).toBe(true);
  });

  it('gives a viewer neither robots:write nor robots:command', () => {
    expect(ROLE_PERMISSIONS.viewer).not.toContain('robots:write');
    expect(ROLE_PERMISSIONS.viewer).not.toContain('robots:command');
    expect(hasPermission(userWithRole('viewer'), 'robots:write')).toBe(false);
    expect(hasPermission(userWithRole('viewer'), 'robots:command')).toBe(false);
    // Reading is untouched — a viewer still sees the fleet.
    expect(hasPermission(userWithRole('viewer'), 'robots:read')).toBe(true);
  });

  it.each(['owner', 'super-admin'] as const)('leaves %s holding both robot permissions', (role) => {
    expect(hasPermission(userWithRole(role), 'robots:write')).toBe(true);
    expect(hasPermission(userWithRole(role), 'robots:command')).toBe(true);
  });
});
