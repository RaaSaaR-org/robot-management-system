/**
 * @file synthetic-import.spec.ts
 * @description Live e2e (TASK-182 AC 3): the externally generated DreamGen-style
 *   synthetic dataset (g1_dex3_pickbottle_synthetic, LeRobot v3.0, 50 episodes,
 *   registered via server/src/scripts/register-neural-synthetic.ts) is listed on
 *   the Datasets page and its episodes/video are served from local disk.
 *   Requires dev servers on :3001/:1420 and the registered dataset row.
 */
import { test, expect, type Page } from '@playwright/test';

const NAME = 'g1_dex3_pickbottle_synthetic';

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

test.describe('Imported neural-trajectory dataset (live)', () => {
  test('appears on the datasets page as ready v3.0 with 50 episodes', async ({ page }) => {
    await page.goto('/datasets');
    await page.waitForSelector('text=Datasets', { timeout: 15_000 });
    await clearAlertBanners(page);

    const search = page.getByPlaceholder(/search/i);
    await search.fill('pickbottle_synthetic');

    const card = page.locator(`text=${NAME}`).first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('text=LeRobot v3.0').first()).toBeVisible();
    await expect(page.locator('text=Ready').first()).toBeVisible();
  });

  test('episodes and video are served from the local dataset dir', async ({ request }) => {
    // API-level verification of the local-disk reader path the viewer uses.
    const res = await request.get('http://localhost:3001/api/datasets');
    expect(res.ok()).toBeTruthy();
    const { datasets } = (await res.json()) as {
      datasets: Array<{ id: string; name: string; demonstrationCount: number }>;
    };
    const ds = datasets.find((d) => d.name.startsWith(NAME));
    expect(ds, `dataset ${NAME} registered`).toBeTruthy();
    expect(ds!.demonstrationCount).toBe(50);

    const eps = await request.get(`http://localhost:3001/api/datasets/${ds!.id}/episodes`);
    expect(eps.ok()).toBeTruthy();
    const { episodes } = (await eps.json()) as { episodes: Array<{ frameCount: number }> };
    expect(episodes.length).toBe(50);
    expect(episodes[0].frameCount).toBe(93);

    const video = await request.get(
      `http://localhost:3001/api/datasets/${ds!.id}/episodes/0/video/cam_right_high`,
    );
    expect(video.ok()).toBeTruthy();
    expect((await video.body()).byteLength).toBeGreaterThan(10_000);

    const frames = await request.get(
      `http://localhost:3001/api/datasets/${ds!.id}/episodes/0/frames?offset=0&limit=3`,
    );
    expect(frames.ok()).toBeTruthy();
    const parsed = (await frames.json()) as {
      frames: Array<{ action: number[]; observationState: number[] }>;
    };
    expect(parsed.frames.length).toBe(3);
    expect(parsed.frames[0].action.length).toBe(28);
  });
});
