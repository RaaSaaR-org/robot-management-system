/**
 * @file AuthService.ts
 * @description Authentication business logic service
 */

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import {
  userRepository,
  refreshTokenRepository,
  type User,
} from '../repositories/index.js';

/**
 * JWT payload structure
 */
export interface TokenPayload {
  userId: string;
  email: string;
  name: string;
  role: string;
}

/**
 * Login/Register response
 */
export interface AuthResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/**
 * Refresh response
 */
export interface RefreshResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/**
 * Password reset token response
 */
export interface PasswordResetResponse {
  message: string;
  resetToken?: string; // Only returned in dev mode
}

// Configuration
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const JWT_ACCESS_EXPIRES = process.env.JWT_ACCESS_EXPIRES || '15m';
const JWT_REFRESH_EXPIRES = process.env.JWT_REFRESH_EXPIRES || '7d';
const BCRYPT_ROUNDS = 10;
const PASSWORD_RESET_EXPIRES_HOURS = 1;
const MAX_REFRESH_TOKENS_PER_USER = 5;

/**
 * Parse duration string to milliseconds
 */
function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)([smhd])$/);
  if (!match) {
    return 15 * 60 * 1000; // Default 15 minutes
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case 's':
      return value * 1000;
    case 'm':
      return value * 60 * 1000;
    case 'h':
      return value * 60 * 60 * 1000;
    case 'd':
      return value * 24 * 60 * 60 * 1000;
    default:
      return 15 * 60 * 1000;
  }
}

export class AuthService {
  /**
   * Register a new user
   */
  async register(
    email: string,
    password: string,
    name: string
  ): Promise<AuthResponse> {
    // Check if email already exists
    const existingUser = await userRepository.findByEmail(email);
    if (existingUser) {
      throw new Error('Email already registered');
    }

    // Validate email format
    if (!this.isValidEmail(email)) {
      throw new Error('Invalid email format');
    }

    // Validate password strength
    if (!this.isValidPassword(password)) {
      throw new Error(
        'Password must be at least 8 characters with uppercase, lowercase, and number'
      );
    }

    // Hash password
    const passwordHash = await this.hashPassword(password);

    // Create user
    const user = await userRepository.create({
      email,
      passwordHash,
      name,
    });

    // Update last login
    await userRepository.updateLastLogin(user.id);

    // Generate tokens
    const accessToken = this.generateAccessToken(user);
    const refreshToken = await this.createRefreshToken(user.id);

    return {
      user,
      accessToken,
      refreshToken,
      expiresIn: parseDuration(JWT_ACCESS_EXPIRES),
    };
  }

  /**
   * Login with email and password
   */
  async login(email: string, password: string): Promise<AuthResponse> {
    // Find user by email
    const user = await userRepository.findByEmailWithPassword(email);
    if (!user) {
      throw new Error('Invalid email or password');
    }

    // Check if user is active
    if (!user.isActive) {
      throw new Error('Account is deactivated');
    }

    // Verify password
    const isValid = await this.verifyPassword(password, user.passwordHash);
    if (!isValid) {
      throw new Error('Invalid email or password');
    }

    // Update last login
    await userRepository.updateLastLogin(user.id);

    // Generate tokens
    const accessToken = this.generateAccessToken(user);
    const refreshToken = await this.createRefreshToken(user.id);

    // Return user without password hash
    const { passwordHash: _, passwordResetToken: __, passwordResetExpires: ___, ...safeUser } = user;

    return {
      user: safeUser,
      accessToken,
      refreshToken,
      expiresIn: parseDuration(JWT_ACCESS_EXPIRES),
    };
  }

  /**
   * Logout - invalidate refresh token
   */
  async logout(userId: string, refreshToken?: string): Promise<void> {
    if (refreshToken) {
      // Delete specific refresh token
      await refreshTokenRepository.deleteByToken(refreshToken);
    } else {
      // Delete all refresh tokens for user
      await refreshTokenRepository.deleteAllForUser(userId);
    }
  }

  /**
   * Get current user by ID
   */
  async getCurrentUser(userId: string): Promise<User> {
    const user = await userRepository.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }
    return user;
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshTokens(refreshToken: string): Promise<RefreshResponse> {
    // Find and validate refresh token
    const storedToken = await refreshTokenRepository.findValidByToken(refreshToken);
    if (!storedToken) {
      throw new Error('Invalid or expired refresh token');
    }

    // Get user
    const user = await userRepository.findById(storedToken.userId);
    if (!user) {
      throw new Error('User not found');
    }

    if (!user.isActive) {
      throw new Error('Account is deactivated');
    }

    // Delete old refresh token
    await refreshTokenRepository.deleteByToken(refreshToken);

    // Generate new tokens
    const newAccessToken = this.generateAccessToken(user);
    const newRefreshToken = await this.createRefreshToken(user.id);

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      expiresIn: parseDuration(JWT_ACCESS_EXPIRES),
    };
  }

  /**
   * Change password for authenticated user
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string
  ): Promise<void> {
    // Get user with password
    const user = await userRepository.findByIdWithPassword(userId);
    if (!user) {
      throw new Error('User not found');
    }

    // Verify current password
    const isValid = await this.verifyPassword(currentPassword, user.passwordHash);
    if (!isValid) {
      throw new Error('Current password is incorrect');
    }

    // Validate new password
    if (!this.isValidPassword(newPassword)) {
      throw new Error(
        'Password must be at least 8 characters with uppercase, lowercase, and number'
      );
    }

    // Hash and update password
    const passwordHash = await this.hashPassword(newPassword);
    await userRepository.updatePassword(userId, passwordHash);

    // Invalidate all refresh tokens (force re-login on other devices)
    await refreshTokenRepository.deleteAllForUser(userId);
  }

  /**
   * Request password reset
   */
  async forgotPassword(email: string): Promise<PasswordResetResponse> {
    const user = await userRepository.findByEmail(email);

    // Always return success message to prevent email enumeration
    const message =
      'If an account exists with this email, you will receive a password reset link.';

    if (!user) {
      return { message };
    }

    // Generate reset token
    const resetToken = this.generateSecureToken();
    const expires = new Date(
      Date.now() + PASSWORD_RESET_EXPIRES_HOURS * 60 * 60 * 1000
    );

    // Store reset token
    await userRepository.setPasswordResetToken(user.id, resetToken, expires);

    // In production, send email here
    // For development, return the token in response
    const isDev = process.env.NODE_ENV !== 'production';

    return {
      message,
      resetToken: isDev ? resetToken : undefined,
    };
  }

  /**
   * Reset password using token
   */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    // Find user by reset token
    const user = await userRepository.findByPasswordResetToken(token);
    if (!user) {
      throw new Error('Invalid or expired reset token');
    }

    // Validate new password
    if (!this.isValidPassword(newPassword)) {
      throw new Error(
        'Password must be at least 8 characters with uppercase, lowercase, and number'
      );
    }

    // Hash and update password (also clears reset token)
    const passwordHash = await this.hashPassword(newPassword);
    await userRepository.updatePassword(user.id, passwordHash);

    // Invalidate all refresh tokens
    await refreshTokenRepository.deleteAllForUser(user.id);
  }

  /**
   * Generate JWT access token
   */
  generateAccessToken(user: User): string {
    const payload: TokenPayload = {
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    };

    // Convert duration string to seconds for jwt
    const expiresInMs = parseDuration(JWT_ACCESS_EXPIRES);
    const expiresInSeconds = Math.floor(expiresInMs / 1000);

    return jwt.sign(payload, JWT_SECRET, {
      expiresIn: expiresInSeconds,
    });
  }

  /**
   * Verify and decode access token
   */
  verifyAccessToken(token: string): TokenPayload | null {
    try {
      const payload = jwt.verify(token, JWT_SECRET) as TokenPayload;
      return payload;
    } catch {
      return null;
    }
  }

  /**
   * Create and store refresh token
   */
  private async createRefreshToken(userId: string): Promise<string> {
    const token = this.generateSecureToken();
    const expiresAt = new Date(Date.now() + parseDuration(JWT_REFRESH_EXPIRES));

    await refreshTokenRepository.create(userId, token, expiresAt);

    // Prune excess tokens to prevent accumulation
    await refreshTokenRepository.pruneExcessTokens(
      userId,
      MAX_REFRESH_TOKENS_PER_USER
    );

    return token;
  }

  /**
   * Generate secure random token
   */
  private generateSecureToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Hash password with bcrypt
   */
  private async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, BCRYPT_ROUNDS);
  }

  /**
   * Verify password against hash
   */
  private async verifyPassword(
    password: string,
    hash: string
  ): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  /**
   * Validate email format
   */
  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Validate password strength
   */
  private isValidPassword(password: string): boolean {
    // At least 8 characters, one uppercase, one lowercase, one number
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
    return passwordRegex.test(password);
  }

  /**
   * Clean up expired refresh tokens (call periodically)
   */
  async cleanupExpiredTokens(): Promise<number> {
    return refreshTokenRepository.deleteExpired();
  }
}

export const authService = new AuthService();
