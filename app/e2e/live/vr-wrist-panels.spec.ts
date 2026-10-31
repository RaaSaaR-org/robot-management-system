/**
 * @file vr-wrist-panels.spec.ts
 * @description TASK-443: inside an emulated Quest (IWER, `?xremu` on
 *   localhost), a Head + wrists session shows two wrist screens below the head
 *   screen and a head-only session shows none. Read off
 *   `window.__neodemVrUi.wristCameras`, the panels the scene actually mounted,
 *   and — for the wrists session — the wrist cameras' ticket requests, which a
 *   head-only session must never make.
 *
 *   Needs a DEV build (the emulator and `__neodemVrUi` exist only there) with
 *   the demo's mocked API, so no robot or server is involved. From `app/`:
 *     VITE_DEMO_MODE=true npx vite --port 4201 --strictPort
 *     PLAYWRIGHT_LIVE_URL=http://localhost:4201/robot-management-system/ \
 *       npx playwright test --config=playwright.live.config.ts vr-wrist-panels
 *   Set VR_SCREENSHOT_DIR to also save the emulator view there.
 */
import { test, expect, type Page } from '@playwright/test';

const ROBOT = 'demo-g1-001';
const HEAD_AND_WRISTS = ['head_camera', 'left_wrist_camera', 'right_wrist_camera'];
const SCREENS = process.env.VR_SCREENSHOT_DIR;

interface DebugWindow {
  __neodemXr?: { enterVR: () => Promise<unknown>; getState: () => { session: unknown; emulator?: unknown } };
  __neodemVrUi?: { wristCameras?: string[]; panel: string[] };
}

/** The demo G1 serves the head and both wrists, as a robot with wrist cameras would. */
async function serveWrists(page: Page): Promise<void> {
  await page.evaluate(async ([robotId, cameras]) => {
    await fetch(`/api/__demo/robots/${robotId}/cameras`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cameras, configured: cameras }),
    });
  }, [ROBOT, HEAD_AND_WRISTS] as const);
}

/** Open the session page under the emulator, pin the cameras, launch the VR modal and enter VR. */
async function enterVr(page: Page, sessionId: string): Promise<string[]> {
  const tickets: string[] = [];
  page.on('request', (req) => {
    const m = req.url().match(/\/api\/robots\/[^/]+\/camera\/([^/?]+)\/ticket/);
    if (m) tickets.push(m[1]);
  });
  // `xremu` must be in the query string at load: the emulator switch is read once.
  await page.goto(`./?xremu#/data-collection/${sessionId}`);
  // Under the emulator the page takes the headset's role: Launch VR is its hero.
  const launch = page.getByRole('button', { name: 'Launch VR' });
  await expect(launch).toBeVisible({ timeout: 20_000 });
  await serveWrists(page);
  await launch.click();
  await expect(page.getByRole('dialog', { name: /VR teleop/i })).toBeVisible();
  await page.waitForFunction(() => Boolean((window as DebugWindow).__neodemXr?.getState().emulator), null, { timeout: 20_000 });
  await expect(async () => {
    await page.evaluate(() => (window as DebugWindow).__neodemXr!.enterVR());
  }).toPass({ timeout: 20_000, intervals: [500] });
  await page.waitForFunction(() => Boolean((window as DebugWindow).__neodemXr!.getState().session), null, { timeout: 20_000 });
  return tickets;
}

const wristCameras = (page: Page) =>
  page.evaluate(() => (window as DebugWindow).__neodemVrUi?.wristCameras ?? null);

test.describe('VR wrist panels (TASK-443)', () => {
  test('a Head + wrists session mounts both wrist screens', async ({ page }) => {
    const tickets = await enterVr(page, 'demo-session-wrists');
    await expect.poll(() => wristCameras(page)).toEqual(['left_wrist_camera', 'right_wrist_camera']);
    await expect.poll(() => [...new Set(tickets)].sort()).toEqual(HEAD_AND_WRISTS.slice().sort());
    if (SCREENS) {
      await page.waitForTimeout(1_500); // let the stills reach their textures
      await page.screenshot({ path: `${SCREENS}/TASK-443-wrists.png` });
    }
  });

  test('a head-only session mounts none and asks for no wrist ticket', async ({ page }) => {
    const tickets = await enterVr(page, 'demo-session-takes-vr');
    await expect.poll(() => tickets.includes('head_camera')).toBe(true);
    await page.waitForTimeout(1_000);
    expect(await wristCameras(page)).toEqual([]);
    expect(tickets.filter((c) => c.includes('wrist'))).toEqual([]);
    if (SCREENS) await page.screenshot({ path: `${SCREENS}/TASK-443-head-only.png` });
  });
});
