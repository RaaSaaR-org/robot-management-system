/**
 * @file datacollection-wrists.spec.ts
 * @description The session page's wrist views (TASK-442), on the demo build
 *   with MSW and the demo G1's pinned camera list (`cameraDemoHandlers.ts`):
 *   - Head + wrists (`demo-session-wrists`): the head view leads, the two wrist
 *     tiles sit beneath it (left on the left, not over the picture), a tile
 *     swaps into the main view and back, the Cameras cell names the set, and
 *     the console is as tall as a head-only session's — at 1512, 1280 and 390
 *     wide, with no horizontal scroll and the E-STOP's clearance unchanged;
 *   - a wrist the robot does not serve: an offline plate in its tile, the
 *     Cameras cell red, and the take dock says which camera is missing (with
 *     the robot side up, so no readiness reason outranks it);
 *   - head only (`demo-session-takes-vr`) on the same robot: no tiles, no
 *     Cameras cell, seven systems cells as before.
 *   Set SCREEN_DIR to also save screenshots there.
 * @feature datacollection
 */
import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

const shot = (name: string) => (process.env.SCREEN_DIR ? { path: path.join(process.env.SCREEN_DIR, name) } : {});
const ROBOT = 'demo-g1-001';
const HEAD_AND_WRISTS = ['head_camera', 'left_wrist_camera', 'right_wrist_camera'];

/**
 * Open a session with the demo G1 serving `cameras` (configured: all three).
 * The pin lives in this page load's MSW, so it is set before the session opens
 * by hash, without a reload.
 */
async function openSession(page: Page, sessionId: string, cameras: string[], readiness: string | null = null): Promise<void> {
  await page.goto('./#/data-collection');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.evaluate(async ([robotId, list, configured, fixture]) => {
    await fetch(`/api/__demo/robots/${robotId}/cameras`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cameras: list, configured }),
    });
    await fetch(`/api/__demo/robots/${robotId}/readiness`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fixture }),
    });
  }, [ROBOT, cameras, HEAD_AND_WRISTS, readiness] as const);
  await page.evaluate((sid) => { window.location.hash = `#/data-collection/${sid}`; }, sessionId);
  await expect(page.getByTestId('hud-phase')).toHaveText('READY');
}

/** The rectangle distance from the E-STOP to the nearest visible button outside its zone. */
const estopClearance = (page: Page) =>
  page.evaluate(() => {
    const estop = document.querySelector('[data-testid="session-estop"]') as HTMLElement;
    const E = estop.getBoundingClientRect();
    let best = Infinity;
    for (const el of document.querySelectorAll('a[href], button, [role="switch"], input, select, textarea')) {
      if (el === estop || !(el as HTMLElement).getClientRects().length) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const d = Math.hypot(Math.max(0, E.left - r.right, r.left - E.right), Math.max(0, E.top - r.bottom, r.top - E.bottom));
      best = Math.min(best, d);
    }
    return Math.round(best * 10) / 10;
  });

const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

const WIDTHS = [
  { width: 1512, height: 900, minGap: 64 },
  { width: 1280, height: 800, minGap: 48 },
  { width: 390, height: 844, minGap: 0 },
];

for (const { width, height, minGap } of WIDTHS) {
  test(`Head + wrists at ${width}: head big, both wrists beneath, swap and back`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    // The head-only console first, for its height and E-STOP clearance.
    await openSession(page, 'demo-session-takes-vr', HEAD_AND_WRISTS);
    await expect(page.getByTestId('session-lead-camera')).toHaveAttribute('data-slot', 'main');
    const headOnlyConsole = (await page.getByTestId('session-console').boundingBox())!;
    const headOnlyGap = await estopClearance(page);

    await openSession(page, 'demo-session-wrists', HEAD_AND_WRISTS);
    const frame = page.getByTestId('live-view-frame');
    const left = page.getByTestId('session-wrist-left');
    const right = page.getByTestId('session-wrist-right');
    await expect(page.getByTestId('session-lead-camera')).toHaveAttribute('data-slot', 'main');
    await expect(left.locator('img')).toBeVisible();
    await expect(right.locator('img')).toBeVisible();
    await expect(page.getByTestId('session-wrist-left-label')).toHaveText('Left wrist');
    await expect(page.getByTestId('session-wrist-right-label')).toHaveText('Right wrist');

    const f = (await frame.boundingBox())!;
    const l = (await left.boundingBox())!;
    const r = (await right.boundingBox())!;
    // Beneath the main view, not on it; left on the left; 4:3.
    expect(l.y).toBeGreaterThanOrEqual(f.y + f.height - 0.5);
    expect(r.y).toBeGreaterThanOrEqual(f.y + f.height - 0.5);
    expect(l.x + l.width).toBeLessThanOrEqual(r.x);
    expect(l.width / l.height).toBeCloseTo(4 / 3, 1);
    // Inside the well.
    const well = (await page.getByTestId('live-view').boundingBox())!;
    expect(l.y + l.height).toBeLessThanOrEqual(well.y + well.height + 0.5);
    expect(l.x).toBeGreaterThanOrEqual(well.x - 0.5);
    expect(r.x + r.width).toBeLessThanOrEqual(well.x + well.width + 0.5);

    // The console keeps its height on a desktop (the phone stacks and scrolls).
    if (width >= 1024) {
      const console_ = (await page.getByTestId('session-console').boundingBox())!;
      expect(Math.abs(console_.height - headOnlyConsole.height)).toBeLessThanOrEqual(1);
    }
    expect(await noHorizontalScroll(page)).toBe(true);
    // The longer view switch never runs under the live state.
    const sw = (await page.getByTestId('live-view-switch').boundingBox())!;
    const state = (await page.getByTestId('live-view-state').boundingBox())!;
    expect(sw.x + sw.width).toBeLessThanOrEqual(state.x);
    const gap = await estopClearance(page);
    expect(gap).toBeGreaterThanOrEqual(Math.min(headOnlyGap, minGap));
    await page.screenshot(shot(`wrists-${width}.png`));

    // The camera set, in the systems strip.
    if (width >= 640) {
      await expect(page.getByTestId('systems-cell-cameras')).toContainText('Head + 2 wrists');
      await expect(page.getByTestId('systems-cell-cameras')).toHaveAttribute('data-status', 'ok');
    }

    // Swap the left wrist in, the head into its tile, and back.
    await left.click();
    await expect(page.getByTestId('session-camera-left_wrist_camera')).toHaveAttribute('data-slot', 'main');
    await expect(left).toHaveAttribute('data-camera', 'head_camera');
    await expect(page.getByTestId('session-wrist-left-label')).toHaveText('Head camera');
    await expect(page.getByTestId('live-view-switch').getByRole('button', { name: 'Left wrist' })).toHaveAttribute('aria-pressed', 'true');
    await page.screenshot(shot(`wrists-${width}-swapped.png`));
    await left.click();
    await expect(page.getByTestId('session-lead-camera')).toHaveAttribute('data-slot', 'main');
    await expect(left).toHaveAttribute('data-camera', 'left_wrist_camera');
  });
}

test('a wrist the robot does not serve: an offline plate, a red Cameras cell, the dock names it', async ({ page }) => {
  await page.setViewportSize({ width: 1512, height: 900 });
  // A robot side that is up, so no readiness reason outranks the camera's.
  await openSession(page, 'demo-session-wrists', ['head_camera', 'right_wrist_camera'], 'following');
  await expect(page.getByTestId('session-wrist-left-offline')).toHaveText('Left wrist camera offline');
  await expect(page.getByTestId('session-wrist-left').locator('img')).toHaveCount(0);
  await expect(page.getByTestId('session-wrist-right').locator('img')).toBeVisible();
  // The head keeps streaming.
  await expect(page.getByTestId('session-lead-camera').locator('img')).toBeVisible();
  const cell = page.getByTestId('systems-cell-cameras');
  await expect(cell).toHaveAttribute('data-status', 'fail');
  await expect(cell).toContainText('Left wrist offline');
  await expect(page.getByTestId('take-dock-reason')).toContainText('Left wrist camera is not being served.');
  await page.screenshot(shot('wrists-left-offline.png'));
});

test('head only on a robot with wrist cameras: no tiles, no Cameras cell, the same seven cells', async ({ page }) => {
  await page.setViewportSize({ width: 1512, height: 900 });
  await openSession(page, 'demo-session-takes-vr', HEAD_AND_WRISTS);
  await expect(page.getByTestId('session-lead-camera')).toHaveAttribute('data-slot', 'main');
  await expect(page.getByTestId('live-view-wrists')).toHaveCount(0);
  await expect(page.getByTestId('session-wrist-left')).toHaveCount(0);
  await expect(page.getByTestId('systems-cell-cameras')).toHaveCount(0);
  await expect(page.locator('[data-systems-cell]')).toHaveCount(7);
  // Twin in the PiP, the head in the main view: the wrists open no stream.
  await expect(page.getByTestId('live-view').locator('img')).toHaveCount(1);
  // The view switch still lists every camera the robot serves.
  await expect(page.getByTestId('live-view-switch').getByRole('button')).toHaveText(['Twin', 'Head camera', 'Left wrist', 'Right wrist']);
  await page.screenshot(shot('head-only.png'));
});
