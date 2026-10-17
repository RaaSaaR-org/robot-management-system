/**
 * @file datacollection-vr.spec.ts
 * @description Full VR-in-simulation data collection flow: create a vr_quest
 *   session on a SIM robot from the New Session page, start it, take control
 *   and enable the synthetic "Simulate VR input" driver, start a take and
 *   watch the live frame count rise, advance to the next take, discard take 1,
 *   end the session, and verify the auto-exported dataset card links into the
 *   dataset episode viewer. The in-headset take controls are covered by
 *   `vr-session-board.spec.ts` (TASK-413).
 *
 *   Requires a LIVE stack (server + robot-agent + sim sidecar + app) — the
 *   sim frame recorder and the keyboard-teleop WebSocket are real backends
 *   here, not MSW mocks:
 *     PLAYWRIGHT_LIVE_URL=http://localhost:1443 VR_ROBOT_ID=sim-robot-g1-edu \
 *       npx playwright test --config=playwright.live.config.ts datacollection-vr
 *   Never point it at a real robot.
 */
import { test, expect, type Page } from '@playwright/test';

const ROBOT_ID = process.env.VR_ROBOT_ID ?? 'sim-robot-g1-edu';

test.describe('VR data collection in simulation', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(180_000);

  // A failed run must not leave the robot recording: the next session on it
  // would be refused ("busy recording session …").
  let sessionId: string | null = null;
  test.afterEach(async ({ request, baseURL }) => {
    if (sessionId) await request.post(`${baseURL}/api/teleoperation/sessions/${sessionId}/end`).catch(() => {});
  });

  async function readFrameCount(page: Page): Promise<number> {
    const text = (await page.getByTestId('hud-frames').textContent()) ?? '0';
    return parseInt(text.replace(/[^\d]/g, ''), 10) || 0;
  }

  test('record a VR session end-to-end with simulated input', async ({ page }) => {
    // ── 1. Create a vr_quest session on a sim robot ──────────────────────
    await page.goto('/data-collection/new');
    await expect(page.getByRole('heading', { name: /New Session/i })).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole('radio', { name: /Meta Quest VR/i }).click();

    // VR prerequisites panel appears for VR types
    await expect(page.getByTestId('vr-prerequisites')).toBeVisible();

    // The SIM robot, never whichever robot happens to be listed first.
    const robotSelect = page.locator('select');
    await expect
      .poll(async () => (await robotSelect.locator(`option[value="${ROBOT_ID}"]`).count()), { timeout: 15_000 })
      .toBe(1);
    await robotSelect.selectOption(ROBOT_ID);

    await page
      .getByPlaceholder(/Pick up the red block/i)
      .fill('Pick up the cube and place it on the plate (e2e)');

    // The advanced options stay collapsed: the default view is enough.
    await expect(page.getByRole('button', { name: /^Advanced options/ })).toHaveAttribute('aria-expanded', 'false');
    await page.getByRole('button', { name: /^Start session$/ }).click();

    // Lands on the session detail page — step 1 (Connect input) is active
    await expect(page).toHaveURL(/data-collection\/[0-9a-f-]+/, { timeout: 15_000 });
    sessionId = /data-collection\/([0-9a-f-]+)/.exec(page.url())?.[1] ?? null;
    await expect(page.getByTestId('session-steps')).toBeVisible();
    await expect(page.getByTestId('vr-session-panel')).toBeVisible();
    // Pre-flight checklist: the sim robot is online, nothing blocks Start.
    await expect(page.getByTestId('preflight-robot')).toHaveAttribute('data-level', 'ok', { timeout: 15_000 });

    // ── 2. Start the session, then the first take (TASK-410) ──────────────
    await page.getByRole('button', { name: /^Start session$/ }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: /^Start session$/ }).click();
    await expect(page.getByText('Recording', { exact: true }).first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId('hud-phase')).toHaveText('READY', { timeout: 15_000 });
    await page.getByTestId('take-primary').click();
    await expect(page.getByTestId('hud-phase')).toHaveText('● REC', { timeout: 10_000 });

    // ── 3. Take control, enable "Simulate VR input" and watch frames rise ──
    // The agent records frames only while commands reach the robot, and the
    // simulated input streams only while this page holds the control lease.
    await page.getByTestId('simulate-vr-toggle').click();
    const takeControl = page.getByTestId('session-control-lease').getByRole('button', { name: /Take control/ });
    if (await takeControl.isVisible({ timeout: 10_000 }).catch(() => false)) {
      await takeControl.click();
      const confirmTake = page.getByRole('alertdialog');
      if (await confirmTake.isVisible({ timeout: 1_500 }).catch(() => false)) {
        await confirmTake.getByRole('button').last().click();
      }
    }
    await expect(page.getByTestId('sim-input-status')).toContainText(/Streaming/i, { timeout: 15_000 });

    const before = await readFrameCount(page);
    await expect
      .poll(async () => readFrameCount(page), { timeout: 30_000, intervals: [1000] })
      .toBeGreaterThan(before + 5);

    // ── 4. Next take ─────────────────────────────────────────────────────
    await expect(page.getByTestId('hud-episode')).toContainText('1');
    await page.getByTestId('take-next').click();
    await expect(page.getByTestId('hud-episode')).toContainText('2', { timeout: 10_000 });

    // Let episode 1 collect some frames so the session survives the discard of ep 0
    await page.waitForTimeout(3_000);

    // ── 5. Discard episode 0 (kit confirm dialog, not window.confirm) ────
    await expect(page.getByTestId('episode-row-0')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('episode-discard-0').click();
    const discardDialog = page.getByRole('alertdialog', { name: /Discard take 1/i });
    await expect(discardDialog).toBeVisible();
    await discardDialog.getByRole('button', { name: /^Discard$/ }).click();
    await expect(page.getByTestId('episode-row-0')).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByTestId('episode-row-1')).toBeVisible({ timeout: 15_000 });

    // ── 6. End the session → auto-export → dataset card ──────────────────
    await page.getByRole('button', { name: /^End session$/ }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: /^End session$/ }).click();
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
