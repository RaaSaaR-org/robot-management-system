/**
 * @file robot-readiness.spec.ts
 * @description The robot readiness panel in the demo build (TASK-411): it
 *              renders on the robot's Teleop tab with the "stopped" line, Start
 *              walks the checklist through pending rows to ready, and Stop
 *              returns it to stopped. MSW answers from `readinessDemoHandlers`.
 *              Set READINESS_SCREENS_DIR to keep the screenshots.
 * @feature robots
 */
import { expect, test } from '@playwright/test';
import path from 'node:path';

const shot = (testInfo: { outputPath: (n: string) => string }, name: string): string =>
  process.env.READINESS_SCREENS_DIR
    ? path.join(process.env.READINESS_SCREENS_DIR, `TASK-411-${name}.png`)
    : testInfo.outputPath(`${name}.png`);

test('the readiness panel starts the robot side and walks the rows to ready', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./#/robots/demo-g1-001?tab=teleop');

  const panel = page.getByTestId('robot-readiness');
  await expect(panel).toBeVisible();
  const reason = panel.getByTestId('readiness-reason');
  await expect(reason).toHaveAttribute('data-code', 'bringup_stopped');
  await expect(reason).toContainText('Robot side is stopped. Press Start.');
  await expect(panel.getByTestId('readiness-row-link')).toHaveAttribute('data-highlighted', 'true');
  await panel.screenshot({ path: shot(testInfo, 'stopped') });

  // The VR launcher carries the compact variant with the same line.
  await expect(page.getByTestId('robot-readiness-compact').getByTestId('readiness-reason')).toContainText(
    'Robot side is stopped',
  );

  await panel.getByTestId('readiness-start').click();
  await expect(reason).toHaveAttribute('data-code', 'bringup_busy', { timeout: 10_000 });
  await expect(panel.locator('[data-status="pending"]').first()).toBeVisible();
  await panel.screenshot({ path: shot(testInfo, 'starting') });

  await expect(reason).toHaveAttribute('data-code', 'read_only', { timeout: 15_000 });
  for (const row of ['link', 'bridge', 'sidecar', 'agent']) {
    await expect(panel.getByTestId(`readiness-row-${row}`)).toHaveAttribute('data-status', /ok|warn/);
  }
  await expect(panel.getByTestId('readiness-arm-control')).toBeVisible();
  await panel.screenshot({ path: shot(testInfo, 'ready') });

  await panel.getByTestId('readiness-stop').click();
  const dialog = page.getByTestId('readiness-stop-confirm');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('readiness-limp-offer')).toBeVisible();
  await page.screenshot({ path: shot(testInfo, 'stop-dialog') });
  await page.getByTestId('readiness-stop-confirm-confirm').click();
  await expect(reason).toHaveAttribute('data-code', 'bringup_stopped', { timeout: 10_000 });

  expect(errors).toEqual([]);
});
