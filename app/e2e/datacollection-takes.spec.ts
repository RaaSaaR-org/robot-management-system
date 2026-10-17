/**
 * @file datacollection-takes.spec.ts
 * @description The session page records in explicit takes (TASK-410), on the
 *   demo build with MSW answering the TASK-408 routes: Start take → ● REC
 *   Take 1 counting; Stop → the quick check with its thumbnail and moved body
 *   parts; Discard → the row goes and a toast says who discarded it; Space
 *   and Backspace with Undo; the E-STOP in the header stops the robot.
 *   Set SCREEN_DIR to also save screenshots there.
 * @feature datacollection
 */
import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

const shot = (name: string) => (process.env.SCREEN_DIR ? { path: path.join(process.env.SCREEN_DIR, name) } : {});
const SESSION = './#/data-collection/demo-session-takes';

async function open(page: Page) {
  await page.goto(SESSION);
  await expect(page.getByTestId('hud-phase')).toHaveText('READY');
}

test('start, stop, glance, discard — and the E-STOP is always there', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await open(page);
  await expect(page.getByTestId('hud-take')).toHaveText('Take 1');
  await expect(page.getByTestId('session-estop')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pause' })).toHaveCount(0);
  await page.screenshot({ fullPage: true, ...shot('TASK-410-ready.png') });

  // Start take → ● REC Take 1, counting from 00:00.
  await page.getByTestId('take-primary').click();
  await expect(page.getByTestId('hud-phase')).toHaveText('● REC');
  await expect(page.getByTestId('hud-take')).toHaveText('Take 1');
  await expect(page.getByTestId('hud-take-timer')).toHaveText(/^00:0[0-1]$/);
  await expect(page.getByTestId('take-primary')).toHaveText('Stop take');
  await expect(page.getByTestId('hud-take-timer')).toHaveText('00:02', { timeout: 5_000 });
  await page.screenshot({ fullPage: true, ...shot('TASK-410-recording.png') });

  // Stop → the quick check: thumbnail, length, moved parts.
  await page.getByTestId('take-primary').click();
  const card = page.getByTestId('quick-check');
  await expect(card).toBeVisible();
  await expect(card.getByTestId('quick-check-title')).toHaveText('Take 1');
  await expect(card.getByTestId('quick-check-groups')).toContainText('L arm');
  await expect(card.getByTestId('take-thumbnail-0')).toHaveAttribute('data-state', 'loaded');
  await expect(page.getByTestId('hud-phase')).toHaveText('READY');
  await expect(page.getByTestId('hud-take')).toHaveText('Take 2');
  await expect(page.getByTestId('episode-row-0')).toContainText('Take 1');
  await page.screenshot({ fullPage: true, ...shot('TASK-410-quick-check.png') });

  // Discard from the card → the row goes, the toast names who did it.
  await card.getByTestId('quick-check-discard').click();
  await expect(page.getByTestId('episode-row-0')).toHaveCount(0);
  await expect(page.getByText('You discarded take 1')).toBeVisible();
  await expect(card).toHaveCount(0);
  await page.screenshot({ fullPage: true, ...shot('TASK-410-discarded.png') });

  // The number is not reused: the next take is Take 2.
  await expect(page.getByTestId('hud-take')).toHaveText('Take 2');

  // E-STOP: one press, no dialog.
  await page.getByTestId('session-estop').click();
  await expect(page.getByText('Emergency stop sent')).toBeVisible();
  expect(errors).toEqual([]);
});

test('Space starts and stops; Backspace discards with Undo; typing is ignored', async ({ page }) => {
  await open(page);
  await page.keyboard.press('Space');
  await expect(page.getByTestId('hud-phase')).toHaveText('● REC');
  await page.waitForTimeout(1200);
  await page.keyboard.press('Space');
  await expect(page.getByTestId('hud-phase')).toHaveText('READY');
  await expect(page.getByTestId('episode-row-0')).toBeVisible();
  await page.getByTestId('quick-check-keep').click();
  await expect(page.getByTestId('quick-check')).toHaveCount(0);

  // Backspace → a toast with Undo; Undo sends nothing.
  await page.keyboard.press('Backspace');
  await expect(page.getByText('Discarding take 1…')).toBeVisible();
  await page.screenshot({ fullPage: false, ...shot('TASK-410-discard-undo.png') });
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.waitForTimeout(5_500);
  await expect(page.getByTestId('episode-row-0')).toBeVisible();

  // Typing in a field is text, not a take.
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.id = 'typing-probe';
    document.body.appendChild(input);
  });
  await page.locator('#typing-probe').focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('Backspace');
  await expect(page.getByTestId('hud-phase')).toHaveText('READY');
  await expect(page.getByText(/Discarding take/)).toHaveCount(0);
});

test('the session page fits a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await page.getByTestId('take-primary').click();
  await expect(page.getByTestId('hud-phase')).toHaveText('● REC');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await expect(page.getByTestId('session-estop')).toBeVisible();
  await page.screenshot({ fullPage: false, ...shot('TASK-410-phone.png') });
});
