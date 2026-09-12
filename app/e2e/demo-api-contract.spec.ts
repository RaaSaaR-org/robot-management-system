/**
 * @file demo-api-contract.spec.ts
 * @description The demo build must not answer any request with the "no handler
 *   here" 404 (TASK-300). `demo-smoke` and `app-routes` only assert that a page
 *   did not crash, so an endpoint served by the catch-all passes them today.
 *   This walk fails on the catch-all itself, naming the endpoint that is missing.
 * @feature demo
 */
import { expect, test } from '@playwright/test';

// Scoped to what the demo navigation reaches: every sidebar row, every rail
// stop and every tab of the model in `src/components/layout/navigation.ts`,
// plus the chrome pages the top bar opens. Deliberately not "every route in the
// build" — the catch-all is GET-only and unhandled writes bypass the worker
// entirely, so a full sweep surfaces far more than this task's handler budget.
const ROUTES = [
  // Dashboard + Operate
  '/dashboard',
  '/fleet', '/fleet?tab=list', '/fleet?tab=sites',
  '/control-center',
  '/alerts', '/alerts?tab=history', '/alerts?tab=incidents',
  // Automate
  '/agent',
  '/patrol', '/patrol?tab=runs',
  '/tour', '/tour?tab=visits',
  '/processes',
  // Build
  '/pipeline',
  '/data-collection', '/datasets', '/training', '/models', '/fleet-learning',
  '/deployments', '/deployments?tab=skills',
  '/marketplace',
  // Comply
  '/compliance',
  // Chrome: the top bar and its two menus
  '/settings', '/settings?tab=updates', '/account', '/docs',
  '/organizations', '/team',
];

// Same exemption as app-routes.spec.ts: headless Chromium has no GPU, so the
// 3D pages throw from three.js's renderer constructor. Every other page error
// fails the test.
const HEADLESS_WEBGL = /Error creating WebGL context/;

for (const route of ROUTES) {
  test(`${route} is served entirely by demo handlers`, async ({ page }) => {
    const unhandled: string[] = [];
    const errors: string[] = [];

    page.on('pageerror', (error) => {
      if (!HEADLESS_WEBGL.test(error.message)) errors.push(error.message);
    });
    page.on('response', (response) => {
      const url = response.url();
      if (!url.includes('/api/')) return;
      // The header is the mock layer's own marker. The status is the fallback:
      // a service-worker response can reach Playwright with its headers
      // stripped, and a 404 on /api in a build with no server is the same fact.
      const marked = response.headers()['x-msw-unhandled'] === '1';
      if (marked || response.status() === 404) {
        unhandled.push(`${response.status()} ${new URL(url).pathname}`);
      }
    });

    await page.goto(`./#${route}`);
    await expect(page.locator('h1').first()).toBeVisible();
    await page.waitForLoadState('networkidle');

    expect(unhandled, 'endpoints with no demo handler').toEqual([]);
    expect(errors, 'page errors').toEqual([]);
  });
}
