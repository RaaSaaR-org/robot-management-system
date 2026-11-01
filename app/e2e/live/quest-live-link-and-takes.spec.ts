/**
 * @file quest-live-link-and-takes.spec.ts
 * @description TASK-416, live: the headset and the desktop always record into
 *   the same session, and a take is kept, discarded and labelled as meant.
 *     1. The stable link `/data-collection/live?robot=<id>` waits past a READY
 *        session older than 4 h and names it; a session the desktop creates
 *        is opened within 2.5 s; two fresh ones are listed, never guessed.
 *     2. Two contexts (A = emulated Quest via IWER `?xremu`, B = desktop):
 *        B discards take N, A starts take N+1 inside the 5 s undo window →
 *        take N is still discarded on the server, the desktop and the board,
 *        and is absent from the written dataset.
 *     3. A presses B (E-stop, SIM agent only) mid-take → board and desktop
 *        leave REC within 1 s, the take reads "stopped by the
 *        E-stop — discarded", it is not in the dataset, and the next take
 *        after the reset records normally.
 *
 *   Needs a LIVE stack against a SIM robot (server + robot-agent + sim + a DEV
 *   build of the app). Creates its own sessions:
 *     PLAYWRIGHT_LIVE_URL=http://localhost:1460 VR_ROBOT_ID=sim-robot-g1-edu \
 *       npx playwright test --config=playwright.live.config.ts quest-live-link-and-takes
 *   Never point it at a real robot: it records, raises and resets an E-stop.
 *   Set VR_SCREENSHOT_DIR to also save screenshots there.
 */
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

const ROBOT_ID = process.env.VR_ROBOT_ID ?? 'sim-robot-g1-edu';
const SCREENS = process.env.VR_SCREENSHOT_DIR;

/**
 * The emulated headset renders on the GPU. Headless Chromium defaults to the
 * SwiftShader software rasterizer, and with the desktop page rendering beside
 * it the headset page drops to ~2.5 frames a second — every button press then
 * waits a frame (~400 ms) to be seen and the board another to be redrawn, which
 * measures the rasterizer, not the product (a Quest renders at 72 Hz).
 * VR_SOFTWARE_GL=1 keeps the default.
 */
if (!process.env.VR_SOFTWARE_GL) test.use({ launchOptions: { args: ['--enable-gpu', '--use-angle=gl-egl'] } });

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
    board: string[];
  };
}

interface Live {
  phase: 'between' | 'capturing' | null;
  take: number | null;
  kept: number;
  discarded: number;
}

interface EpisodeRow {
  episodeIndex: number;
  discarded?: boolean;
  datasetEpisodeIndex?: number | null;
  stopReason?: string | null;
  frameCount?: number;
}

async function readLive(request: APIRequestContext, base: string, sessionId: string): Promise<Live> {
  const res = await request.get(`${base}/api/teleoperation/sessions/${sessionId}/live`);
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as Live | { live: Live };
  return 'live' in body ? body.live : body;
}

async function episodes(request: APIRequestContext, base: string, sessionId: string): Promise<EpisodeRow[]> {
  const res = await request.get(`${base}/api/teleoperation/sessions/${sessionId}/episodes?includeDiscarded=1`);
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as EpisodeRow[] | { episodes: EpisodeRow[] };
  return Array.isArray(body) ? body : body.episodes;
}

async function shot(page: Page, name: string, fullPage = false): Promise<void> {
  if (!SCREENS) return;
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SCREENS}/TASK-416-${name}.png`, fullPage });
}

const boardText = async (page: Page) =>
  (await page.evaluate(() => (window as DebugWindow).__neodemVrUi?.board ?? [])).join(' | ');

async function setButton(page: Page, side: Side, button: string, value: number): Promise<void> {
  await page.evaluate(([s, b, v]) => {
    (window as DebugWindow).__neodemXr!.getState().emulator!.controllers[s as Side].updateButtonValue(b as string, v as number);
  }, [side, button, value] as const);
}

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

/** Trigger on whatever the right ray already points at (aim first). */
async function pull(page: Page, id: string): Promise<void> {
  const before = await clicksOf(page, id);
  await setButton(page, 'right', 'trigger', 1);
  await expect.poll(() => clicksOf(page, id), { timeout: 8_000, intervals: [50] }).toBe(before + 1);
  await setButton(page, 'right', 'trigger', 0);
  await page.waitForTimeout(100);
}

async function press(page: Page, id: string): Promise<void> {
  await aimRightAt(page, id);
  await pull(page, id);
}

/** Squeeze the right grip for `ms`, so the take gets frames. */
async function drive(page: Page, ms: number): Promise<void> {
  await setButton(page, 'right', 'squeeze', 1);
  await page.waitForTimeout(ms);
  await setButton(page, 'right', 'squeeze', 0);
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

/**
 * The E-stop damps the base and its reset clears only the latch; the arms follow
 * only in Balance. Switch back the way an operator does on the VR modal's
 * desktop panel: Stand up, then Balance, each confirmed. The sidecar refuses a
 * mode change while the E-stop's arm disarm ramp still runs, so a refused
 * request is asked again. A sidecar without mode control has no panel, and one
 * that does not damp on an E-stop leaves Balance alone: nothing to do then.
 */
async function backToBalance(page: Page): Promise<void> {
  const modal = page.getByRole('dialog', { name: /VR teleop/i });
  const panel = modal.getByTestId('robot-mode-control');
  if ((await panel.count()) === 0) return;
  const readout = panel.getByTestId('robot-mode-readout');
  // The panel reads the mode once a second: wait for it to show the damp.
  await expect(readout).not.toHaveText(/^Balance/, { timeout: 5_000 }).catch(() => {});
  if (/^Balance/.test(await readout.innerText())) return;
  for (const [mode, shown] of [['stand', /^Stand/], ['balance', /^Balance/]] as const) {
    if (mode === 'stand' && /^Stand/.test(await readout.innerText())) continue;
    const button = panel.getByTestId(`robot-mode-${mode}`);
    await expect(async () => {
      await expect(button).toBeEnabled({ timeout: 5_000 });
      // The emulator's canvas lies over the desktop panel: click by event, not by pointer.
      await button.dispatchEvent('click');
      await page.getByTestId('robot-mode-confirm-confirm').dispatchEvent('click');
      await expect(readout).toHaveText(shown, { timeout: 4_000 });
    }).toPass({ timeout: 30_000, intervals: [1_000] }).catch(async (err: unknown) => {
      throw new Error(`${mode} did not take — the panel says: ${await panel.innerText().catch(() => '?')}\n${String(err)}`);
    });
  }
}

async function createSession(request: APIRequestContext, base: string, task: string): Promise<string> {
  const created = await request.post(`${base}/api/teleoperation/sessions`, {
    data: { operatorId: 'live-check', robotId: ROBOT_ID, type: 'vr_quest', fps: 30, languageInstr: task },
  });
  expect(created.ok()).toBeTruthy();
  return ((await created.json()) as { session: { id: string } }).session.id;
}

test('the Quest link waits past a stale READY session and never guesses between two (TASK-416)', async ({ page, request, baseURL }) => {
  test.skip(!/sim/i.test(ROBOT_ID), 'VR_ROBOT_ID must be a SIM robot');
  test.setTimeout(120_000);
  const base = baseURL!;
  const made: string[] = [];
  try {
    // Precondition: only READY sessions older than 4 h, or recording/paused ones idle for 12 h (TASK-452), exist for the robot.
    const listed = await request.get(`${base}/api/teleoperation/sessions?robotId=${ROBOT_ID}&status=created,recording,paused&limit=50`);
    const live = ((await listed.json()) as { sessions: Array<{ id: string; status: string; createdAt: string; updatedAt: string }> }).sessions;
    const isFresh = (s: { status: string; createdAt: string; updatedAt: string }) =>
      s.status === 'created' ? Date.now() - Date.parse(s.createdAt) < 4 * 3600_000 : Date.now() - Date.parse(s.updatedAt) < 12 * 3600_000;
    const fresh = live.filter(isFresh);
    expect(fresh, 'a fresh live session already exists for this robot').toEqual([]);
    const stale = live.filter((s) => !isFresh(s));
    test.info().annotations.push({ type: 'stale READY sessions', description: String(stale.length) });

    await page.goto(`/data-collection/live?robot=${ROBOT_ID}`);
    await expect(page.getByTestId('live-session-status')).toHaveText(`No live session for ${ROBOT_ID}. Waiting…`, { timeout: 10_000 });
    if (stale.length > 0) {
      const ignored = page.getByTestId('live-session-ignored');
      await expect(ignored).toContainText(/^Ignoring ‘.+’ \((created [^)]+, never started|(paused|recording), last active [^)]+)\)/);
      // Spelled out ("2 days ago"), never the table's "2d ago".
      await expect(ignored).not.toContainText(/\d[smhd] ago/);
    }
    await shot(page, 'live-link-waiting-stale');

    // The desktop creates a session: the headset page opens it within 2.5 s.
    const createdAt = Date.now();
    const first = await createSession(request, base, 'TASK-416 live link');
    made.push(first);
    await page.waitForURL(`**/data-collection/${first}`, { timeout: 2_500 });
    test.info().annotations.push({ type: 'redirect after create', description: `${Date.now() - createdAt} ms` });

    // Two fresh live sessions: a list, newest first, and no jump.
    const second = await createSession(request, base, 'TASK-416 second desk');
    made.push(second);
    await page.goto(`/data-collection/live?robot=${ROBOT_ID}`);
    await expect(page.getByTestId('live-session-status')).toHaveAttribute('data-state', 'choose', { timeout: 10_000 });
    const choices = page.getByTestId('live-session-choice');
    await expect(choices).toHaveCount(2);
    await expect(choices.nth(0)).toHaveAttribute('data-session-id', second);
    await expect(choices.nth(0)).toContainText('created');
    await page.waitForTimeout(2_500);
    expect(new URL(page.url()).pathname).toBe('/data-collection/live');
    await shot(page, 'live-link-choose');
    await choices.nth(1).click();
    await page.waitForURL(`**/data-collection/${first}`, { timeout: 5_000 });
  } finally {
    for (const id of made) await request.delete(`${base}/api/teleoperation/sessions/${id}`).catch(() => {});
  }
});

test('a discard survives the headset starting the next take, and an E-stop aborts and discards its take (TASK-416)', async ({ browser, request, baseURL }) => {
  test.skip(!/sim/i.test(ROBOT_ID), 'VR_ROBOT_ID must be a SIM robot');
  test.setTimeout(360_000);
  const base = baseURL!;

  const sessionId = await createSession(request, base, 'TASK-416 live check: discard race and E-stop');
  expect((await request.post(`${base}/api/teleoperation/sessions/${sessionId}/start`)).ok()).toBeTruthy();
  await request.post(`${base}/api/safety/robots/${ROBOT_ID}/estop/reset`);
  await expect.poll(async () => (await readLive(request, base, sessionId)).phase, { timeout: 15_000 }).toBe('between');

  const questCtx = await browser.newContext({ baseURL: base, viewport: { width: 1280, height: 800 } });
  const deskCtx = await browser.newContext({ baseURL: base, viewport: { width: 1440, height: 900 } });
  const quest = await questCtx.newPage();
  const desk = await deskCtx.newPage();
  let ended = false;

  try {
    await desk.goto(`/data-collection/${sessionId}`);
    await expect(desk.getByTestId('take-primary')).toBeVisible({ timeout: 20_000 });
    await openVrModal(quest, sessionId);
    await enterVr(quest);
    await expect.poll(() => boardText(quest), { timeout: 10_000 }).toContain('READY  Take 1 next');

    // ---- Take 1 (wire 0): A records and stops it -------------------------------
    await press(quest, 'session-start');
    await expect(desk.getByTestId('hud-phase')).toHaveText('● REC', { timeout: 5_000 });
    await drive(quest, 2_000);
    await press(quest, 'session-stop');
    await expect.poll(async () => (await readLive(request, base, sessionId)).kept, { timeout: 10_000 }).toBe(1);

    // ---- B discards take 1; A starts take 2 inside the undo window -------------
    await aimRightAt(quest, 'session-start');
    const clicksBefore = await clicksOf(quest, 'session-start');
    await desk.getByTestId('take-discard-last').click();
    const discardAskedAt = Date.now();
    await setButton(quest, 'right', 'trigger', 1);
    const triggeredAfter = Date.now() - discardAskedAt;
    await expect(desk.getByText('Discarding take 1…')).toBeVisible({ timeout: 2_000 });
    await expect.poll(() => clicksOf(quest, 'session-start'), { timeout: 8_000, intervals: [50] }).toBe(clicksBefore + 1);
    await setButton(quest, 'right', 'trigger', 0);
    await expect.poll(async () => (await readLive(request, base, sessionId)).phase, { timeout: 5_000, intervals: [50] }).toBe('capturing');
    const startedAfter = Date.now() - discardAskedAt;
    test.info().annotations.push({ type: 'A pulled / server started take 2 after B asked to discard take 1', description: `${triggeredAfter} / ${startedAfter} ms` });
    console.log(`[TASK-416] A pulled the trigger ${triggeredAfter} ms and the server had take 2 ${startedAfter} ms after B's discard`);
    expect(triggeredAfter).toBeLessThan(1_500);
    // Take 2 began inside B's 5 s undo window — the race this task closes.
    expect(startedAfter).toBeLessThan(4_500);
    await expect.poll(async () => (await readLive(request, base, sessionId)).take, { timeout: 5_000 }).toBe(1);
    await setButton(quest, 'right', 'squeeze', 1);
    // The undo window closes 5 s after B's press: take 1 goes, take 2 keeps recording.
    await expect.poll(async () => (await readLive(request, base, sessionId)).discarded, { timeout: 9_000, intervals: [100] }).toBe(1);
    const live2 = await readLive(request, base, sessionId);
    expect(live2).toMatchObject({ phase: 'capturing', take: 1, discarded: 1 });
    await expect(desk.getByText('You discarded take 1')).toBeVisible({ timeout: 3_000 });
    await expect(desk.getByText(/was NOT discarded/)).toHaveCount(0);
    await expect.poll(() => boardText(quest), { timeout: 2_000 }).toContain('discarded 1');
    await shot(desk, 'discard-race-desktop');
    await setButton(quest, 'right', 'squeeze', 0);
    await press(quest, 'session-stop');
    await expect.poll(async () => (await readLive(request, base, sessionId)).kept, { timeout: 10_000 }).toBe(1);
    const afterRace = await episodes(request, base, sessionId);
    expect(afterRace.find((e) => e.episodeIndex === 0)?.discarded).toBe(true);
    expect(afterRace.find((e) => e.episodeIndex === 1)?.discarded ?? false).toBe(false);

    // ---- Take 3 (wire 2): A presses B (E-stop) mid-take -----------------------
    await press(quest, 'session-start');
    await expect(desk.getByTestId('hud-phase')).toHaveText('● REC', { timeout: 5_000 });
    await drive(quest, 1_500);
    await setButton(quest, 'right', 'b-button', 1);
    const estopAt = Date.now();
    // Held for a few frames, as a thumb does: a press and release inside one
    // frame is never seen by the headset.
    await quest.waitForTimeout(80);
    await setButton(quest, 'right', 'b-button', 0);
    // Three views, watched at once: the server's live state, the desktop HUD, the headset board.
    const since = async (until: Promise<unknown>) => { await until; return Date.now() - estopAt; };
    const [serverMs, deskMs, boardMs] = await Promise.all([
      since(expect.poll(async () => (await readLive(request, base, sessionId)).phase, { timeout: 3_000, intervals: [50] }).toBe('between')),
      since(expect(desk.getByTestId('hud-phase')).not.toHaveText('● REC', { timeout: 3_000 })),
      since(expect.poll(() => boardText(quest), { timeout: 3_000, intervals: [50] }).not.toContain('● REC')),
    ]);
    test.info().annotations.push({ type: 'left REC after the E-stop (server / desktop / board)', description: `${serverMs} / ${deskMs} / ${boardMs} ms` });
    console.log(`[TASK-416] left REC after the E-stop: server ${serverMs} ms, desktop ${deskMs} ms, board ${boardMs} ms`);
    // The acceptance criterion: board and desktop leave REC within 1 s of B.
    expect(deskMs, 'the desktop left REC within 1 s of the E-stop').toBeLessThan(1_000);
    // On the software rasterizer the headset's own frames (~400 ms each) are the bound, not the product.
    if (!process.env.VR_SOFTWARE_GL) expect(boardMs, 'the headset board left REC within 1 s of the E-stop').toBeLessThan(1_000);
    await expect(desk.getByText('Take 3 stopped by the E-stop — discarded').first()).toBeVisible({ timeout: 3_000 });
    await expect.poll(() => boardText(quest), { timeout: 3_000 }).toContain('Take 3 stopped by the E-stop — discarded');
    await expect(desk.getByTestId('quick-check-verdict')).toHaveText('Take 3 stopped by the E-stop — discarded');
    await shot(desk, 'estop-desktop');
    console.log(`[TASK-416] board after the E-stop: ${await boardText(quest)}`);
    const afterEstop = await episodes(request, base, sessionId);
    expect(afterEstop.find((e) => e.episodeIndex === 2)).toMatchObject({ discarded: true, stopReason: 'estop' });
    expect((await readLive(request, base, sessionId)).discarded).toBe(2);

    // ---- Reset; take 4 records normally --------------------------------------
    expect((await deskCtx.request.post(`${base}/api/safety/robots/${ROBOT_ID}/estop/reset`)).ok()).toBeTruthy();
    await backToBalance(quest);
    await quest.waitForFunction(
      () => (window as DebugWindow).__neodemVrUi!.targets().find((t) => t.id === 'session-start')?.live === true,
      null,
      { timeout: 10_000 },
    );
    await press(quest, 'session-start');
    await expect.poll(async () => (await readLive(request, base, sessionId)).take, { timeout: 5_000 }).toBe(3);
    await drive(quest, 2_000);
    await press(quest, 'session-stop');
    await expect.poll(async () => (await readLive(request, base, sessionId)).kept, { timeout: 10_000 }).toBe(2);

    // ---- End: only takes 2 and 4 are in the dataset ---------------------------
    await releaseControl(quest).catch(() => {});
    expect((await request.post(`${base}/api/teleoperation/sessions/${sessionId}/end`)).ok()).toBeTruthy();
    ended = true;
    await expect.poll(async () => {
      const rows = await episodes(request, base, sessionId);
      return rows.map((e) => [e.episodeIndex, e.discarded === true, e.datasetEpisodeIndex ?? null]);
    }, { timeout: 60_000, intervals: [1_000] }).toEqual([
      [0, true, null],
      [1, false, 0],
      [2, true, null],
      [3, false, 1],
    ]);
    const session = await (await request.get(`${base}/api/teleoperation/sessions/${sessionId}`)).json();
    console.log(`[TASK-416] ended session: ${JSON.stringify(session).slice(0, 600)}`);
  } finally {
    await releaseControl(quest).catch(() => {});
    await request.post(`${base}/api/safety/robots/${ROBOT_ID}/estop/reset`).catch(() => {});
    if (!ended) await request.post(`${base}/api/teleoperation/sessions/${sessionId}/end`).catch(() => {});
    await questCtx.close();
    await deskCtx.close();
  }
});
