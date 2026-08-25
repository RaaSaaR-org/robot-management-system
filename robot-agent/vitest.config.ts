import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Ephemeral test servers bind loopback, not the dual-stack wildcard, so a
    // throwaway port cannot collide with a foreign IPv4 listener (TASK-218).
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        'src/index.ts',
        'src/**/__tests__/**',
      ],
    },
  },
});
