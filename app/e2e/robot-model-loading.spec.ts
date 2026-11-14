/**
 * @file robot-model-loading.spec.ts
 * @description The 3D robot model on a cold load (TASK-502): while its meshes
 *              are still arriving the viewer says so — with a count — instead
 *              of showing a robot assembling itself from loose parts, and the
 *              note goes away once the last mesh has landed. Mesh requests are
 *              held back here to stand in for a slow link.
 *              Set MODEL_LOADING_SCREENS_DIR to keep the screenshots.
 * @feature robots
 */
import { expect, test } from '@playwright/test';
import path from 'node:path';

const shot = (testInfo: { outputPath: (n: string) => string }, name: string): string =>
  process.env.MODEL_LOADING_SCREENS_DIR
    ? path.join(process.env.MODEL_LOADING_SCREENS_DIR, `TASK-502-${name}.png`)
    : testInfo.outputPath(`${name}.png`);

test('the viewer says the model is loading until every mesh has arrived', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // Hold every mesh until the test lets go.
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = 0;
  // On the context, not the page: MSW's service worker fetches the meshes.
  await page.context().route(/\/assets\/robots\/.*\.(stl|dae)$/i, async (route) => {
    held += 1;
    await gate;
    await route.continue();
  });

  await page.goto('./#/robots/demo-h1-001');

  const viewer = page.getByTestId('robot-3d-viewer').first();
  await expect(viewer).toBeVisible();
  const loading = viewer.getByTestId('robot-3d-loading');
  // The URDF has parsed and named its meshes; none of them has arrived.
  await expect(loading).toHaveText(/^Loading 3D model… 1 \/ \d+$/, { timeout: 15_000 });
  expect(held).toBeGreaterThan(1);
  await viewer.screenshot({ path: shot(testInfo, 'loading') });

  release();
  await expect(loading).toHaveCount(0, { timeout: 30_000 });
  await viewer.screenshot({ path: shot(testInfo, 'loaded') });

  expect(errors).toEqual([]);
});
