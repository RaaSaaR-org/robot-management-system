/**
 * @file datacollection-vr.spec.ts
 * @description Full VR-in-simulation data collection flow (TASK: VR teleop
 *   sessions record in simulation): create a vr_quest session on a sim robot,
 *   start recording, enable the synthetic "Simulate VR input" driver, watch
 *   the live frame count rise, advance an episode, discard episode 0, end the
 *   session, and verify the auto-exported dataset card links into the
 *   dataset episode viewer.
 *
 *   Requires a LIVE stack (server :3001 + robot-agent + app) — the sim frame
 *   recorder and the keyboard-teleop WebSocket are real backends here, not
 *   MSW mocks. Run with the app's baseURL pointing at the live frontend.
 */
import { test, expect, type Page } from '@playwright/test';

test.describe('VR data collection in simulation', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(180_000);

  async function readFrameCount(page: Page): Promise<number> {
    const text = (await page.getByTestId('hud-frames').textContent()) ?? '0';
    return parseInt(text.replace(/[^\d]/g, ''), 10) || 0;
  }

  test('record a VR session end-to-end with simulated input', async ({ page }) => {
    // ── 1. Create a vr_quest session on a sim robot ──────────────────────
    await page.goto('/#/data-collection/new');
    await expect(page.getByRole('heading', { name: /New Session/i })).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole('button', { name: /Meta Quest VR/i }).click();

    // VR prerequisites panel appears for VR types
    await expect(page.getByTestId('vr-prerequisites')).toBeVisible();

    // Pick the first available robot from the dropdown
    const robotSelect = page.locator('select');
    await expect
      .poll(async () => (await robotSelect.locator('option').count()), { timeout: 15_000 })
      .toBeGreaterThan(1);
    const firstRobot = await robotSelect.locator('option').nth(1).getAttribute('value');
    await robotSelect.selectOption(firstRobot!);

    await page
      .getByPlaceholder(/Pick up the red block/i)
      .fill('Pick up the cube and place it on the plate (e2e)');

    await page.getByRole('button', { name: /Create Session/i }).click();

    // Lands on the session detail page — step 1 (Connect input) is active
    await expect(page).toHaveURL(/data-collection\/[0-9a-f-]+/, { timeout: 15_000 });
    await expect(page.getByTestId('session-steps')).toBeVisible();
    await expect(page.getByTestId('vr-session-panel')).toBeVisible();

    // ── 2. Start recording ────────────────────────────────────────────────
    await page.getByRole('button', { name: /^Start$/ }).click();
    await expect(page.getByText('Recording', { exact: true }).first()).toBeVisible({
      timeout: 15_000,
    });

    // ── 3. Enable "Simulate VR input" and watch frames rise ──────────────
    await page.getByTestId('simulate-vr-toggle').click();
    await expect(page.getByTestId('sim-input-status')).toContainText(/Streaming|Connecting/i, {
      timeout: 10_000,
    });

    const before = await readFrameCount(page);
    await expect
      .poll(async () => readFrameCount(page), { timeout: 30_000, intervals: [1000] })
      .toBeGreaterThan(before + 5);

    // ── 4. Next episode ──────────────────────────────────────────────────
    await expect(page.getByTestId('hud-episode')).toContainText('1');
    await page.getByTestId('episode-next').click();
    await expect(page.getByTestId('hud-episode')).toContainText('2', { timeout: 10_000 });

    // Let episode 1 collect some frames so the session survives the discard of ep 0
    await page.waitForTimeout(3_000);

    // ── 5. Discard episode 0 (custom confirm dialog, not window.confirm) ──
    await expect(page.getByTestId('episode-row-0')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('episode-discard-0').click();
    await expect(page.getByTestId('discard-dialog')).toBeVisible();
    await page.getByTestId('discard-confirm').click();
    await expect(page.getByTestId('episode-row-0')).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByTestId('episode-row-1')).toBeVisible({ timeout: 15_000 });

    // ── 6. End the session → auto-export → dataset card ──────────────────
    await page.getByRole('button', { name: /^End$/ }).click();
    await expect(page.getByText('Completed', { exact: true }).first()).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId('dataset-card')).toBeVisible({ timeout: 30_000 });

    // Review step shows the surviving episode
    await expect(page.getByTestId('review-episodes')).toBeVisible();

    // ── 7. Open the exported dataset in the episode viewer ───────────────
    await page.getByTestId('open-dataset').click();
    await expect(page).toHaveURL(/datasets\/.+\/episodes/, { timeout: 15_000 });

    // The viewer renders (episode list); video-less datasets show the
    // "no camera streams" empty state instead of broken <video> elements.
    await expect(
      page.getByTestId('no-cameras').or(page.getByTestId('curate-panel')).first()
    ).toBeVisible({ timeout: 30_000 });
  });
});
