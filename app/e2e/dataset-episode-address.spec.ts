/**
 * @file dataset-episode-address.spec.ts
 * @description The episode viewer and the address (TASK-501): a dataset's bare
 *   address opens its episodes, the selected episode is written to
 *   `?episode=` and survives a reload, and an episode the dataset does not
 *   have falls back to one it has.
 *   Runs against the demo build (MSW handlers in src/mocks/handlers.ts).
 */
import { test, expect, type Page } from '@playwright/test';

const DATASET_URL = '/#/datasets/demo-g1-edu';

// The demo dataset is state-only (no cameras), so the list is what shows the selection.
const selectedRow = (page: Page) => page.locator('[data-testid="episode-list"] li[aria-current="true"]');

test.describe('Episode viewer address', () => {
  test('a dataset address without /episodes opens the episodes page', async ({ page }) => {
    await page.goto(`${DATASET_URL}?tab=views`);
    await expect(page.getByTestId('episode-stage')).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/datasets\/demo-g1-edu\/episodes\?tab=views$/);
  });

  test('the selected episode is in the address and survives a reload', async ({ page }) => {
    await page.goto(`${DATASET_URL}/episodes`);
    const list = page.getByTestId('episode-list');
    await expect(list).toBeVisible({ timeout: 10_000 });

    await list.getByText('Episode 2', { exact: true }).click();
    await expect(page).toHaveURL(/[?&]episode=2$/);
    await expect(selectedRow(page)).toContainText('Episode 2');

    await page.reload();
    await expect(selectedRow(page)).toContainText('Episode 2', { timeout: 10_000 });
  });

  test('an episode the dataset does not have falls back to its first one', async ({ page }) => {
    await page.goto(`${DATASET_URL}/episodes?episode=9999`);
    await expect(selectedRow(page)).toContainText('Episode 0', { timeout: 10_000 });
    await expect(page).toHaveURL(/[?&]episode=0$/);
    await expect(page.getByText('Episode 9999 is not in this dataset')).toBeVisible();
  });
});
