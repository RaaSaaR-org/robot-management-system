/**
 * @file datacollection-new-session.spec.ts
 * @description The New session form starts a session without asking how many
 *   episodes to record (TASK-406): no Episodes field, and the per-take
 *   auto-stop is an optional, empty field under Advanced options.
 *   Set SCREEN_DIR to also save screenshots of the form there.
 * @feature datacollection
 */
import { expect, test } from '@playwright/test';
import path from 'node:path';

const shot = (name: string) => (process.env.SCREEN_DIR ? { path: path.join(process.env.SCREEN_DIR, name) } : {});

test('the New session form has no episode count and an optional auto-stop', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('./#/data-collection/new');
  await expect(page.getByRole('heading', { name: 'New session' })).toBeVisible();

  await expect(page.getByLabel(/^Episodes/)).toHaveCount(0);
  await expect(page.getByText('How many takes to record')).toHaveCount(0);
  await expect(page.getByRole('spinbutton')).toHaveCount(0);
  await page.screenshot({ fullPage: true, ...shot('TASK-406-new-session.png') });

  await page.getByRole('button', { name: /Advanced options/ }).click();
  const autoStop = page.getByLabel(/Stop each take automatically after/);
  await expect(autoStop).toBeVisible();
  await expect(autoStop).toHaveValue('');
  await expect(page.getByText('Leave empty to stop takes yourself.')).toBeVisible();
  // Not fullPage: the sticky action bar would be painted over the middle of the form.
  await page.getByText('Recorded as').scrollIntoViewIfNeeded();
  await page.screenshot(shot('TASK-406-new-session-advanced.png'));

  await autoStop.fill('2');
  await page.getByPlaceholder(/Pick up the red block/).fill('Wave');
  await page.getByRole('button', { name: 'Start session' }).click();
  await expect(page.getByText('Auto-stop must be a whole number from 5 to 600.')).toBeVisible();
  await page.getByText('Recorded as').scrollIntoViewIfNeeded();
  await page.screenshot(shot('TASK-406-new-session-autostop-invalid.png'));
  expect(errors).toEqual([]);
});
