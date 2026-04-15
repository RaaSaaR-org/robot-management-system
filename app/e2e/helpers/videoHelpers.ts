import { Page } from '@playwright/test';

/** CSS injected into every demo page to hide screenshot-unfriendly elements. */
const DEMO_CLEANUP_CSS = `
  [data-demo-badge] { display: none !important; }
`;

/**
 * Wait until loading spinners are no longer visible and the DOM has settled.
 * Keeps demo videos free of loading states.
 */
export async function waitForReady(page: Page, timeoutMs = 3000): Promise<void> {
  await page
    .locator('.animate-spin')
    .first()
    .waitFor({ state: 'hidden', timeout: timeoutMs })
    .catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: timeoutMs }).catch(() => {});
  await page.waitForTimeout(150);
  await page.addStyleTag({ content: DEMO_CLEANUP_CSS }).catch(() => {});
}

/**
 * Smooth navigation for video recording — waits for spinners to clear, then holds briefly.
 */
export async function smoothGoto(page: Page, path: string, holdMs = 900): Promise<void> {
  await page.goto(path);
  await waitForReady(page);
  await page.waitForTimeout(holdMs);
}

/**
 * Smooth click with a short post-click pause for video clarity.
 */
export async function smoothClick(page: Page, selector: string, holdMs = 600): Promise<void> {
  try {
    const el = page.locator(selector).first();
    await el.waitFor({ timeout: 4000 }).catch(() => {});
    await el.click().catch(() => {});
    await waitForReady(page, 1500);
    await page.waitForTimeout(holdMs).catch(() => {});
  } catch {
    // Element missing or page navigated away — continue the video flow
  }
}

/**
 * Brief scene transition pause.
 */
export async function scenePause(page: Page, ms = 800): Promise<void> {
  await page.waitForTimeout(ms).catch(() => {});
}

/**
 * Smooth scroll for cinematic reveal.
 */
export async function smoothScroll(page: Page, y = 300, holdMs = 700): Promise<void> {
  try {
    await page.evaluate((scrollY) => window.scrollBy({ top: scrollY, behavior: 'smooth' }), y);
    await page.waitForTimeout(holdMs).catch(() => {});
  } catch {
    // Page context gone — continue
  }
}
