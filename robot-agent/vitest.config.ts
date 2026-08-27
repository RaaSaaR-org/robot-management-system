import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // `scripts/` is in here on purpose: planner-bench.ts drives the real
    // Planner and had drifted against it unnoticed (TASK-221). Its test grades
    // the grader — the bench's own pass/dash rules — not a model.
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
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
