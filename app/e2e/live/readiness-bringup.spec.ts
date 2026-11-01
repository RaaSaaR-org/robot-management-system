/**
 * @file readiness-bringup.spec.ts
 * @description TASK-419 against a LIVE sim stack with a robot supervisor: the
 *   readiness panel takes control by itself (Take control → Switch to arm
 *   control, and Take control → Limp first, then stop, from a fresh page), the
 *   New session page starts an offline robot's robot side in place, and a stale
 *   foreign agent reads `agent_outdated` with its start time and no Adopt.
 *
 *   Requires: a branch server whose ROBOT_SUPERVISORS names a SIM profile's
 *   supervisor, and the app pointed at it. Run one test at a time with -g, in
 *   the state its comment names:
 *     PLAYWRIGHT_LIVE_URL=http://127.0.0.1:1463 READINESS_ROBOT_ID=sim-g1-edu-419 \
 *       npx playwright test --config=playwright.live.config.ts readiness-bringup -g '<name>'
 *   Screenshots go to READINESS_SHOTS (a directory) when set.
 *   Never point it at a real robot.
 * @feature robots
 */
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

const ROBOT_ID = process.env.READINESS_ROBOT_ID ?? 'sim-g1-edu-dev';
const SHOTS = process.env.READINESS_SHOTS;

async function shot(page: Page, name: string): Promise<void> {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/TASK-419-${name}.png`, fullPage: true });
}

async function readiness(request: APIRequestContext): Promise<{
  reason: { code: string };
  bringup: { overall: string; sidecarMode: string | null } | null;
  agent: { readiness: { base: { mode: string } | null } | null };
}> {
  const res = await request.get(`/api/robots/${ROBOT_ID}/readiness`);
  return res.json();
}

test.describe('readiness panel bringup (live sim)', () => {
  test.setTimeout(240_000);

  // State: robot side ready, read_only, nothing connected on the page.
  test('take control then switch to arm control from the Teleop tab', async ({ page, request }) => {
    expect((await readiness(request)).bringup?.sidecarMode).toBe('read_only');
    await page.goto(`/robots/${ROBOT_ID}?tab=teleop`);
    const panel = page.getByTestId('robot-readiness');
    await expect(panel.getByTestId('readiness-arm-control')).toBeDisabled({ timeout: 30_000 });
    // The keyboard card is not connected, and nobody touches it.
    await expect(page.getByRole('button', { name: 'Connect', exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toHaveCount(0);
    await shot(page, 'teleop-take-control');
    await panel.getByTestId('readiness-take-control').click();
    // Take control chains into the arm-control confirmation.
    const dialog = page.getByTestId('readiness-arm-confirm');
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    await shot(page, 'teleop-arm-confirm');
    await page.getByTestId('readiness-arm-confirm-confirm').click();
    await expect.poll(async () => (await readiness(request)).bringup?.sidecarMode, { timeout: 120_000, intervals: [1000] }).toBe('arm_sdk');
    await expect.poll(async () => (await readiness(request)).bringup?.overall, { timeout: 60_000, intervals: [1000] }).toBe('ready');
    await expect(panel).toContainText('sidecar arm-sdk', { timeout: 30_000 });
    await shot(page, 'teleop-arm-sdk');
  });

  // State: robot side ready in arm_sdk, the robot measured in stand or balance.
  test('limp first then stop from a fresh page', async ({ page, request }) => {
    const before = await readiness(request);
    expect(before.bringup?.sidecarMode).toBe('arm_sdk');
    await page.goto(`/robots/${ROBOT_ID}?tab=teleop`);
    const panel = page.getByTestId('robot-readiness');
    await panel.getByTestId('readiness-stop').click();
    const dialog = page.getByTestId('readiness-stop-confirm');
    await expect(dialog.getByTestId('readiness-limp-offer')).toBeVisible({ timeout: 30_000 });
    await expect(dialog.getByTestId('readiness-limp-first')).toBeDisabled();
    await shot(page, 'stop-dialog-take-control');
    await dialog.getByTestId('readiness-limp-take-control').click();
    await expect(dialog.getByTestId('readiness-limp-first')).toBeEnabled({ timeout: 30_000 });
    await dialog.getByTestId('readiness-limp-first').click();
    await expect.poll(async () => (await readiness(request)).bringup?.overall, { timeout: 120_000, intervals: [1000] }).toBe('stopped');
    await shot(page, 'stop-limped-and-stopped');
  });

  // State: robot side stopped, the robot registered (offline once the server noticed).
  test('new session starts the robot side of an offline robot in place', async ({ page, request }) => {
    expect((await readiness(request)).bringup?.overall).toBe('stopped');
    await page.goto('/data-collection/new');
    const select = page.getByRole('combobox').first();
    await expect(select.locator(`option[value="${ROBOT_ID}"]`)).toHaveCount(1, { timeout: 30_000 });
    await select.selectOption(ROBOT_ID);
    const panel = page.getByTestId('robot-readiness-compact');
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('This robot is offline. Start the robot side below.')).toBeVisible();
    await shot(page, 'new-session-offline');
    await panel.getByTestId('readiness-start').click();
    await expect.poll(async () => (await readiness(request)).bringup?.overall, { timeout: 240_000, intervals: [2000] }).toBe('ready');
    // The robot comes online in the picker without leaving the page.
    await expect(select.locator(`option[value="${ROBOT_ID}"]`)).not.toContainText('Offline', { timeout: 60_000 });
    await expect(page.getByTestId('robot-readiness-compact')).toHaveCount(0, { timeout: 30_000 });
    expect(new URL(page.url()).pathname).toBe('/data-collection/new');
    await shot(page, 'new-session-online');
  });

  // State: a stale agent from an older checkout holds the agent port and Start was pressed.
  test('a stale foreign agent reads agent_outdated, with its start time and no Adopt', async ({ page, request }) => {
    await expect.poll(async () => (await readiness(request)).reason.code, { timeout: 60_000, intervals: [1000] }).toBe('agent_outdated');
    await page.goto(`/robots/${ROBOT_ID}?tab=teleop`);
    const panel = page.getByTestId('robot-readiness');
    await expect(panel.getByTestId('readiness-reason')).toHaveAttribute('data-code', 'agent_outdated', { timeout: 30_000 });
    const box = panel.getByTestId('readiness-foreign-agent');
    await expect(box).toContainText('started 20');
    await expect(box.getByTestId('readiness-stale-agent')).toContainText('Runs code from before');
    await expect(box.getByTestId('readiness-stale-agent')).toContainText('kill -TERM');
    await expect(box.getByRole('button', { name: 'Adopt' })).toHaveCount(0);
    await expect(box.getByRole('button', { name: 'Leave' })).toBeVisible();
    await box.scrollIntoViewIfNeeded();
    await shot(page, 'stale-foreign-agent');
  });
});
