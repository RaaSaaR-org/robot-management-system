/**
 * @file setup.ts
 * @description Vitest global test setup for server
 */

import { vi } from 'vitest';

// Mock environment variables for testing
process.env.AUTH_DISABLED = 'true';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./test.db';
process.env.JWT_SECRET = 'test-secret-key-for-tests';

// Mock the Prisma client to avoid real DB connections in unit tests
vi.mock('../database/client.js', () => ({
  prisma: {
    $connect: vi.fn(),
    $disconnect: vi.fn(),
    robot: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    zone: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn(),
    },
    conversation: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
    },
    alert: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
    },
    complianceLog: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
    },
  },
}));
