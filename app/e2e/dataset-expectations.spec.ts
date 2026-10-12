/**
 * @file dataset-expectations.spec.ts
 * @description The robot-type panel on the episode browser (TASK-363): one line
 *   by default so the episode list stays on the first screen, a picker with real
 *   choices, the panel collapsing again, and a trajectory chart with a real size.
 *   Runs against the demo build (MSW handlers in src/mocks/handlers.ts).
 */
import { test, expect } from '@playwright/test';

const EPISODES_URL = '/#/datasets/demo-g1-edu/episodes';

test.describe('Dataset robot-type panel', () => {
  test('is one line above an episode list that stays in view', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(EPISODES_URL);
    const panel = page.getByTestId('dataset-expectations');
    await expect(panel).toHaveAttribute('data-collapsed', 'true', { timeout: 10_000 });
    await expect(page.getByTestId('expectations-summary')).toContainText('Unitree G1 + Dex3');
    await expect(page.getByTestId('width-table')).toHaveCount(0);
    await expect(page.getByTestId('episode-check-0')).toBeInViewport();
  });

  test('expands to a picker with real choices and collapses again', async ({ page }) => {
    await page.goto(EPISODES_URL);
    await page.getByTestId('expectations-expand').click({ timeout: 10_000 });
    const select = page.getByLabel('Robot type');
    // The dataset's own type is not offered; the other demo types are.
    await expect(select.locator('option')).not.toHaveCount(1);
    await expect(select.locator('option', { hasText: 'SO-101 arm' })).toHaveCount(1);
    await expect(page.getByTestId('selected-robot-type-status')).toBeVisible();
    await page.getByTestId('expectations-collapse').click();
    await expect(page.getByTestId('width-table')).toHaveCount(0);
    await expect(page.getByTestId('expectations-summary')).toBeVisible();
  });

  test('draws the trajectory chart at a real size', async ({ page }) => {
    // The Recharts -1 × -1 warning itself only logs in a dev build; the unit
    // test in TrajectoryPanels.test.tsx pins it. Here: the chart gets a size.
    await page.goto(EPISODES_URL);
    const chart = page.locator('.recharts-responsive-container').first();
    await expect(chart).toBeVisible({ timeout: 10_000 });
    const box = await chart.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(100);
    expect(box?.height ?? 0).toBeGreaterThan(100);
  });
});
