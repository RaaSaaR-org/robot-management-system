/**
 * @file quest-connect.spec.ts
 * @description The one-button Quest flow in the demo build (TASK-412), MSW
 *              answering: the headset's stable URL `/data-collection/live?robot=`
 *              waits while the robot has no live session and follows the one
 *              created after it opened; the readiness panel's Quest row
 *              forwards the port with Connect; the VR launcher shows the
 *              headset's live state with Connect / Open on headset, and Copy
 *              viewer link on a session page. Set QUEST_SCREENS_DIR to keep
 *              the screenshots.
 * @feature robots
 */
import { expect, test } from '@playwright/test';
import path from 'node:path';

const ROBOT = 'demo-g1-001';

const shot = (testInfo: { outputPath: (n: string) => string }, name: string): string =>
  process.env.QUEST_SCREENS_DIR
    ? path.join(process.env.QUEST_SCREENS_DIR, `TASK-412-${name}.png`)
    : testInfo.outputPath(`${name}.png`);

test('the headset URL waits for a live session and follows the one created after it opened', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`./#/data-collection/live?robot=${ROBOT}`);

  const status = page.getByTestId('live-session-status');
  await expect(status).toHaveText(`No live session for ${ROBOT}. Waiting…`, { timeout: 10_000 });
  await page.screenshot({ path: shot(testInfo, 'live-waiting') });

  // The desktop creates the session (here: the same MSW worker, as the app would).
  const id = await page.evaluate(async (robotId) => {
    const res = await fetch('/api/teleoperation/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ robotId, type: 'vr_quest', operatorId: 'demo-user' }),
    });
    return ((await res.json()) as { session: { id: string } }).session.id;
  }, ROBOT);

  await expect(page).toHaveURL(new RegExp(`#/data-collection/${id}$`), { timeout: 10_000 });
  // The history entry was replaced: Back does not return to the waiting page.
  expect(page.url()).not.toContain('/live');

  // On the session page the VR launcher offers the viewer link for the second person.
  const help = page.getByTestId('quest-connect-help');
  await expect(help).toHaveAttribute('data-mode', 'live', { timeout: 15_000 });
  await expect(help.getByTestId('quest-copy-viewer-link')).toBeVisible();
  await help.scrollIntoViewIfNeeded();
  await help.screenshot({ path: shot(testInfo, 'session-quest-help') });

  expect(errors).toEqual([]);
});

test('the readiness Quest row connects the headset and opens the live session on it', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const posts: Array<{ url: string; body: unknown }> = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && /\/quest\//.test(r.url())) posts.push({ url: r.url(), body: r.postDataJSON() });
  });
  await page.goto(`./#/robots/${ROBOT}?tab=teleop`);

  const panel = page.getByTestId('robot-readiness');
  const row = panel.getByTestId('readiness-row-quest');
  await expect(row).toContainText('Quest 3 (serial 2G0Y…0123) connected', { timeout: 10_000 });
  await expect(row).toContainText('not forwarded');
  await panel.screenshot({ path: shot(testInfo, 'readiness-quest-row') });

  await row.getByTestId('quest-connect').click();
  await expect(row).toHaveAttribute('data-status', 'ok', { timeout: 10_000 });
  await expect(row).toContainText('forwarded');

  await row.getByTestId('quest-open').click();
  await expect(row.getByTestId('quest-message')).toContainText('Opened in the Quest browser');
  await row.screenshot({ path: shot(testInfo, 'readiness-quest-opened') });

  const open = posts.find((p) => p.url.endsWith('/quest/open'));
  expect(open?.body).toMatchObject({ path: `/data-collection/live?robot=${ROBOT}` });

  // The VR launcher's help shows the same headset, live.
  const help = page.getByTestId('quest-connect-help');
  await expect(help).toHaveAttribute('data-mode', 'live');
  await expect(help.getByTestId('quest-live-status')).toContainText('forwarded');
  await help.scrollIntoViewIfNeeded();
  await page.screenshot({ path: shot(testInfo, 'teleop-tab'), fullPage: false });

  expect(errors).toEqual([]);
});
