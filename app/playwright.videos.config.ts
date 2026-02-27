import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/videos',
  outputDir: './e2e/test-results-videos',
  timeout: 120_000,
  retries: 0,
  reporter: [['list']],

  use: {
    baseURL: 'http://localhost:4173/robot-management-system',
    colorScheme: 'dark',
    viewport: { width: 1440, height: 900 },
    video: {
      mode: 'on',
      size: { width: 1440, height: 900 },
    },
    actionTimeout: 10_000,
  },

  webServer: {
    command: 'VITE_DEMO_MODE=true npm run build && VITE_DEMO_MODE=true npx vite preview --port 4173',
    port: 4173,
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },

  projects: [
    {
      name: 'chromium-video',
      use: { browserName: 'chromium' },
    },
  ],
});
