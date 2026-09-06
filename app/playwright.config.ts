/**
 * @file playwright.config.ts
 * @description The default e2e gate: the demo build, served from a preview
 *   server, with MSW answering the API. `npx playwright test` runs THIS.
 *
 * ## Why testIgnore is the most important line in the file
 *
 * `testDir: './e2e'` collects recursively, and three sibling suites under
 * `e2e/` are not gates and cannot pass here. Each already has its own config
 * that is correct; the only defect was that this one swept them up as well and
 * ran them with the wrong settings:
 *
 *   * `e2e/videos/**` — cinematic screen recordings with ZERO `expect()` calls,
 *     authored for `playwright.videos.config.ts` (timeout 120 s, actionTimeout
 *     10 s). Under this config's defaults (timeout 30 s, actionTimeout 0 =
 *     infinite) a `smoothClick` on a selector matching nothing never rejects,
 *     so the swallow at `e2e/helpers/videoHelpers.ts:39` cannot swallow it and
 *     the recording dies on the 30 s test timeout. Record them with
 *     `npm run e2e:videos`.
 *   * `e2e/live/**` — specs whose own headers say they need the real stack
 *     (server :3001 + app :1420). Run them with
 *     `--config=playwright.live.config.ts`. Pointed at the demo preview instead,
 *     their absolute `page.goto('/datasets')` escapes this server's
 *     `/robot-management-system` base path entirely and lands on vite's
 *     "public base URL" notice page, which serves no app bundle at all.
 *   * `e2e/scripts/**` — not tests. `datasets-shot.ts` is a screenshot utility
 *     against one developer's LAN address with a hand-seeded token file.
 *
 * Nothing here is deleted coverage: every excluded file runs from the entry
 * point it was written for. What is excluded is a suite that was red from the
 * day it was written and could not be otherwise — and, because
 * `.github/workflows/check.yml` never ran Playwright, was never seen to be.
 *
 * Two specs that used to sit in the default set now live in `e2e/live/`
 * instead: `datasets-page` and `training-flow` assert the real Dataset Hub and
 * Training Studio, and this build cannot render either. Both pages return
 * `<DemoFeaturePlaceholder>` before their first hook when `VITE_DEMO_MODE` is
 * set (`DatasetsPage.tsx:43`, `TrainingPage.tsx:36`) — a deliberate product
 * decision from #59 that ships to GitHub Pages, and 13 pages do it. The specs
 * were added in #109, a month AFTER that gate landed, so they never had a
 * passing run under their own config. They belong where a non-demo app is
 * served. `datacollection-vr.spec.ts` moved for the reason its own header
 * already gave: "Requires a LIVE stack (server :3001 + robot-agent + app)".
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testIgnore: ['**/videos/**', '**/live/**', '**/scripts/**'],
  outputDir: './e2e/test-results',
  reporter: [['list'], ['html', { outputFolder: 'e2e/report', open: 'never' }]],

  // A spec that hangs should fail the gate, not stall it: this config's
  // default actionTimeout is 0 (infinite), which is survivable only because
  // every spec left here asserts with `expect`, whose own 5 s timeout applies.
  forbidOnly: !!process.env.CI,

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
