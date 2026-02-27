import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/test-results',
  reporter: [['list'], ['html', { outputFolder: 'e2e/report', open: 'never' }]],

  use: {
    baseURL: 'http://localhost:4173/robot-management-system',
    colorScheme: 'dark',
    viewport: { width: 1440, height: 900 },
  },

  // Build demo app and start preview server
  webServer: {
    command: 'VITE_DEMO_MODE=true npm run build && VITE_DEMO_MODE=true npx vite preview --port 4173',
    port: 4173,
    reuseExistingServer: !process.env.CI,
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
