import { Page } from '@playwright/test';

/**
 * Smooth navigation for video recording — waits for content and adds visual pause.
 */
export async function smoothGoto(page: Page, path: string, pauseMs = 2000): Promise<void> {
  await page.goto(path);
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(pauseMs);
}

/**
 * Smooth click with pre/post pause for video clarity.
 */
export async function smoothClick(page: Page, selector: string, pauseAfterMs = 1500): Promise<void> {
  const el = page.locator(selector).first();
  await el.waitFor({ timeout: 5000 }).catch(() => {});
  await el.click().catch(() => {});
  await page.waitForTimeout(pauseAfterMs);
}

/**
 * Pause for a visual moment (scene transition).
 */
export async function scenePause(page: Page, ms = 3000): Promise<void> {
  await page.waitForTimeout(ms);
}
