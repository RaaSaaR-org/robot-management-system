import { Page } from '@playwright/test';

/**
 * Navigates to a demo page and waits until MSW is ready and data has loaded.
 */
export async function gotoDemo(page: Page, path: string): Promise<void> {
  await page.goto(path);
  // Wait for MSW service worker to be active
  await page.waitForFunction(() => {
    return navigator.serviceWorker.controller !== null;
  }, { timeout: 15_000 }).catch(() => {
    // Service worker might already be active from a previous navigation
  });
  // Wait for network to settle (MSW intercepts resolve quickly)
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
  // Brief settle for React renders
  await page.waitForTimeout(800);
}

/**
 * Takes a named screenshot and saves to e2e/results/screenshots/.
 */
export async function screenshot(page: Page, name: string): Promise<void> {
  await page.screenshot({
    path: `e2e/results/screenshots/${name}.png`,
    fullPage: false, // viewport screenshot for consistent size
  });
}

/**
 * Takes a mobile viewport screenshot.
 */
export async function screenshotMobile(page: Page, name: string): Promise<void> {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await page.screenshot({
    path: `e2e/results/screenshots/${name}-mobile.png`,
    fullPage: false,
  });
  // Reset to desktop
  await page.setViewportSize({ width: 1440, height: 900 });
}
