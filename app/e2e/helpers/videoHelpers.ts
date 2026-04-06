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
 * Fully resilient — catches all errors including post-click navigation failures.
 */
export async function smoothClick(page: Page, selector: string, pauseAfterMs = 1500): Promise<void> {
  try {
    const el = page.locator(selector).first();
    await el.waitFor({ timeout: 5000 }).catch(() => {});
    await el.click().catch(() => {});
    await page.waitForTimeout(pauseAfterMs).catch(() => {});
  } catch {
    // Element missing or page navigated away — continue the video flow
  }
}

/**
 * Pause for a visual moment (scene transition).
 */
export async function scenePause(page: Page, ms = 3000): Promise<void> {
  await page.waitForTimeout(ms).catch(() => {});
}

/**
 * Smooth scroll down for cinematic reveal.
 */
export async function smoothScroll(page: Page, y = 300, pauseMs = 2000): Promise<void> {
  try {
    await page.evaluate((scrollY) => window.scrollBy(0, scrollY), y);
    await page.waitForTimeout(pauseMs).catch(() => {});
  } catch {
    // Page context gone — continue
  }
}
