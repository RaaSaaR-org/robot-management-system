/**
 * @file curation.spec.ts
 * @description Functional tests for the episode curation panel (TASK-168):
 *   trim / delete flows (new-dataset outcome), and the AI-suggest flow
 *   (suggestions render, Apply prefills the trim inputs, delete needs confirm).
 *   Runs against the demo build (MSW handlers in src/mocks/handlers.ts).
 */
import { test, expect } from '@playwright/test';

const EPISODES_URL = '/#/datasets/demo-g1-edu/episodes';

test.describe('Curation panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(EPISODES_URL);
    await expect(page.getByTestId('curate-panel')).toBeVisible({ timeout: 10_000 });
  });

  test('renders trim inputs and action buttons', async ({ page }) => {
    const panel = page.getByTestId('curate-panel');
    await expect(panel.locator('input[type="number"]')).toHaveCount(2);
    await expect(page.getByTestId('curate-trim')).toBeVisible();
    await expect(page.getByTestId('curate-delete')).toBeVisible();
    await expect(page.getByTestId('curate-suggest')).toBeVisible();
  });

  test('trim flow reports the new dataset revision and links to it', async ({ page }) => {
    const panel = page.getByTestId('curate-panel');
    const inputs = panel.locator('input[type="number"]');
    await inputs.nth(0).fill('2');
    await inputs.nth(1).fill('15');

    await page.getByTestId('curate-trim').click();

    const message = page.getByTestId('curation-message');
    await expect(message).toBeVisible({ timeout: 5_000 });
    await expect(message).toContainText('Trimmed');
    await expect(message).toContainText('new dataset');
    await expect(message).toContainText('(curated)');

    // outcome link navigates to the curated dataset's episodes page
    const openNew = page.getByTestId('curate-open-new');
    await expect(openNew).toBeVisible();
    await openNew.click();
    await expect(page).toHaveURL(/datasets\/demo-g1-edu-curated\/episodes/);
    await expect(page.getByTestId('curate-panel')).toBeVisible({ timeout: 10_000 });
  });

  test('delete flow asks for confirmation and reports the new revision', async ({ page }) => {
    let dialogMessage = '';
    page.once('dialog', (dialog) => {
      dialogMessage = dialog.message();
      void dialog.accept();
    });

    await page.getByTestId('curate-delete').click();

    const message = page.getByTestId('curation-message');
    await expect(message).toBeVisible({ timeout: 5_000 });
    await expect(message).toContainText('Deleted');
    await expect(message).toContainText('new dataset');
    expect(dialogMessage).toContain('Delete episode 0');
    await expect(page.getByTestId('curate-open-new')).toBeVisible();
  });

  test('delete flow does nothing when the confirmation is dismissed', async ({ page }) => {
    page.once('dialog', (dialog) => void dialog.dismiss());

    await page.getByTestId('curate-delete').click();

    await expect(page.getByTestId('curation-message')).toHaveCount(0);
    await expect(page.getByTestId('curate-open-new')).toHaveCount(0);
  });

  test('AI suggest lists suggestions and Apply prefills the trim inputs', async ({ page }) => {
    await page.getByTestId('curate-suggest').click();

    const list = page.getByTestId('curate-suggestions');
    await expect(list).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('curate-suggestion-0')).toContainText('trim');
    await expect(page.getByTestId('curate-suggestion-0')).toContainText('Ep 1 [3, 18)');
    await expect(page.getByTestId('curate-suggestion-1')).toContainText('delete');
    await expect(page.getByTestId('curate-suggestion-2')).toContainText('trim');

    // Apply the first (trim) suggestion: prefills start/end, selects the episode
    await page.getByTestId('suggest-apply-0').click();
    const inputs = page.getByTestId('curate-panel').locator('input[type="number"]');
    await expect(inputs.nth(0)).toHaveValue('3');
    await expect(inputs.nth(1)).toHaveValue('18');
    await expect(page.getByTestId('suggest-message')).toContainText('prefilled for episode 1');

    // the human still triggers the edit explicitly
    await page.getByTestId('curate-trim').click();
    await expect(page.getByTestId('curation-message')).toContainText('Trimmed', { timeout: 5_000 });
  });

  test('applying a delete suggestion runs the confirmed delete flow', async ({ page }) => {
    await page.getByTestId('curate-suggest').click();
    await expect(page.getByTestId('curate-suggestions')).toBeVisible({ timeout: 5_000 });

    let dialogMessage = '';
    page.once('dialog', (dialog) => {
      dialogMessage = dialog.message();
      void dialog.accept();
    });

    // suggestion index 1 is the delete for episode 3
    await page.getByTestId('suggest-apply-1').click();

    const message = page.getByTestId('curation-message');
    await expect(message).toContainText('Deleted', { timeout: 5_000 });
    expect(dialogMessage).toContain('Delete episode 3');
    // applied suggestion is removed from the list (2 remain)
    await expect(page.getByTestId('curate-suggestion-2')).toHaveCount(0);
    await expect(page.getByTestId('curate-suggestion-1')).toContainText('trim');
  });

  test('dismiss removes a suggestion without any API call', async ({ page }) => {
    await page.getByTestId('curate-suggest').click();
    await expect(page.getByTestId('curate-suggestions')).toBeVisible({ timeout: 5_000 });

    await page.getByTestId('suggest-dismiss-1').click();

    await expect(page.getByTestId('curate-suggestion-2')).toHaveCount(0);
    await expect(page.getByTestId('curate-suggestion-0')).toContainText('Ep 1');
    await expect(page.getByTestId('curate-suggestion-1')).toContainText('Ep 2');
    await expect(page.getByTestId('curation-message')).toHaveCount(0);
  });
});
