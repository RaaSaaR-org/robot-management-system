/**
 * @file datacollection-takes-sync.spec.ts
 * @description TASK-410, live: two browsers on one recording session stay in
 *   step through the server's live state. A starts a take → B shows ● REC and
 *   "started" within 1.5 s, and the two take timers differ by at most 1 s;
 *   A stops → both show the quick check with its thumbnail; B discards →
 *   A is told who discarded it; the header E-STOP stops the robot.
 *
 *   Needs a LIVE stack against a SIM robot (server + robot-agent + sim
 *   sidecar + app). It creates its own session:
 *     PLAYWRIGHT_LIVE_URL=http://127.0.0.1:1440 TAKES_ROBOT_ID=sim-… \
 *       npx playwright test --config=playwright.live.config.ts datacollection-takes-sync
 *   Never point it at a real robot: it starts a recording and presses E-STOP.
 *   Set SCREEN_DIR to also save screenshots there.
 */
import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';

const ROBOT_ID = process.env.TAKES_ROBOT_ID ?? '';
const shot = (name: string) => (process.env.SCREEN_DIR ? { path: path.join(process.env.SCREEN_DIR, name) } : {});

/** "01:23" → 83 */
const seconds = (mmss: string) => {
  const [m, s] = mmss.trim().split(':').map(Number);
  return m * 60 + s;
};

async function timer(page: Page): Promise<number> {
  return seconds((await page.getByTestId('hud-take-timer').textContent()) ?? '00:00');
}

test('two browsers share one take, one timer and one quick check', async ({ browser, request, baseURL }) => {
  test.skip(!ROBOT_ID || !/sim/i.test(ROBOT_ID), 'set TAKES_ROBOT_ID to a SIM robot');
  test.setTimeout(180_000);

  const created = await request.post(`${baseURL}/api/teleoperation/sessions`, {
    data: { operatorId: 'live-check', robotId: ROBOT_ID, type: 'vr_quest', fps: 30, languageInstr: 'TASK-410 live check: wave' },
  });
  expect(created.ok()).toBeTruthy();
  const sessionId = ((await created.json()) as { session: { id: string } }).session.id;

  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  for (const page of [a, b]) await page.goto(`/data-collection/${sessionId}`);

  // Starting the session records nothing: both are Ready for take 1.
  await a.getByRole('button', { name: /^Start session$/ }).click();
  await a.getByRole('alertdialog').getByRole('button', { name: /^Start session$/ }).click();
  for (const page of [a, b]) {
    await expect(page.getByTestId('hud-phase')).toHaveText('READY', { timeout: 20_000 });
    await expect(page.getByTestId('hud-take')).toHaveText('Take 1');
    await expect(page.getByTestId('session-estop')).toBeVisible();
  }

  // The agent records frames only while commands reach the robot: A drives the
  // SIM arms with the simulated VR input (taking control when the server leases it).
  // TASK-426: the simulated input lives in Testing tools.
  await a.getByTestId('session-tools-toggle').click();
  await a.getByTestId('simulate-vr-toggle').click();
  await a.keyboard.press('Escape');
  const takeControl = a.getByTestId('session-control-lease').getByRole('button', { name: /Take control/ });
  await expect(takeControl).toBeVisible({ timeout: 10_000 });
  await takeControl.click();
  const confirmTake = a.getByRole('alertdialog');
  if (await confirmTake.isVisible({ timeout: 1_500 }).catch(() => false)) {
    await confirmTake.getByRole('button').last().click();
  }
  await expect(a.getByTestId('sim-input-status')).toContainText(/Streaming/i, { timeout: 15_000 });

  // A starts → B follows within 1.5 s, and is told.
  await a.getByTestId('take-primary').click();
  await expect(a.getByTestId('hud-phase')).toHaveText('● REC');
  await expect(b.getByTestId('hud-phase')).toHaveText('● REC', { timeout: 1_500 });
  await expect(b.getByText(/(started take 1|Take 1 started)/)).toBeVisible({ timeout: 1_500 });

  // Same timer on both, from the server's stamp.
  await a.waitForTimeout(2_600);
  const [ta, tb] = await Promise.all([timer(a), timer(b)]);
  expect(ta).toBeGreaterThanOrEqual(2);
  expect(Math.abs(ta - tb)).toBeLessThanOrEqual(1);
  await a.screenshot({ fullPage: true, ...shot('TASK-410-live-a-recording.png') });
  await b.screenshot({ fullPage: true, ...shot('TASK-410-live-b-recording.png') });

  // A stops → both see the quick check of take 1, with a thumbnail.
  await a.getByTestId('take-primary').click();
  for (const page of [a, b]) {
    await expect(page.getByTestId('quick-check')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('quick-check-title')).toHaveText('Take 1');
    await expect(page.getByTestId('hud-phase')).toHaveText('READY');
  }
  // Hold B's card (it hides itself after 8 s) while A's thumbnail loads.
  await b.getByTestId('quick-check').hover();
  await a.getByTestId('quick-check').hover();
  await expect(a.getByTestId('quick-check').getByTestId('take-thumbnail-0')).toHaveAttribute('data-state', 'loaded', { timeout: 10_000 });
  await a.screenshot({ ...shot('TASK-410-live-a-quick-check.png') });

  // B discards it → the row goes on A too, and A is told who did it.
  await b.getByTestId('quick-check-discard').click();
  await expect(a.getByTestId('episode-row-0')).toHaveCount(0, { timeout: 3_000 });
  await expect(a.getByText(/discarded take 1/)).toBeVisible({ timeout: 3_000 });
  await expect(a.getByTestId('hud-take')).toHaveText('Take 2');
  await a.screenshot({ fullPage: true, ...shot('TASK-410-live-a-discarded.png') });

  // The header E-STOP reaches the robot.
  await a.getByTestId('session-estop').click();
  await expect(a.getByText('Emergency stop sent')).toBeVisible({ timeout: 10_000 });

  await a.getByRole('button', { name: /^End session$/ }).click();
  await a.getByRole('alertdialog').getByRole('button', { name: /^End session$/ }).click();
  await expect(a.getByText('Completed', { exact: true }).first()).toBeVisible({ timeout: 60_000 });
});
