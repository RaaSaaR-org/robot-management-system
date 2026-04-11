/**
 * @file index.ts
 * @description Database initialization and connection management
 */

import { prisma } from './client.js';

export { prisma } from './client.js';

/**
 * Connect to the database
 */
export async function connectDatabase(): Promise<void> {
  try {
    await prisma.$connect();
    console.log('[Database] Connected successfully');

    // Seed dev user when auth is disabled so FK constraints are satisfied
    if (process.env.AUTH_DISABLED === 'true') {
      await prisma.user.upsert({
        where: { id: 'dev-user-id' },
        create: {
          id: 'dev-user-id',
          email: 'dev@neodem.local',
          passwordHash: 'disabled',
          name: 'Dev User',
          // TASK-162: unified role model — dev user is super-admin so
          // the AUTH_DISABLED=true flow retains full access (matches
          // MOCK_USER in auth.middleware.ts).
          role: 'super-admin',
          forcePasswordChange: false,
        },
        update: {},
      });
      console.log('[Database] Dev user seeded (AUTH_DISABLED=true)');
    }
  } catch (error) {
    console.error('[Database] Connection failed:', error);
    throw error;
  }
}

/**
 * Disconnect from the database
 */
export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
  console.log('[Database] Disconnected');
}

/**
 * Helper for retrying database operations
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries = 3,
  delay = 1000
): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === maxRetries) throw error;
      console.warn(
        `[Database] Operation failed, retrying in ${delay}ms... (attempt ${attempt}/${maxRetries})`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay *= 2; // Exponential backoff
    }
  }
  throw new Error('Max retries exceeded');
}
