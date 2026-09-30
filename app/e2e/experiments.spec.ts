/**
 * @file experiments.spec.ts
 * @description The experiment loop in the demo build (TASK-242, MSW handlers
 *   in src/mocks/experimentsDemoHandlers.ts): a proposed experiment is reviewed
 *   with its arm diff and budget and approved into `running`; a completed one
 *   shows its verdict and an episode count on every bar.
 */
import { test, expect } from '@playwright/test';

test('a proposed experiment is reviewed with its arm diff and approved', async ({ page }) => {
  await page.goto('/#/experiments');
  const list = page.getByTestId('experiment-list');
  await expect(list).toBeVisible({ timeout: 10_000 });
  const row = list.getByRole('listitem').filter({ hasText: 'Drop the lowest-reward episodes' });
  await row.getByRole('button', { name: 'Review' }).click();

  const dialog = page.getByTestId('approve-dialog');
  await expect(dialog).toContainText('12 of 12 (4 per arm)');
  await expect(dialog.getByTestId('arm-diff')).toHaveCount(3);
  await expect(dialog).toContainText('data (demo-g1-edu → demo-view-10)');
  await page.getByTestId('approve-experiment').click();

  await expect(row).toContainText(/running/i);
});

test('a completed experiment shows its verdict and the count behind every bar', async ({ page }) => {
  await page.goto('/#/experiments/demo-exp-completed');
  await expect(page.getByTestId('verdict')).toContainText('No winner', { timeout: 10_000 });
  await expect(page.getByTestId('arm-episode-count')).toHaveText(['31/50 (62%) · n=50', '36/50 (72%) · n=50']);
  await expect(page.getByTestId('arm-table')).toContainText('+10 pts · within noise');
});
