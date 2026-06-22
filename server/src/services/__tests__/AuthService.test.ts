/**
 * @file AuthService.test.ts
 * @description Unit tests for AuthService — register, login, logout, token refresh,
 *   password change/reset, JWT generation/verification, and token cleanup. All
 *   repository boundaries are mocked; bcrypt/jwt/crypto run real (pure, no I/O).
 * @feature auth
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { User, UserWithPassword } from '../../repositories/index.js';

// ---------------------------------------------------------------------------
// Mocks for external boundaries (repositories touch the DB)
// ---------------------------------------------------------------------------

vi.mock('../../repositories/index.js', () => ({
  userRepository: {
    findByEmail: vi.fn(),
    findByEmailWithPassword: vi.fn(),
    findById: vi.fn(),
    findByIdWithPassword: vi.fn(),
    findByPasswordResetToken: vi.fn(),
    create: vi.fn(),
    updateLastLogin: vi.fn(),
    updatePassword: vi.fn(),
    setPasswordResetToken: vi.fn(),
  },
  refreshTokenRepository: {
    create: vi.fn(),
    deleteByToken: vi.fn(),
    deleteAllForUser: vi.fn(),
    findValidByToken: vi.fn(),
    pruneExcessTokens: vi.fn(),
    deleteExpired: vi.fn(),
  },
}));

import { AuthService, authService } from '../AuthService.js';
import { userRepository, refreshTokenRepository } from '../../repositories/index.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_PASSWORD = 'Password123';

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'u1',
    email: 'alice@example.com',
    name: 'Alice',
    role: 'member',
    tenantId: 't1',
    isActive: true,
    forcePasswordChange: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeUserWithPassword(
  overrides: Partial<UserWithPassword> = {}
): UserWithPassword {
  return {
    ...makeUser(),
    passwordHash: 'hashed',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Sensible defaults so token side-effects don't blow up.
  vi.mocked(refreshTokenRepository.create).mockResolvedValue(undefined as never);
  vi.mocked(refreshTokenRepository.pruneExcessTokens).mockResolvedValue(undefined as never);
  vi.mocked(refreshTokenRepository.deleteAllForUser).mockResolvedValue(undefined as never);
  vi.mocked(refreshTokenRepository.deleteByToken).mockResolvedValue(undefined as never);
  vi.mocked(userRepository.updateLastLogin).mockResolvedValue(undefined as never);
  vi.mocked(userRepository.updatePassword).mockResolvedValue(true as never);
});

// ===========================================================================
// register
// ===========================================================================

describe('register', () => {
  it('creates a user, issues tokens, and returns a sanitized response', async () => {
    vi.mocked(userRepository.findByEmail).mockResolvedValue(null as never);
    const created = makeUser({ id: 'new', email: 'bob@example.com', name: 'Bob' });
    vi.mocked(userRepository.create).mockResolvedValue(created as never);

    const result = await authService.register('bob@example.com', VALID_PASSWORD, 'Bob');

    expect(result.user).toBe(created);
    expect(typeof result.accessToken).toBe('string');
    expect(typeof result.refreshToken).toBe('string');
    expect(result.expiresIn).toBe(15 * 60 * 1000); // default 15m
    expect(result.mustChangePassword).toBe(false);

    // password should be hashed, not stored raw
    const createArg = vi.mocked(userRepository.create).mock.calls[0][0];
    expect(createArg.email).toBe('bob@example.com');
    expect(createArg.name).toBe('Bob');
    expect(createArg.passwordHash).not.toBe(VALID_PASSWORD);
    expect(createArg.passwordHash.length).toBeGreaterThan(0);

    expect(userRepository.updateLastLogin).toHaveBeenCalledWith('new');
    expect(refreshTokenRepository.create).toHaveBeenCalledOnce();
  });

  it('propagates mustChangePassword from the created user', async () => {
    vi.mocked(userRepository.findByEmail).mockResolvedValue(null as never);
    vi.mocked(userRepository.create).mockResolvedValue(
      makeUser({ forcePasswordChange: true }) as never
    );

    const result = await authService.register('c@example.com', VALID_PASSWORD, 'C');
    expect(result.mustChangePassword).toBe(true);
  });

  it('throws when the email is already registered', async () => {
    vi.mocked(userRepository.findByEmail).mockResolvedValue(makeUser() as never);
    await expect(
      authService.register('alice@example.com', VALID_PASSWORD, 'Alice')
    ).rejects.toThrow('Email already registered');
    expect(userRepository.create).not.toHaveBeenCalled();
  });

  it('rejects an invalid email format', async () => {
    vi.mocked(userRepository.findByEmail).mockResolvedValue(null as never);
    await expect(
      authService.register('not-an-email', VALID_PASSWORD, 'X')
    ).rejects.toThrow('Invalid email format');
    expect(userRepository.create).not.toHaveBeenCalled();
  });

  it('rejects a weak password', async () => {
    vi.mocked(userRepository.findByEmail).mockResolvedValue(null as never);
    await expect(
      authService.register('weak@example.com', 'short', 'X')
    ).rejects.toThrow(/Password must be at least 8 characters/);
    expect(userRepository.create).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// login
// ===========================================================================

describe('login', () => {
  it('logs in with valid credentials and strips sensitive fields', async () => {
    // create a real bcrypt hash for the password so verifyPassword passes
    const bcrypt = (await import('bcryptjs')).default;
    const passwordHash = await bcrypt.hash(VALID_PASSWORD, 10);

    vi.mocked(userRepository.findByEmailWithPassword).mockResolvedValue(
      makeUserWithPassword({
        passwordHash,
        passwordResetToken: 'secret-reset',
        passwordResetExpires: new Date(),
      }) as never
    );

    const result = await authService.login('alice@example.com', VALID_PASSWORD);

    expect(typeof result.accessToken).toBe('string');
    expect(typeof result.refreshToken).toBe('string');
    expect(result.mustChangePassword).toBe(false);
    // sensitive fields removed from returned user
    expect('passwordHash' in result.user).toBe(false);
    expect('passwordResetToken' in result.user).toBe(false);
    expect('passwordResetExpires' in result.user).toBe(false);
    expect(result.user.email).toBe('alice@example.com');

    expect(userRepository.updateLastLogin).toHaveBeenCalledWith('u1');
  });

  it('throws on unknown email', async () => {
    vi.mocked(userRepository.findByEmailWithPassword).mockResolvedValue(null as never);
    await expect(authService.login('nope@example.com', VALID_PASSWORD)).rejects.toThrow(
      'Invalid email or password'
    );
  });

  it('throws when the account is deactivated', async () => {
    vi.mocked(userRepository.findByEmailWithPassword).mockResolvedValue(
      makeUserWithPassword({ isActive: false }) as never
    );
    await expect(authService.login('alice@example.com', VALID_PASSWORD)).rejects.toThrow(
      'Account is deactivated'
    );
  });

  it('throws on a wrong password', async () => {
    const bcrypt = (await import('bcryptjs')).default;
    const passwordHash = await bcrypt.hash(VALID_PASSWORD, 10);
    vi.mocked(userRepository.findByEmailWithPassword).mockResolvedValue(
      makeUserWithPassword({ passwordHash }) as never
    );
    await expect(
      authService.login('alice@example.com', 'WrongPass123')
    ).rejects.toThrow('Invalid email or password');
    expect(userRepository.updateLastLogin).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// logout
// ===========================================================================

describe('logout', () => {
  it('deletes only the given refresh token when provided', async () => {
    await authService.logout('u1', 'tok-abc');
    expect(refreshTokenRepository.deleteByToken).toHaveBeenCalledWith('tok-abc');
    expect(refreshTokenRepository.deleteAllForUser).not.toHaveBeenCalled();
  });

  it('deletes all tokens for the user when no token is provided', async () => {
    await authService.logout('u1');
    expect(refreshTokenRepository.deleteAllForUser).toHaveBeenCalledWith('u1');
    expect(refreshTokenRepository.deleteByToken).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// getCurrentUser
// ===========================================================================

describe('getCurrentUser', () => {
  it('returns the user when found', async () => {
    const user = makeUser();
    vi.mocked(userRepository.findById).mockResolvedValue(user as never);
    await expect(authService.getCurrentUser('u1')).resolves.toBe(user);
  });

  it('throws when the user does not exist', async () => {
    vi.mocked(userRepository.findById).mockResolvedValue(null as never);
    await expect(authService.getCurrentUser('ghost')).rejects.toThrow('User not found');
  });
});

// ===========================================================================
// refreshTokens
// ===========================================================================

describe('refreshTokens', () => {
  it('rotates tokens for a valid refresh token', async () => {
    vi.mocked(refreshTokenRepository.findValidByToken).mockResolvedValue({
      userId: 'u1',
    } as never);
    vi.mocked(userRepository.findById).mockResolvedValue(makeUser() as never);

    const result = await authService.refreshTokens('old-token');

    expect(typeof result.accessToken).toBe('string');
    expect(typeof result.refreshToken).toBe('string');
    expect(result.expiresIn).toBe(15 * 60 * 1000);
    // old token revoked, new one created
    expect(refreshTokenRepository.deleteByToken).toHaveBeenCalledWith('old-token');
    expect(refreshTokenRepository.create).toHaveBeenCalledOnce();
  });

  it('throws on an invalid/expired refresh token', async () => {
    vi.mocked(refreshTokenRepository.findValidByToken).mockResolvedValue(null as never);
    await expect(authService.refreshTokens('bad')).rejects.toThrow(
      'Invalid or expired refresh token'
    );
    expect(refreshTokenRepository.deleteByToken).not.toHaveBeenCalled();
  });

  it('throws when the token references a missing user', async () => {
    vi.mocked(refreshTokenRepository.findValidByToken).mockResolvedValue({
      userId: 'gone',
    } as never);
    vi.mocked(userRepository.findById).mockResolvedValue(null as never);
    await expect(authService.refreshTokens('tok')).rejects.toThrow('User not found');
  });

  it('throws when the user is deactivated', async () => {
    vi.mocked(refreshTokenRepository.findValidByToken).mockResolvedValue({
      userId: 'u1',
    } as never);
    vi.mocked(userRepository.findById).mockResolvedValue(
      makeUser({ isActive: false }) as never
    );
    await expect(authService.refreshTokens('tok')).rejects.toThrow('Account is deactivated');
    expect(refreshTokenRepository.deleteByToken).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// changePassword
// ===========================================================================

describe('changePassword', () => {
  it('changes the password and invalidates all refresh tokens', async () => {
    const bcrypt = (await import('bcryptjs')).default;
    const currentHash = await bcrypt.hash(VALID_PASSWORD, 10);
    vi.mocked(userRepository.findByIdWithPassword).mockResolvedValue(
      makeUserWithPassword({ passwordHash: currentHash }) as never
    );

    await authService.changePassword('u1', VALID_PASSWORD, 'NewPass456');

    const updateArg = vi.mocked(userRepository.updatePassword).mock.calls[0];
    expect(updateArg[0]).toBe('u1');
    expect(updateArg[1]).not.toBe('NewPass456'); // hashed
    expect(refreshTokenRepository.deleteAllForUser).toHaveBeenCalledWith('u1');
  });

  it('throws when the user is not found', async () => {
    vi.mocked(userRepository.findByIdWithPassword).mockResolvedValue(null as never);
    await expect(
      authService.changePassword('u1', VALID_PASSWORD, 'NewPass456')
    ).rejects.toThrow('User not found');
  });

  it('throws when the current password is incorrect', async () => {
    const bcrypt = (await import('bcryptjs')).default;
    const currentHash = await bcrypt.hash(VALID_PASSWORD, 10);
    vi.mocked(userRepository.findByIdWithPassword).mockResolvedValue(
      makeUserWithPassword({ passwordHash: currentHash }) as never
    );
    await expect(
      authService.changePassword('u1', 'WrongOld1', 'NewPass456')
    ).rejects.toThrow('Current password is incorrect');
    expect(userRepository.updatePassword).not.toHaveBeenCalled();
  });

  it('throws when the new password is too weak', async () => {
    const bcrypt = (await import('bcryptjs')).default;
    const currentHash = await bcrypt.hash(VALID_PASSWORD, 10);
    vi.mocked(userRepository.findByIdWithPassword).mockResolvedValue(
      makeUserWithPassword({ passwordHash: currentHash }) as never
    );
    await expect(
      authService.changePassword('u1', VALID_PASSWORD, 'weak')
    ).rejects.toThrow(/Password must be at least 8 characters/);
    expect(userRepository.updatePassword).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// forgotPassword
// ===========================================================================

describe('forgotPassword', () => {
  it('returns the generic message without a token for an unknown email', async () => {
    vi.mocked(userRepository.findByEmail).mockResolvedValue(null as never);
    const result = await authService.forgotPassword('ghost@example.com');
    expect(result.message).toMatch(/If an account exists/);
    expect(result.resetToken).toBeUndefined();
    expect(userRepository.setPasswordResetToken).not.toHaveBeenCalled();
  });

  it('stores a reset token and returns it in non-production mode', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      vi.mocked(userRepository.findByEmail).mockResolvedValue(makeUser() as never);
      vi.mocked(userRepository.setPasswordResetToken).mockResolvedValue(undefined as never);

      const result = await authService.forgotPassword('alice@example.com');

      expect(result.resetToken).toBeDefined();
      expect(result.resetToken!.length).toBeGreaterThan(0);
      const args = vi.mocked(userRepository.setPasswordResetToken).mock.calls[0];
      expect(args[0]).toBe('u1');
      expect(args[1]).toBe(result.resetToken);
      expect(args[2]).toBeInstanceOf(Date);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it('does not leak the reset token in production mode', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      vi.mocked(userRepository.findByEmail).mockResolvedValue(makeUser() as never);
      vi.mocked(userRepository.setPasswordResetToken).mockResolvedValue(undefined as never);

      const result = await authService.forgotPassword('alice@example.com');

      expect(result.resetToken).toBeUndefined();
      // token still stored server-side
      expect(userRepository.setPasswordResetToken).toHaveBeenCalledOnce();
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});

// ===========================================================================
// resetPassword
// ===========================================================================

describe('resetPassword', () => {
  it('resets the password and invalidates refresh tokens', async () => {
    vi.mocked(userRepository.findByPasswordResetToken).mockResolvedValue(
      makeUser() as never
    );

    await authService.resetPassword('reset-tok', 'NewPass456');

    const updateArg = vi.mocked(userRepository.updatePassword).mock.calls[0];
    expect(updateArg[0]).toBe('u1');
    expect(updateArg[1]).not.toBe('NewPass456'); // hashed
    expect(refreshTokenRepository.deleteAllForUser).toHaveBeenCalledWith('u1');
  });

  it('throws on an invalid/expired reset token', async () => {
    vi.mocked(userRepository.findByPasswordResetToken).mockResolvedValue(null as never);
    await expect(authService.resetPassword('bad', 'NewPass456')).rejects.toThrow(
      'Invalid or expired reset token'
    );
    expect(userRepository.updatePassword).not.toHaveBeenCalled();
  });

  it('rejects a weak new password', async () => {
    vi.mocked(userRepository.findByPasswordResetToken).mockResolvedValue(
      makeUser() as never
    );
    await expect(authService.resetPassword('reset-tok', 'weak')).rejects.toThrow(
      /Password must be at least 8 characters/
    );
    expect(userRepository.updatePassword).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// generateAccessToken / verifyAccessToken
// ===========================================================================

describe('access token round-trip', () => {
  it('generates a token whose payload verifies back to the user claims', () => {
    const user = makeUser({ id: 'rt1', email: 'rt@example.com', name: 'RT', role: 'owner' });
    const token = authService.generateAccessToken(user);
    expect(typeof token).toBe('string');

    const payload = authService.verifyAccessToken(token);
    expect(payload).not.toBeNull();
    expect(payload!.userId).toBe('rt1');
    expect(payload!.email).toBe('rt@example.com');
    expect(payload!.name).toBe('RT');
    expect(payload!.role).toBe('owner');
    expect(payload!.tenantId).toBe('t1');
  });

  it('encodes a null tenantId when the user has none', () => {
    const user = makeUser({ tenantId: undefined });
    const payload = authService.verifyAccessToken(authService.generateAccessToken(user));
    expect(payload!.tenantId).toBeNull();
  });

  it('returns null for a malformed/invalid token', () => {
    expect(authService.verifyAccessToken('not.a.valid.jwt')).toBeNull();
    expect(authService.verifyAccessToken('')).toBeNull();
  });
});

// ===========================================================================
// cleanupExpiredTokens
// ===========================================================================

describe('cleanupExpiredTokens', () => {
  it('delegates to the repository and returns the deleted count', async () => {
    vi.mocked(refreshTokenRepository.deleteExpired).mockResolvedValue(7 as never);
    await expect(authService.cleanupExpiredTokens()).resolves.toBe(7);
    expect(refreshTokenRepository.deleteExpired).toHaveBeenCalledOnce();
  });
});

// ===========================================================================
// class export sanity
// ===========================================================================

describe('AuthService class', () => {
  it('is constructable and the singleton is an instance of it', () => {
    expect(authService).toBeInstanceOf(AuthService);
    expect(new AuthService()).toBeInstanceOf(AuthService);
  });
});
