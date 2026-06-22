import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 30000,
    // Self-contained test env so suites don't depend on a gitignored .env
    // (CI has none). auth-middleware.test.ts overrides AUTH_DISABLED per-test.
    env: {
      JWT_SECRET: 'test-secret-key-for-tests',
      AUTH_DISABLED: 'true',
    },
  },
});
