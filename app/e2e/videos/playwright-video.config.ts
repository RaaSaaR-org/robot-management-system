import { defineConfig } from '@playwright/test';

/**
 * Video recording config — records each flow as a .webm.
 * Run: npx playwright test --config e2e/videos/playwright-video.config.ts
 * Output: e2e/test-results-videos/
 */
export default defineConfig({
  testDir: '.',
  outputDir: '../test-results-videos',
  reporter: [['list']],
  timeout: 180_000,

  use: {
    baseURL: 'http://localhost:4173/robot-management-system',
    colorScheme: 'dark',
    viewport: { width: 1440, height: 900 },
    video: {
      mode: 'on',
      size: { width: 1440, height: 900 },
    },
    launchOptions: {
      slowMo: 50,
    },
    actionTimeout: 5_000,
    navigationTimeout: 15_000,
  },

  webServer: {
    command: 'cd .. && VITE_DEMO_MODE=true npm run build && VITE_DEMO_MODE=true npx vite preview --port 4173',
    port: 4173,
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },

  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
