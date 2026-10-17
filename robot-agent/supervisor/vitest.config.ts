import { defineConfig } from 'vitest/config';

// Supervisor tests spawn real stub children (python) on loopback ports and scan
// /proc, so the files run one at a time: a stub named xr_teleoperate in one file
// must not refuse an arm_sdk start in another.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 30_000,
  },
});
