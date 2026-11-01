/**
 * @file vr-session-board.spec.ts
 * @description TASK-413, live: inside an emulated Quest (IWER, `?xremu` on
 *   localhost) on a recording session's page, the operator runs the take loop
 *   from the headset. The ray presses the session board's Start → the server's
 *   live state reads `capturing` and the board `● REC Take 1`; Stop → the
 *   board shows the quick check; the left stick click starts take 2 and a
 *   1.5 s right-stick hold discards it, leaving `kept` unchanged. With the
 *   E-stop latched (B) every session button is dead and the left stick does
 *   nothing; Reset E-stop (1 s hold) still clears it.
 *
 *   Needs a LIVE dev stack against a SIM robot (server + robot-agent + sim
 *   sidecar + app, the app a DEV build so `window.__neodemXr` /
 *   `window.__neodemVrUi` exist). It creates its own session:
 *     PLAYWRIGHT_LIVE_URL=http://localhost:1443 VR_ROBOT_ID=sim-robot-g1-edu \
 *       npx playwright test --config=playwright.live.config.ts vr-session-board
 *   Never point it at a real robot: it records, raises and resets an E-stop.
 *   Set VR_SCREENSHOT_DIR to also save screenshots there.
 */
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

const ROBOT_ID = process.env.VR_ROBOT_ID ?? 'sim-robot-g1-edu';
const SCREENS = process.env.VR_SCREENSHOT_DIR;

type Vec3 = [number, number, number];
type Side = 'left' | 'right';

interface DebugWindow {
  __neodemXr?: {
    enterVR: () => Promise<unknown>;
    getState: () => {
      session: unknown;
      emulator?: {
        controllers: Record<Side, {
          quaternion: { set: (x: number, y: number, z: number, w: number) => void };
          updateButtonValue: (id: string, value: number) => void;
        }>;
      };
    };
  };
  __neodemVrUi?: {
    clicks: Array<{ id: string; at: number }>;
    rays: Record<Side, { visible: boolean; active: boolean; hitId: string | null; origin: Vec3 | null }>;
    targets: () => Array<{ id: string; live: boolean; center: Vec3 | null }>;
    panel: string[];
    board: string[];
  };
}

interface Live {
  phase: 'between' | 'capturing' | null;
  take: number | null;
  kept: number;
  discarded: number;
}

async function readLive(request: APIRequestContext, baseURL: string, sessionId: string): Promise<Live> {
  const res = await request.get(`${baseURL}/api/teleoperation/sessions/${sessionId}/live`);
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as Live | { live: Live };
  return 'live' in body ? body.live : body;
}

async function shot(page: Page, name: string): Promise<void> {
  if (!SCREENS) return;
  await page.waitForTimeout(400); // let the panels recompose (8 Hz)
  await page.screenshot({ path: `${SCREENS}/TASK-413-${name}.png` });
}

const board = (page: Page) => page.evaluate(() => (window as DebugWindow).__neodemVrUi?.board ?? []);
const boardText = async (page: Page) => (await board(page)).join(' | ');
const panel = (page: Page) => page.evaluate(() => (window as DebugWindow).__neodemVrUi?.panel ?? []);

async function setButton(page: Page, side: Side, button: string, value: number): Promise<void> {
  await page.evaluate(([s, b, v]) => {
    (window as DebugWindow).__neodemXr!.getState().emulator!.controllers[s as Side].updateButtonValue(b as string, v as number);
  }, [side, button, value] as const);
}

/** Open the session's VR modal with the emulator wired up, and take control. */
async function openVrModal(page: Page, sessionId: string): Promise<void> {
  // `xremu` must be in the query string at load: the emulator switch is read once.
  await page.goto(`/data-collection/${sessionId}?xremu`);
  await page.getByTestId('vr-launch').click();
  const modal = page.getByRole('dialog', { name: /VR teleop/i });
  await expect(modal.getByText(/Link (live|stale|lost)/)).toBeVisible({ timeout: 20_000 });
  const take = modal.getByRole('button', { name: /^Take control$/ });
  const release = modal.getByRole('button', { name: /^Release control$/ });
  // A latch left by an earlier run would lock every session button: clear it
  // from the desktop, as an operator would before putting the headset on.
  const reset = modal.getByRole('button', { name: /^Reset E-stop$/ });
  if (await reset.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await reset.click();
    await expect(modal.getByText('E-stop latched')).toHaveCount(0, { timeout: 10_000 });
  }
  if (!(await take.isVisible().catch(() => false))) return;
  await expect(async () => {
    if (await release.isVisible().catch(() => false)) return;
    await take.click();
    const confirm = page.getByRole('alertdialog').getByRole('button', { name: /^Take control$/ });
    if (await confirm.isVisible({ timeout: 1_000 }).catch(() => false)) await confirm.click();
    await expect(release).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 90_000, intervals: [2_000] });
}

async function enterVr(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean((window as DebugWindow).__neodemXr?.getState().emulator), null, { timeout: 20_000 });
  await expect(async () => {
    await page.evaluate(() => (window as DebugWindow).__neodemXr!.enterVR());
  }).toPass({ timeout: 20_000, intervals: [500] });
  await page.waitForFunction(() => Boolean((window as DebugWindow).__neodemXr!.getState().session), null, { timeout: 20_000 });
  await page.waitForFunction(
    () => (window as DebugWindow).__neodemVrUi?.targets().some((t) => t.id === 'session-start' && t.center !== null),
    null,
    { timeout: 20_000 },
  );
}

/**
 * Point the right controller's ray at a button's centre. Re-aimed until it
 * lands: the first frames in VR can still move the origin (the recenter onto
 * the robot's head), which leaves a ray aimed from the old origin off target.
 */
async function aimRightAt(page: Page, id: string): Promise<void> {
  try {
    await expect(async () => {
      await aimOnce(page, id);
      await page.waitForFunction((targetId) => (window as DebugWindow).__neodemVrUi?.rays.right.hitId === targetId, id, { timeout: 2_000 });
    }).toPass({ timeout: 15_000, intervals: [250, 500, 1_000] });
  } catch (err) {
    const ui = await page.evaluate(() => {
      const u = (window as DebugWindow).__neodemVrUi;
      return u ? { ray: u.rays.right, targets: u.targets(), board: u.board } : null;
    });
    throw new Error(`could not aim at ${id}: ${JSON.stringify(ui)}\n${String(err)}`);
  }
}

async function aimOnce(page: Page, id: string): Promise<void> {
  await page.waitForFunction(() => Boolean((window as DebugWindow).__neodemVrUi?.rays.right.origin), null, { timeout: 10_000 });
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
    // IWER's DevUI re-syncs the controllers from its own transform handles every
    // frame, so turn the handle (see vr-robot-panel.spec.ts).
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
}

const clicksOf = (page: Page, id: string) =>
  page.evaluate((targetId) => (window as DebugWindow).__neodemVrUi!.clicks.filter((c) => c.id === targetId).length, id);

/**
 * Ray-click a button: aim, pull, and hold until the click registers (a
 * hold-to-confirm button fires only after its hold, on the headset's frame
 * clock, which a headless emulator runs slowly), then let go.
 */
async function press(page: Page, id: string): Promise<void> {
  await aimRightAt(page, id);
  const before = await clicksOf(page, id);
  await setButton(page, 'right', 'trigger', 1);
  await expect.poll(() => clicksOf(page, id), { timeout: 8_000 }).toBe(before + 1);
  await setButton(page, 'right', 'trigger', 0);
  await page.waitForTimeout(100);
}

async function releaseControl(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const session = (window as DebugWindow).__neodemXr?.getState().session as { end?: () => Promise<void> } | null;
    await session?.end?.().catch(() => {});
  });
  const release = page.getByRole('dialog', { name: /VR teleop/i }).getByRole('button', { name: /^Release control$/ });
  if (await release.isVisible().catch(() => false)) {
    await release.click({ timeout: 10_000, force: true });
    const confirm = page.getByRole('alertdialog').getByRole('button', { name: /^Release/ });
    if (await confirm.isVisible({ timeout: 1_000 }).catch(() => false)) await confirm.click({ timeout: 5_000 });
  }
}

test('the Quest operator starts, stops and discards takes from inside VR (TASK-413)', async ({ page, request, baseURL }) => {
  test.skip(!/sim/i.test(ROBOT_ID), 'VR_ROBOT_ID must be a SIM robot');
  test.setTimeout(240_000);
  const base = baseURL!;

  // A recording vr_quest session, ready for take 1.
  const created = await request.post(`${base}/api/teleoperation/sessions`, {
    data: { operatorId: 'live-check', robotId: ROBOT_ID, type: 'vr_quest', fps: 30, languageInstr: 'TASK-413 live check: wave' },
  });
  expect(created.ok()).toBeTruthy();
  const sessionId = ((await created.json()) as { session: { id: string } }).session.id;
  expect((await request.post(`${base}/api/teleoperation/sessions/${sessionId}/start`)).ok()).toBeTruthy();
  // A latch left by an earlier run would lock every session button.
  await request.post(`${base}/api/safety/robots/${ROBOT_ID}/estop/reset`);
  await expect.poll(async () => (await readLive(request, base, sessionId)).phase, { timeout: 15_000 }).toBe('between');

  try {
    await openVrModal(page, sessionId);
    await enterVr(page);
    await expect.poll(() => boardText(page), { timeout: 10_000 }).toContain('READY  Take 1 next');
    await shot(page, 'board-ready');

    // ---- Start with the ray → capturing, ● REC Take 1 ---------------------
    await press(page, 'session-start');
    await expect.poll(async () => (await readLive(request, base, sessionId)).phase, { timeout: 10_000 }).toBe('capturing');
    await expect.poll(() => boardText(page), { timeout: 5_000 }).toMatch(/REC {2}Take 1 {3}\d\d:\d\d/);
    // Drive the arm a little so the take has frames: the grip streams poses.
    await setButton(page, 'right', 'squeeze', 1);
    await page.waitForTimeout(2_500);
    await setButton(page, 'right', 'squeeze', 0);
    await shot(page, 'board-recording');
    console.log(`[TASK-413] board while recording: ${await boardText(page)}`);

    // ---- Stop with the ray → the quick check -------------------------------
    await press(page, 'session-stop');
    await expect.poll(async () => (await readLive(request, base, sessionId)).phase, { timeout: 10_000 }).toBe('between');
    await expect.poll(() => boardText(page), { timeout: 5_000 }).toMatch(/Take 1 · \d+\.\d s · \d+ fr · /);
    expect(await boardText(page)).toMatch(/✓ looks good|⚠ /);
    await shot(page, 'board-quick-check');
    console.log(`[TASK-413] board after Stop: ${await boardText(page)}`);
    const afterStop = await readLive(request, base, sessionId);
    expect(afterStop.kept).toBe(1);

    // ---- Left stick click starts take 2 ------------------------------------
    await setButton(page, 'left', 'thumbstick', 1);
    await page.waitForTimeout(200);
    await setButton(page, 'left', 'thumbstick', 0);
    await expect.poll(async () => (await readLive(request, base, sessionId)).phase, { timeout: 10_000 }).toBe('capturing');
    expect((await readLive(request, base, sessionId)).take).toBe(1);
    await expect.poll(() => boardText(page), { timeout: 5_000 }).toMatch(/REC {2}Take 2/);

    // ---- Right stick held 1.5 s discards it; kept is unchanged -------------
    await setButton(page, 'right', 'thumbstick', 1);
    await page.waitForTimeout(800);
    // Not yet: still capturing mid-hold.
    expect((await readLive(request, base, sessionId)).phase).toBe('capturing');
    await page.waitForTimeout(1_000);
    await setButton(page, 'right', 'thumbstick', 0);
    await expect.poll(async () => (await readLive(request, base, sessionId)).discarded, { timeout: 10_000 }).toBe(1);
    const afterDiscard = await readLive(request, base, sessionId);
    expect(afterDiscard.kept).toBe(afterStop.kept);
    expect(afterDiscard.phase).toBe('between');
    await expect.poll(() => boardText(page), { timeout: 5_000 }).toContain('kept 1 · discarded 1');
    await shot(page, 'board-discarded');
    console.log(`[TASK-413] board after the hold-discard: ${await boardText(page)}`);

    // ---- E-stop latched: every session button is dead ----------------------
    await setButton(page, 'right', 'b-button', 1);
    const modal = page.getByRole('dialog', { name: /VR teleop/i });
    await expect(modal.getByText('E-stop latched')).toBeVisible({ timeout: 10_000 });
    await setButton(page, 'right', 'b-button', 0);
    await page.waitForFunction(() => {
      const ts = (window as DebugWindow).__neodemVrUi!.targets();
      return ts.find((t) => t.id === 'reset-estop')?.live === true;
    }, null, { timeout: 5_000 });
    const liveIds = await page.evaluate(() => (window as DebugWindow).__neodemVrUi!.targets().filter((t) => t.live).map((t) => t.id));
    expect(liveIds).toEqual(['reset-estop']);
    // The left stick does nothing either.
    await setButton(page, 'left', 'thumbstick', 1);
    await page.waitForTimeout(200);
    await setButton(page, 'left', 'thumbstick', 0);
    await page.waitForTimeout(1_000);
    expect((await readLive(request, base, sessionId)).phase).toBe('between');
    await expect.poll(() => boardText(page), { timeout: 5_000 }).toContain('READY  Take 3 next');
    await shot(page, 'board-estop-latched');

    // Reset E-stop (TASK-407) still works, and the board comes back.
    await press(page, 'reset-estop');
    await expect(modal.getByText('E-stop latched')).toHaveCount(0, { timeout: 10_000 });
    await page.waitForFunction(
      () => (window as DebugWindow).__neodemVrUi!.targets().find((t) => t.id === 'session-start')?.live === true,
      null,
      { timeout: 5_000 },
    );

    // The robot panel carries the camera line (TASK-401) above the why line.
    const lines = await panel(page);
    test.info().annotations.push({ type: 'robot panel', description: lines.join(' | ') });
    test.info().annotations.push({ type: 'session board', description: await boardText(page) });
    console.log(`[TASK-413] robot panel: ${lines.join(' | ')}`);
    expect(lines.some((l) => l.startsWith('CAMERA '))).toBe(true);
  } finally {
    await releaseControl(page).catch(() => { /* the lease lapses on its TTL */ });
    await request.post(`${base}/api/teleoperation/sessions/${sessionId}/end`).catch(() => { /* best effort */ });
  }
});

test('the robot page Teleop tab has no session, so no session board and no stick take controls', async ({ page }) => {
  test.skip(!/sim/i.test(ROBOT_ID), 'VR_ROBOT_ID must be a SIM robot');
  test.setTimeout(180_000);
  try {
    await page.goto(`/robots/${ROBOT_ID}?tab=teleop&xremu`);
    await page.getByTestId('vr-launch').click();
    const modal = page.getByRole('dialog', { name: /VR teleop/i });
    await expect(modal.getByText(/Link (live|stale|lost)/)).toBeVisible({ timeout: 20_000 });
    await expect(modal.getByText('L-Stick')).toHaveCount(0);
    await expect(modal.getByText('R-Stick')).toHaveCount(0);
    await page.waitForFunction(() => Boolean((window as DebugWindow).__neodemXr?.getState().emulator), null, { timeout: 20_000 });
    await expect(async () => {
      await page.evaluate(() => (window as DebugWindow).__neodemXr!.enterVR());
    }).toPass({ timeout: 20_000, intervals: [500] });
    await page.waitForFunction(
      () => (window as DebugWindow).__neodemVrUi?.targets().some((t) => t.id === 'recenter' && t.center !== null),
      null,
      { timeout: 20_000 },
    );
    const ids = await page.evaluate(() => (window as DebugWindow).__neodemVrUi!.targets().map((t) => t.id));
    expect(ids.filter((id) => id.startsWith('session-'))).toEqual([]);
    expect(await board(page)).toEqual([]);
    await shot(page, 'teleop-tab-no-board');
  } finally {
    await releaseControl(page).catch(() => { /* nothing held */ });
  }
});
