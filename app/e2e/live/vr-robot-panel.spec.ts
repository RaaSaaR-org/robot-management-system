/**
 * @file vr-robot-panel.spec.ts
 * @description TASK-407, live: inside an emulated Quest (IWER, `?xremu` on
 *   localhost) the right controller's ray presses the robot panel's Recenter
 *   with a trigger pull while the grip is free; squeezing the grip hides the
 *   ray; B latches the E-stop WITHOUT leaving VR, after which Reset E-stop is
 *   the only live button and needs a one-second hold; and holding a grip never
 *   shows the link as stale or lost.
 *
 *   Needs a LIVE dev stack against a SIM robot (server + robot-agent + app, the
 *   app a DEV build so `window.__neodemXr` / `window.__neodemVrUi` exist):
 *     PLAYWRIGHT_LIVE_URL=http://localhost:1437 VR_ROBOT_ID=sim-robot-g1-edu \
 *       npx playwright test --config=playwright.live.config.ts vr-robot-panel
 *   Never point it at a real robot: it raises and resets an E-stop.
 */
import { test, expect, type Page } from '@playwright/test';

const ROBOT_ID = process.env.VR_ROBOT_ID ?? 'sim-robot-g1-edu';
const SCREENS = process.env.VR_SCREENSHOT_DIR;

type Vec3 = [number, number, number];

interface DebugWindow {
  __neodemXr?: {
    enterVR: () => Promise<unknown>;
    getState: () => {
      session: unknown;
      emulator?: {
        controllers: Record<'left' | 'right', {
          position: { set: (x: number, y: number, z: number) => void; x: number; y: number; z: number };
          quaternion: { set: (x: number, y: number, z: number, w: number) => void };
          updateButtonValue: (id: string, value: number) => void;
        }>;
      };
    };
  };
  __neodemVrUi?: {
    clicks: Array<{ id: string; at: number }>;
    rays: Record<'left' | 'right', { visible: boolean; active: boolean; hitId: string | null; origin: Vec3 | null }>;
    targets: () => Array<{ id: string; live: boolean; center: Vec3 | null }>;
    panel: string[];
  };
}

/** Open the robot's VR teleop modal with the IWER emulator wired up, and take control. */
async function openVrModal(page: Page): Promise<void> {
  // `xremu` must be in the query string at load: the emulator switch is read
  // once, when `vrConstants` loads.
  await page.goto(`/robots/${ROBOT_ID}?tab=teleop&xremu`);
  await page.getByTestId('vr-launch').click();
  const modal = page.getByRole('dialog', { name: /VR teleop/i });
  await expect(modal.getByText(/Link (live|stale|lost)/)).toBeVisible({ timeout: 20_000 });
  // Leases on: take control so the rig may stream (as an operator would).
  // A lease left by an earlier run lapses on its TTL, so retry for a while.
  const take = modal.getByRole('button', { name: /^Take control$/ });
  const release = modal.getByRole('button', { name: /^Release control$/ });
  if (!(await take.isVisible().catch(() => false))) return;
  await expect(async () => {
    if (await release.isVisible().catch(() => false)) return;
    await take.click();
    const confirm = page.getByRole('alertdialog').getByRole('button', { name: /^Take control$/ });
    if (await confirm.isVisible({ timeout: 1_000 }).catch(() => false)) await confirm.click();
    await expect(release).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 90_000, intervals: [2_000] });
}

/** Hand the lease back, so the next test (or the next run) can take it. */
async function releaseControl(page: Page): Promise<void> {
  // Leave VR first: the emulator's overlay sits over the page while a session runs.
  await page.evaluate(() => (window as DebugWindow).__neodemXr?.getState().session)
    .then(() => page.evaluate(async () => {
      const session = (window as DebugWindow).__neodemXr?.getState().session as { end?: () => Promise<void> } | null;
      await session?.end?.().catch(() => {});
    }));
  const release = page.getByRole('dialog', { name: /VR teleop/i }).getByRole('button', { name: /^Release control$/ });
  if (await release.isVisible().catch(() => false)) {
    await release.click({ timeout: 10_000, force: true });
    const confirm = page.getByRole('alertdialog').getByRole('button', { name: /^Release/ });
    if (await confirm.isVisible({ timeout: 1_000 }).catch(() => false)) await confirm.click({ timeout: 5_000 });
  }
}

async function enterVr(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean((window as DebugWindow).__neodemXr?.getState().emulator), null, {
    timeout: 20_000,
  });
  // The store refuses until the canvas has connected it to three.js.
  await expect(async () => {
    await page.evaluate(() => (window as DebugWindow).__neodemXr!.enterVR());
  }).toPass({ timeout: 20_000, intervals: [500] });
  await page.waitForFunction(() => Boolean((window as DebugWindow).__neodemXr!.getState().session), null, {
    timeout: 20_000,
  });
  await page.waitForFunction(
    () => (window as DebugWindow).__neodemVrUi?.targets().some((t) => t.id === 'recenter' && t.center !== null),
    null,
    { timeout: 20_000 },
  );
}

/** Point the right controller's ray at a button's centre (reference-space coordinates). */
async function aimRightAt(page: Page, id: string): Promise<void> {
  // Wait until the ray reports where it starts — it does once the grip is free
  // and the controller is posed.
  await page.waitForFunction(() => Boolean((window as DebugWindow).__neodemVrUi?.rays.right.origin), null, {
    timeout: 10_000,
  });
  await page.evaluate((targetId) => {
    const w = window as DebugWindow;
    const ui = w.__neodemVrUi!;
    const target = ui.targets().find((t) => t.id === targetId);
    const origin = ui.rays.right.origin;
    if (!target?.center || !origin) throw new Error(`no ${targetId} / ray`);
    const d = target.center.map((c, i) => c - origin[i]!) as Vec3;
    const n = Math.hypot(...d);
    const [x, y, z] = d.map((v) => v / n) as Vec3;
    // The rotation that takes the ray's -Z onto d.
    const q = [y, -x, 0, 1 - z];
    const qn = Math.hypot(...q);
    const [qx, qy, qz, qw] = q.map((v) => v / qn) as [number, number, number, number];
    // IWER's DevUI re-syncs the controllers from its own 3D transform handles
    // every frame (`syncDeviceTransforms`), so a rotation set on the device
    // alone is overwritten before the session sees it. Turn the handle instead:
    // its WORLD rotation is what the device receives.
    type Q = { set: (...v: number[]) => Q; clone: () => Q; invert: () => Q; multiply: (q: Q) => Q; copy: (q: Q) => Q };
    const handles = (window as unknown as {
      transformHandles?: Map<string, { quaternion: Q; parent: { getWorldQuaternion: (q: Q) => Q } | null }>;
    }).transformHandles;
    const handle = handles?.get('right');
    if (handle?.parent) {
      const parentWorld = handle.parent.getWorldQuaternion(handle.quaternion.clone());
      const desired = handle.quaternion.clone().set(qx, qy, qz, qw);
      handle.quaternion.copy(parentWorld.invert().multiply(desired));
    } else {
      w.__neodemXr!.getState().emulator!.controllers.right.quaternion.set(qx, qy, qz, qw);
    }
  }, id);
  await page.waitForFunction((targetId) => (window as DebugWindow).__neodemVrUi?.rays.right.hitId === targetId, id, {
    timeout: 5_000,
  });
}

async function setButton(page: Page, side: 'left' | 'right', button: string, value: number): Promise<void> {
  await page.evaluate(([s, b, v]) => {
    (window as DebugWindow).__neodemXr!.getState().emulator!.controllers[s as 'left' | 'right'].updateButtonValue(b as string, v as number);
  }, [side, button, value] as const);
}

const clicksOf = (page: Page, id: string) =>
  page.evaluate((targetId) => (window as DebugWindow).__neodemVrUi!.clicks.filter((c) => c.id === targetId).length, id);

async function shot(page: Page, name: string): Promise<void> {
  if (SCREENS) await page.screenshot({ path: `${SCREENS}/TASK-407-${name}.png` });
}

test.describe('VR robot panel (TASK-407)', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(180_000);
  test.afterEach(async ({ page }) => {
    await releaseControl(page).catch(() => { /* the page may be gone; the lease lapses on its TTL */ });
  });

  test('the ray presses Recenter with the trigger, and the grip hides it', async ({ page }) => {
    await openVrModal(page);
    await enterVr(page);
    await shot(page, 'robot-panel-in-vr');

    await aimRightAt(page, 'recenter');
    const before = await clicksOf(page, 'recenter');
    await setButton(page, 'right', 'trigger', 1);
    await expect.poll(() => clicksOf(page, 'recenter'), { timeout: 5_000 }).toBe(before + 1);
    await shot(page, 'ray-on-recenter');
    await setButton(page, 'right', 'trigger', 0);

    // Grip held: the trigger is the robot's grasp, so no ray and no click.
    await setButton(page, 'right', 'squeeze', 1);
    await page.waitForFunction(() => {
      const r = (window as DebugWindow).__neodemVrUi!.rays.right;
      return !r.visible && !r.active;
    }, null, { timeout: 5_000 });
    const held = await clicksOf(page, 'recenter');
    await setButton(page, 'right', 'trigger', 1);
    await page.waitForTimeout(500);
    expect(await clicksOf(page, 'recenter')).toBe(held);
    await setButton(page, 'right', 'trigger', 0);

    // Holding the grip streams poses; whatever the agent answers, LINK reads
    // transport only — never stale or lost on a healthy socket.
    const modal = page.getByRole('dialog', { name: /VR teleop/i });
    for (let i = 0; i < 20; i++) {
      await expect(modal.getByText(/Link (stale|lost)/)).toHaveCount(0);
      await page.waitForTimeout(150);
    }
    const panel = await page.evaluate(() => (window as DebugWindow).__neodemVrUi!.panel);
    test.info().annotations.push({ type: 'robot panel (grip held)', description: panel.join(' | ') });
    await shot(page, 'grip-held');
    await setButton(page, 'right', 'squeeze', 0);
  });

  test('B latches without leaving VR; Reset E-stop is the only live button and needs a 1 s hold', async ({ page }) => {
    await openVrModal(page);
    await enterVr(page);

    await setButton(page, 'right', 'b-button', 1);
    const modal = page.getByRole('dialog', { name: /VR teleop/i });
    await expect(modal.getByText('E-stop latched')).toBeVisible({ timeout: 10_000 });
    await setButton(page, 'right', 'b-button', 0);
    // Still in the session.
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => Boolean((window as DebugWindow).__neodemXr!.getState().session))).toBe(true);

    await page.waitForFunction(() => {
      const ts = (window as DebugWindow).__neodemVrUi!.targets();
      return ts.find((t) => t.id === 'reset-estop')?.live === true;
    }, null, { timeout: 5_000 });
    const live = await page.evaluate(() => (window as DebugWindow).__neodemVrUi!.targets().filter((t) => t.live).map((t) => t.id));
    expect(live).toEqual(['reset-estop']);
    await shot(page, 'estop-latched-in-vr');

    await aimRightAt(page, 'reset-estop');
    // A short pull does nothing.
    await setButton(page, 'right', 'trigger', 1);
    await page.waitForTimeout(400);
    await setButton(page, 'right', 'trigger', 0);
    await page.waitForTimeout(200);
    expect(await clicksOf(page, 'reset-estop')).toBe(0);
    await expect(modal.getByText('E-stop latched')).toBeVisible();

    // A full second clears it.
    await setButton(page, 'right', 'trigger', 1);
    await page.waitForTimeout(600);
    await shot(page, 'reset-hold-progress');
    await expect.poll(() => clicksOf(page, 'reset-estop'), { timeout: 5_000 }).toBe(1);
    await setButton(page, 'right', 'trigger', 0);
    await expect(modal.getByText('E-stop latched')).toHaveCount(0, { timeout: 10_000 });
  });
});
