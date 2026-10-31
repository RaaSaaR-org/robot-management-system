/**
 * @file datacollection-wrists-fixture.spec.ts
 * @description The demo build's Head + wrists fixtures (TASK-441), in a real
 *   browser through the service worker: `demo-session-wrists` records three
 *   cameras, the pinned demo G1 serves a still per camera (an <img> loads it),
 *   and an unpinned robot and the existing takes session are what they were.
 *   The session page itself is the UI children's to assert; here it only has
 *   to open.
 * @feature datacollection
 */
import { expect, test } from '@playwright/test';

const ROBOT = 'demo-g1-001';
const HEAD_AND_WRISTS = ['head_camera', 'left_wrist_camera', 'right_wrist_camera'];

test('demo-session-wrists records three cameras and the pinned G1 serves them', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('./#/data-collection/demo-session-wrists');
  await expect(page.getByTestId('hud-phase')).toHaveText('READY');

  const seen = await page.evaluate(async ([robotId, cameras]) => {
    const json = async (url: string, init?: RequestInit) => {
      const res = await fetch(url, init);
      return { status: res.status, body: res.ok ? await res.json() : null };
    };
    const before = await json(`/api/robots/${robotId}/cameras`);
    const wrists = await json('/api/teleoperation/sessions/demo-session-wrists');
    const takes = await json('/api/teleoperation/sessions/demo-session-takes');
    await fetch(`/api/__demo/robots/${robotId}/cameras`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cameras }),
    });
    const after = await json(`/api/robots/${robotId}/cameras`);
    // An <img>, as the session page and the headset load a camera.
    const sizes = await Promise.all(
      cameras.map(
        (camera) =>
          new Promise<string>((resolve) => {
            const img = new Image();
            img.onload = () => resolve(`${img.naturalWidth}x${img.naturalHeight}`);
            img.onerror = () => resolve('error');
            img.src = `/api/robots/${robotId}/camera/${camera}?ticket=demo-${camera}`;
          }),
      ),
    );
    await fetch(`/api/__demo/robots/${robotId}/cameras`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cameras: null }),
    });
    const released = await json(`/api/robots/${robotId}/cameras`);
    return { before, wrists, takes, after, sizes, released };
  }, [ROBOT, HEAD_AND_WRISTS] as const);

  expect(seen.before.status).toBe(404);
  expect(seen.wrists.body.session.cameras).toEqual(HEAD_AND_WRISTS);
  expect('cameras' in seen.takes.body.session).toBe(false);
  expect(seen.after.body.cameras).toEqual(HEAD_AND_WRISTS);
  expect(seen.sizes).toEqual(['640x480', '640x480', '640x480']);
  expect(seen.released.status).toBe(404);
  expect(errors).toEqual([]);
});
