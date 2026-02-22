import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './playwright-tests',
  use: { browserName: 'chromium', launchOptions: { args: ['--no-sandbox'] } },
});
