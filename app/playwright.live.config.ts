/**
 * @file playwright.live.config.ts
 * @description Playwright config for live-backend e2e specs (app/e2e/live/**).
 *   Unlike playwright.config.ts (demo build on :4173), this expects the real dev
 *   servers to be running: server on :3001 (SQLite) and app on :1420
 *   (`cd server && npm run dev`, `cd app && npm run dev`).
 *   Run: npx playwright test --config=playwright.live.config.ts
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/live',
  outputDir: './e2e/test-results-live',
  reporter: [['list'], ['html', { outputFolder: 'e2e/report-live', open: 'never' }]],

  use: {
    // PLAYWRIGHT_LIVE_URL points the suite at a stack on another port (e.g. a
    // worktree's own vite + server while :1420 runs someone else's).
    baseURL: process.env.PLAYWRIGHT_LIVE_URL || 'http://localhost:1420',
    colorScheme: 'dark',
    viewport: { width: 1440, height: 900 },
  },

  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
