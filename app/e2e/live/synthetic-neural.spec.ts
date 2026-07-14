/**
 * @file synthetic-neural.spec.ts
 * @description Live e2e (TASK-182): generate a neural-trajectory synthetic dataset
 *   through the real server pipeline (mock backend) via the Generate Synthetic modal.
 *   Requires dev servers on :3001/:1420; the server must resolve the curation
 *   python (server/curation/.venv-win on Windows, or COSMOS_SYNTH_PYTHON).
 */
import { test, expect, type Page } from '@playwright/test';

/** The live dev system raises real alerts; the fixed banner intercepts header clicks. */
async function clearAlertBanners(page: Page): Promise<void> {
  for (let i = 0; i < 10; i++) {
    const btn = page
      .locator('[role="alert"]')
      .getByRole('button', { name: /acknowledge|dismiss/i })
      .first();
    if (!(await btn.isVisible().catch(() => false))) return;
    await btn.click().catch(() => undefined);
    await page.waitForTimeout(300);
  }
}

test.describe('Generate Synthetic — neural-trajectory mode (live)', () => {
  test('mode selector drives banner, limits and token requirement', async ({ page }) => {
    await page.goto('/datasets');
    await page.waitForSelector('text=Datasets', { timeout: 15_000 });
    await clearAlertBanners(page);

    await page.getByRole('button', { name: /generate synthetic/i }).click();
    const dialog = page.getByRole('dialog', { name: /generate synthetic episodes/i });
    await expect(dialog).toBeVisible();

    // Both mode cards present; forward-dynamics is the default
    const fwd = dialog.getByTestId('generator-mode-forward-dynamics');
    const neural = dialog.getByTestId('generator-mode-neural-trajectory');
    await expect(fwd).toBeVisible();
    await expect(neural).toBeVisible();
    await expect(fwd).toHaveAttribute('aria-checked', 'true');

    // Default mode shows the Cosmos/WidowX provenance (scoped to the dialog —
    // the dataset list behind the modal also mentions widowx_bridge)
    await expect(dialog.getByText('NVIDIA Cosmos 3').first()).toBeVisible();
    await expect(dialog.getByText('widowx_bridge').first()).toBeVisible();

    // Switch to neural-trajectory: banner + embodiment change, no HF-token warning
    await neural.click();
    await expect(neural).toHaveAttribute('aria-checked', 'true');
    await expect(dialog.getByText(/GR00T-Dreams/i).first()).toBeVisible();
    await expect(dialog.getByText('Unitree_G1_Dex3').first()).toBeVisible();
    await expect(dialog.getByText(/no hugging face/i)).toHaveCount(0);
  });

  test('neural-trajectory job runs to completion and registers a G1 dataset', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/datasets');
    await page.waitForSelector('text=Datasets', { timeout: 15_000 });
    await clearAlertBanners(page);

    await page.getByRole('button', { name: /generate synthetic/i }).click();
    const dialog = page.getByRole('dialog', { name: /generate synthetic episodes/i });
    await expect(dialog).toBeVisible();
    await dialog.getByTestId('generator-mode-neural-trajectory').click();

    // 2 episodes for a fast run (mock backend ~0.3 s/episode)
    const slider = dialog.locator('input[type="range"]');
    if (await slider.count()) {
      await slider.first().fill('2');
    }

    await dialog.getByTestId('start-generation').click();

    // Terminal state: the result view announces the registered dataset
    await expect(dialog.getByText(/synthetic episodes ready/i)).toBeVisible({ timeout: 90_000 });
    await expect(dialog.getByText(/neural-g1-synthetic-/).first()).toBeVisible();

    // The registered dataset shows up in the dataset list
    await dialog.getByRole('button', { name: /^done$/i }).click();
    const search = page.getByPlaceholder(/search/i);
    await search.fill('neural-g1-synthetic');
    await expect(page.getByRole('heading', { name: /neural-g1-synthetic-/ }).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  // Keep the dev DB tidy: remove datasets this suite registered.
  test.afterAll(async ({ request }) => {
    const res = await request.get('http://localhost:3001/api/datasets');
    if (!res.ok()) return;
    const { datasets } = (await res.json()) as { datasets: Array<{ id: string; name: string }> };
    for (const ds of datasets.filter((d) => d.name.startsWith('neural-g1-synthetic-'))) {
      await request.delete(`http://localhost:3001/api/datasets/${ds.id}`).catch(() => undefined);
    }
  });
});
