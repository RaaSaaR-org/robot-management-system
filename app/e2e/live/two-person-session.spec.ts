/**
 * @file two-person-session.spec.ts
 * @description TASK-414, live: two browsers on one data-collection session.
 *   Context A is the Quest — an emulated headset (IWER, `?xremu` on localhost)
 *   on the session page with its VR modal open; context B is the desktop
 *   assistant on the same page. The spec proves the two converge:
 *     - A enters VR → B shows "In VR" and the operator in presence within 2 s;
 *       A's page renders no desktop twin or camera tile behind the modal; B
 *       sees the read-only lease holder and a twin on the fast channel.
 *     - A ray-clicks Start → B shows `● REC Take 1` and "started from the
 *       headset"; B presses Stop → A's board shows the quick check.
 *     - B presses Discard last → A's `kept` follows within 1.5 s of the server.
 *     - A presses B (E-stop, SIM agent only) → B's Arms cell shows the
 *       block why line "E-stop latched" and A's session buttons are dead;
 *       B resets the E-stop through the existing safety reset.
 *
 *   Needs a LIVE dev stack against a SIM robot (server + robot-agent + sim
 *   sidecar + app, the app a DEV build so `window.__neodemXr` /
 *   `window.__neodemVrUi` exist). It creates its own session:
 *     PLAYWRIGHT_LIVE_URL=http://localhost:1444 VR_ROBOT_ID=sim-robot-g1-edu \
 *       npx playwright test --config=playwright.live.config.ts two-person-session
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
    panelTitle?: string;
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

async function shot(page: Page, name: string, fullPage = false): Promise<void> {
  if (!SCREENS) return;
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SCREENS}/TASK-414-${name}.png`, fullPage });
}

const boardText = async (page: Page) =>
  (await page.evaluate(() => (window as DebugWindow).__neodemVrUi?.board ?? [])).join(' | ');

async function setButton(page: Page, side: Side, button: string, value: number): Promise<void> {
  await page.evaluate(([s, b, v]) => {
    (window as DebugWindow).__neodemXr!.getState().emulator!.controllers[s as Side].updateButtonValue(b as string, v as number);
  }, [side, button, value] as const);
}

/** Open the session's VR modal with the emulator wired up, and take control. */
async function openVrModal(page: Page, sessionId: string): Promise<void> {
  await page.goto(`/data-collection/${sessionId}?xremu`);
  await page.getByTestId('vr-launch').click();
  const modal = page.getByRole('dialog', { name: /VR teleop/i });
  await expect(modal.getByText(/Link (live|stale|lost)/)).toBeVisible({ timeout: 20_000 });
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

/** Point the right controller's ray at a button's centre (see vr-session-board.spec.ts). */
async function aimRightAt(page: Page, id: string): Promise<void> {
  await expect(async () => {
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
      const q = [y, -x, 0, 1 - z];
      const qn = Math.hypot(...q);
      const [qx, qy, qz, qw] = q.map((v) => v / qn) as [number, number, number, number];
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
    await page.waitForFunction((targetId) => (window as DebugWindow).__neodemVrUi?.rays.right.hitId === targetId, id, { timeout: 2_000 });
  }).toPass({ timeout: 15_000, intervals: [250, 500, 1_000] });
}

const clicksOf = (page: Page, id: string) =>
  page.evaluate((targetId) => (window as DebugWindow).__neodemVrUi!.clicks.filter((c) => c.id === targetId).length, id);

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

test('the desktop assistant and the Quest operator share one live session (TASK-414)', async ({ browser, request, baseURL }) => {
  test.skip(!/sim/i.test(ROBOT_ID), 'VR_ROBOT_ID must be a SIM robot');
  test.setTimeout(300_000);
  const base = baseURL!;

  // A recording vr_quest session, ready for take 1, with no latch left over.
  const created = await request.post(`${base}/api/teleoperation/sessions`, {
    data: { operatorId: 'live-check', robotId: ROBOT_ID, type: 'vr_quest', fps: 30, languageInstr: 'TASK-414 live check: two people' },
  });
  expect(created.ok()).toBeTruthy();
  const sessionId = ((await created.json()) as { session: { id: string } }).session.id;
  expect((await request.post(`${base}/api/teleoperation/sessions/${sessionId}/start`)).ok()).toBeTruthy();
  await request.post(`${base}/api/safety/robots/${ROBOT_ID}/estop/reset`);
  await expect.poll(async () => (await readLive(request, base, sessionId)).phase, { timeout: 15_000 }).toBe('between');

  const questCtx = await browser.newContext({ baseURL: base, viewport: { width: 1280, height: 800 } });
  const deskCtx = await browser.newContext({ baseURL: base, viewport: { width: 1440, height: 900 } });
  const quest = await questCtx.newPage();
  const desk = await deskCtx.newPage();
  // The desktop's app sockets: count the fast-channel frames each receives
  // (the page holds several — events, presence, lease observer — and every one
  // gets the tenant's telemetry, so the rate is the busiest socket's).
  const fastBySocket = new Map<object, number>();
  let lastOperator: unknown = null;
  desk.on('websocket', (ws) => {
    if (!ws.url().includes('/api/a2a/ws')) return;
    ws.on('framereceived', (f) => {
      if (typeof f.payload !== 'string') return;
      if (f.payload.includes('"robot_telemetry_fast"') && f.payload.includes(ROBOT_ID)) fastBySocket.set(ws, (fastBySocket.get(ws) ?? 0) + 1);
      if (f.payload.startsWith('{"type":"teleop:operator"')) lastOperator = JSON.parse(f.payload);
    });
  });

  try {
    // ---- B: the assistant layout, waiting for the headset -------------------
    await desk.goto(`/data-collection/${sessionId}`);
    // TASK-428: no headset yet — the Headset cell says so, and its popover holds the Quest controls.
    const headsetCell = desk.getByTestId('systems-cell-headset');
    await expect(headsetCell).toContainText('No headset', { timeout: 20_000 });
    await expect(desk.getByTestId('operator-card')).toHaveCount(0);
    await expect(desk.locator('[data-testid="presence-viewer"][data-role="assistant"]')).toBeVisible({ timeout: 15_000 });
    const twin = desk.getByTestId('robot-3d-viewer');
    await expect(twin).toHaveAttribute('data-robot-id', ROBOT_ID, { timeout: 20_000 });
    await expect(twin).toHaveAttribute('data-fast-channel', 'on');
    const fastBefore = new Map(fastBySocket);
    await desk.waitForTimeout(3_000);
    const fastHz = Math.max(0, ...[...fastBySocket].map(([ws, n]) => n - (fastBefore.get(ws) ?? 0))) / 3;
    test.info().annotations.push({ type: 'fast channel on the desktop', description: `${fastHz.toFixed(1)} Hz` });
    expect(fastHz).toBeGreaterThan(5);
    await shot(desk, 'desktop-waiting');

    // ---- A: the Quest opens the modal, takes control and enters VR -----------
    await openVrModal(quest, sessionId);
    // D5: behind the modal, no desktop twin and no camera tile.
    await expect(quest.getByTestId('session-twin')).toHaveCount(0);
    await expect(quest.getByTestId('session-lead-camera')).toHaveCount(0);
    await expect(quest.getByTestId('robot-3d-viewer')).toHaveCount(0);

    await enterVr(quest);
    const enteredAt = Date.now();
    await expect(desk.getByTestId('operator-status')).toContainText('In VR', { timeout: 2_000 });
    await expect(desk.locator('[data-testid="presence-viewer"][data-role="operator"]')).toBeVisible({ timeout: Math.max(100, 2_000 - (Date.now() - enteredAt)) });
    test.info().annotations.push({ type: 'In VR on the desktop after', description: `${Date.now() - enteredAt} ms` });
    // The read-only lease holder: A took control in the VR window (TASK-428: the Control cell names them).
    await expect(desk.getByTestId('systems-cell-control')).toHaveAttribute('data-status', 'ok', { timeout: 10_000 });
    await expect(desk.getByTestId('control-lease-holder')).not.toHaveText(/^(Nobody|You)$/);
    // The headset names the desktop watcher in its robot panel.
    await expect.poll(() => quest.evaluate(() => (window as DebugWindow).__neodemVrUi?.panelTitle ?? ''), { timeout: 10_000 })
      .toMatch(/WATCHING .+ \(desktop\)/);

    // Squeeze the right grip: the operator card shows it and the twin gets a ghost hand.
    await setButton(quest, 'right', 'squeeze', 1);
    await expect.poll(async () => Number(await desk.getByTestId('operator-grip-right').getAttribute('data-value')), { timeout: 5_000 })
      .toBeGreaterThan(90);
    await expect.poll(() => (lastOperator as { data?: { state?: { targets?: { right?: unknown } } } } | null)?.data?.state?.targets?.right ?? null, { timeout: 5_000 })
      .not.toBeNull();
    test.info().annotations.push({ type: 'relayed operator state', description: JSON.stringify(lastOperator) });
    await shot(desk, 'desktop-operator-in-vr');
    await shot(quest, 'quest-in-vr');
    await setButton(quest, 'right', 'squeeze', 0);

    // ---- A starts take 1 with the ray → B: ● REC Take 1, from the headset -----
    await expect.poll(() => boardText(quest), { timeout: 10_000 }).toContain('READY  Take 1 next');
    await press(quest, 'session-start');
    await expect(desk.getByTestId('hud-phase')).toHaveText('● REC', { timeout: 5_000 });
    await expect(desk.getByTestId('hud-take')).toHaveText('Take 1');
    await expect(desk.getByText(/Take 1 started from the headset/)).toBeVisible({ timeout: 5_000 });
    // Frames for the take: the grip streams poses.
    await setButton(quest, 'right', 'squeeze', 1);
    await quest.waitForTimeout(2_000);
    await shot(desk, 'desktop-recording');
    await setButton(quest, 'right', 'squeeze', 0);

    // ---- B stops it → A's board shows the quick check -------------------------
    await desk.getByTestId('take-primary').click();
    await expect.poll(async () => (await readLive(request, base, sessionId)).phase, { timeout: 10_000 }).toBe('between');
    await expect.poll(() => boardText(quest), { timeout: 5_000 }).toMatch(/Take 1 · \d+\.\d s · \d+ fr · /);
    await expect.poll(async () => (await readLive(request, base, sessionId)).kept, { timeout: 5_000 }).toBe(1);
    console.log(`[TASK-414] board after Stop: ${await boardText(quest)}`);
    await expect.poll(() => boardText(quest), { timeout: 5_000 }).toContain('kept 1 · discarded 0');

    // ---- B discards it → A's kept follows within 1.5 s ------------------------
    await desk.getByTestId('take-discard-last').click();
    // The desktop waits out its 5 s undo before it sends the discard.
    await expect.poll(async () => (await readLive(request, base, sessionId)).discarded, { timeout: 12_000, intervals: [100] }).toBe(1);
    const discardedAt = Date.now();
    await expect.poll(() => boardText(quest), { timeout: 1_500, intervals: [100] }).toContain('kept 0 · discarded 1');
    test.info().annotations.push({ type: 'kept on the headset after the discard', description: `${Date.now() - discardedAt} ms` });

    // ---- A presses B: E-stop → B's card blocks, A's session buttons are dead --
    await setButton(quest, 'right', 'b-button', 1);
    await expect(quest.getByRole('dialog', { name: /VR teleop/i }).getByText('E-stop latched')).toBeVisible({ timeout: 10_000 });
    await setButton(quest, 'right', 'b-button', 0);
    const why = desk.getByTestId('operator-why');
    await expect(why).toContainText('E-stop latched', { timeout: 5_000 });
    await expect(why).toHaveAttribute('data-severity', 'block');
    await quest.waitForFunction(
      () => (window as DebugWindow).__neodemVrUi!.targets().find((t) => t.id === 'reset-estop')?.live === true,
      null,
      { timeout: 5_000 },
    );
    const liveIds = await quest.evaluate(() => (window as DebugWindow).__neodemVrUi!.targets().filter((t) => t.live).map((t) => t.id));
    expect(liveIds).toEqual(['reset-estop']);
    await shot(desk, 'desktop-estop');

    // B resets it through the existing safety reset; both sides recover.
    const reset = await deskCtx.request.post(`${base}/api/safety/robots/${ROBOT_ID}/estop/reset`);
    expect(reset.ok()).toBeTruthy();
    await expect(why).not.toContainText('E-stop latched', { timeout: 10_000 });
    await quest.waitForFunction(
      () => (window as DebugWindow).__neodemVrUi!.targets().find((t) => t.id === 'session-start')?.live === true,
      null,
      { timeout: 10_000 },
    );
  } finally {
    await releaseControl(quest).catch(() => { /* the lease lapses on its TTL */ });
    await request.post(`${base}/api/safety/robots/${ROBOT_ID}/estop/reset`).catch(() => { /* best effort */ });
    await request.post(`${base}/api/teleoperation/sessions/${sessionId}/end`).catch(() => { /* best effort */ });
    await questCtx.close();
    await deskCtx.close();
  }
});
