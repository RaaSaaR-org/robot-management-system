/**
 * @file training-flow.spec.ts
 * @description Functional test: training page renders history + new job wizard submits successfully
 */
import { test, expect } from '@playwright/test';

// baseURL comes from playwright.config.ts (demo mode uses HashRouter)

test.describe('Training page', () => {
  test('history tab shows completed jobs with loss values', async ({ page }) => {
    await page.goto(`/#/training`);
    await page.waitForSelector('text=Training', { timeout: 10_000 });

    // Switch to History tab
    const historyTab = page.getByRole('tab', { name: /History/i });
    await historyTab.click();

    // Should show at least one completed job card
    const completedBadge = page.locator('text=Completed').first();
    await expect(completedBadge).toBeVisible({ timeout: 5_000 });

    // Loss values should be displayed
    const lossLabel = page.locator('text=Final Loss').first();
    await expect(lossLabel).toBeVisible();
  });

  test('new job wizard: dataset → model → hyperparams → submit', async ({ page }) => {
    await page.goto(`/#/training`);
    await page.waitForSelector('text=Training', { timeout: 10_000 });

    // Open wizard
    await page.getByRole('button', { name: /New Training Job/i }).click();
    await expect(page.getByRole('heading', { name: 'New Training Job' })).toBeVisible();

    // Step 1: Select first ready dataset
    const datasetCard = page.locator('button').filter({ hasText: /Ready/ }).first();
    await datasetCard.click();
    await page.getByRole('button', { name: 'Continue' }).click();

    // Step 2: Select SmolVLA + LoRA
    await page.locator('button').filter({ hasText: 'SmolVLA' }).click();
    // LoRA should already be visible as fine-tune option
    await expect(page.locator('text=LoRA')).toBeVisible();
    await page.getByRole('button', { name: 'Continue' }).click();

    // Step 3: Hyperparams — use Quick Train preset
    await page.locator('button').filter({ hasText: 'Quick Train' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();

    // Step 4: Resources — just continue
    await page.getByRole('button', { name: 'Continue' }).click();

    // Step 5: Review — verify summary shows SMOLVLA
    await expect(page.locator('text=SMOLVLA')).toBeVisible();
    await expect(page.locator('text=LoRA')).toBeVisible();

    // Submit
    await page.getByRole('button', { name: /Submit Training Job/i }).click();

    // Should return to training page with the new job visible
    await expect(page.locator('text=Pending')).toBeVisible({ timeout: 5_000 });
  });
});
