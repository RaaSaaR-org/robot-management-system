/**
 * @file vr-estop-recovery.spec.ts
 * @description TASK-417, live: the operator recovers from an E-stop without
 *   leaving VR. Context A is the Quest (IWER, `?xremu`), holding the lease in
 *   VR; context B is the desktop assistant on the same session page.
 *     - B asks the headset for Stand up and A ignores it: the prompt shows in
 *       VR, expires after 10 s, and B's card says so.
 *     - A latches the E-stop with B. A request sent while it is latched never
 *       shows in VR (the headset declines it at once).
 *     - A holds "Hold 1 s to reset"; B asks for Stand up, A holds "Hold to allow
 *       Stand up"; the same for Balance; A re-squeezes and the arm follows —
 *       all without A leaving VR. The time from B's first ask to the arm
 *       following is recorded (target under 15 s).
 *
 *   Needs a LIVE dev stack against a SIM robot whose sidecar runs
 *   `G1_LOCO_ENABLED=fsm` (the Robot mode card shows only then): server +
 *   robot-agent + g1_sidecar.py (arm_sdk) + sim_g1_dds + app (DEV build):
 *     PLAYWRIGHT_LIVE_URL=http://localhost:1461 VR_ROBOT_ID=sim-task417-g1 \
 *       VR_SIDECAR_URL=http://127.0.0.1:8861 VR_QUEST_VIEWPORT=2064x1500 \
 *       npx playwright test --config=playwright.live.config.ts vr-estop-recovery
 *   Never point it at a real robot: it latches an E-stop and changes the robot
 *   mode (limp → stand → balance).
 *   Set VR_SCREENSHOT_DIR to also save screenshots there.
 */
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

const ROBOT_ID = process.env.VR_ROBOT_ID ?? 'sim-robot-g1-edu';
const SIDECAR = process.env.VR_SIDECAR_URL ?? null;
const SCREENS = process.env.VR_SCREENSHOT_DIR;
/** The Quest page's size: `2064x2208` for the PR screenshots (one Quest 3 eye), smaller to time the flow. */
const [QUEST_W, QUEST_H] = (process.env.VR_QUEST_VIEWPORT ?? '1280x800').split('x').map(Number) as [number, number];

type Vec3 = [number, number, number];
type Side = 'left' | 'right';

interface Quat { set: (x: number, y: number, z: number, w: number) => void }
interface DebugWindow {
  __neodemXr?: {
    enterVR: () => Promise<unknown>;
    getState: () => {
      session: unknown;
      emulator?: {
        quaternion: Quat;
        controllers: Record<Side, { quaternion: Quat; updateButtonValue: (id: string, value: number) => void }>;
      };
    };
  };
  __neodemVrUi?: {
    clicks: Array<{ id: string; at: number }>;
    rays: Record<Side, { visible: boolean; active: boolean; hitId: string | null; origin: Vec3 | null }>;
    targets: () => Array<{ id: string; live: boolean; center: Vec3 | null }>;
    panel: string[];
    panelTitle?: string;
  };
  __task417Replies?: Array<{ kind: string; outcome?: string; error?: string }>;
}

async function readLive(request: APIRequestContext, baseURL: string, sessionId: string): Promise<{ phase: string | null }> {
  const res = await request.get(`${baseURL}/api/teleoperation/sessions/${sessionId}/live`);
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { phase: string | null } | { live: { phase: string | null } };
  return 'live' in body ? body.live : body;
}

const panelOf = (page: Page) => page.evaluate(() => (window as DebugWindow).__neodemVrUi?.panel ?? []);

async function setButton(page: Page, side: Side, button: string, value: number): Promise<void> {
  await page.evaluate(([s, b, v]) => {
    (window as DebugWindow).__neodemXr!.getState().emulator!.controllers[s as Side].updateButtonValue(b as string, v as number);
  }, [side, button, value] as const);
}

async function shot(page: Page, name: string): Promise<void> {
  if (!SCREENS) return;
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SCREENS}/TASK-417-${name}.png` });
}

/**
 * The robot panel as the operator sees it. IWER's DevUI owns the head pose (a
 * quaternion set from the test is reset next frame), so the panel 40° right is
 * brought into view by a wide viewport instead (`VR_QUEST_VIEWPORT`), and the
 * right part of the scene canvas is saved as well as the whole page.
 */
async function panelShot(page: Page, name: string): Promise<void> {
  if (!SCREENS) return;
  await shot(page, name);
  // The scene canvas: the largest one that is not the DevUI's full-page overlay.
  const box = await page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const rects = [...document.querySelectorAll('canvas')]
      .map((c) => c.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0 && !(r.width >= vw - 1 && r.height >= vh - 1))
      .sort((a, b) => b.width * b.height - a.width * a.height);
    const r = rects[0];
    return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
  });
  if (box) {
    await page.screenshot({
      path: `${SCREENS}/TASK-417-${name}-crop.png`,
      clip: { x: box.x + box.width * 0.55, y: box.y, width: box.width * 0.45, height: box.height },
    });
  }
}

async function openVrModal(page: Page, sessionId: string): Promise<void> {
  await page.goto(`/data-collection/${sessionId}?xremu`);
  await page.getByTestId('vr-launch').click();
  const modal = page.getByRole('dialog', { name: /VR teleop/i });
  await expect(modal.getByText(/Link (live|stale|lost)/)).toBeVisible({ timeout: 20_000 });
  const take = modal.getByRole('button', { name: /^Take control$/ });
  const release = modal.getByRole('button', { name: /^Release control$/ });
  // TASK-417: before control, the readiness line names the next step.
  if (await take.isVisible().catch(() => false)) {
    const line = modal.getByTestId('readiness-reason');
    await expect(line).not.toHaveAttribute('data-severity', 'unknown', { timeout: 15_000 });
    test.info().annotations.push({
      type: 'VR window readiness line before control',
      description: `${await line.getAttribute('data-severity')}: ${await line.innerText()}`,
    });
    if ((await line.getAttribute('data-code')) === 'page_step') await expect(line).toContainText('Take control, then Enter VR.');
    await shot(page, 'modal-before-control');
  }
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
    () => (window as DebugWindow).__neodemVrUi?.targets().some((t) => t.id === 'recenter' && t.center !== null),
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
    await page.waitForFunction((targetId) => (window as DebugWindow).__neodemVrUi?.rays.right.hitId === targetId, id, { timeout: 1_000, polling: 50 });
  }).toPass({ timeout: 15_000, intervals: [100, 250, 500] });
}

const clicksOf = (page: Page, id: string) =>
  page.evaluate((targetId) => (window as DebugWindow).__neodemVrUi!.clicks.filter((c) => c.id === targetId).length, id);

/** Ray-press a button, holding the trigger until it registers (hold buttons need 1 s). */
async function press(page: Page, id: string): Promise<void> {
  const t = Date.now();
  // A visible, live target first: aiming at one that is not there yet only burns retries.
  await page.waitForFunction(
    (targetId) => (window as DebugWindow).__neodemVrUi?.targets().find((t) => t.id === targetId)?.live === true,
    id,
    { timeout: 10_000, polling: 50 },
  );
  const tLive = Date.now();
  await aimRightAt(page, id);
  const tAim = Date.now();
  const before = await clicksOf(page, id);
  await setButton(page, 'right', 'trigger', 1);
  await expect.poll(() => clicksOf(page, id), { timeout: 8_000, intervals: [50] }).toBe(before + 1);
  const tClick = Date.now();
  await setButton(page, 'right', 'trigger', 0);
  console.log(`[TASK-417] press ${id}: live ${tLive - t} ms, aim ${tAim - tLive} ms, hold→click ${tClick - tAim} ms`);
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

/** B asks through the card: click the button, confirm. */
async function askFromDesk(desk: Page, mode: 'stand' | 'balance', label: string, onAskEnabled?: () => void): Promise<void> {
  const button = desk.getByTestId(`robot-mode-${mode}`);
  await expect(button).toHaveText(`Ask the headset: ${label}`, { timeout: 15_000 });
  await expect(button).toBeEnabled({ timeout: 15_000 });
  onAskEnabled?.();
  const t = Date.now();
  // force: the actionability wait alone costs ~2 s per click on a loaded box; enabled is checked above.
  await button.click({ force: true });
  const tClick = Date.now();
  await expect(desk.getByText(/The operator confirms in the headset\./)).toBeVisible();
  const tDialog = Date.now();
  await desk.getByTestId('robot-mode-confirm-confirm').click({ force: true });
  const tConfirm = Date.now();
  await expect(desk.getByTestId('robot-mode-asking')).toContainText('Waiting for the operator…');
  console.log(`[TASK-417] ask ${mode}: click ${tClick - t} ms, dialog ${tDialog - tClick} ms, confirm ${tConfirm - tDialog} ms, waiting ${Date.now() - tConfirm} ms`);
}

test('the operator recovers from an E-stop without leaving VR (TASK-417)', async ({ browser, request, baseURL }) => {
  test.skip(!/sim/i.test(ROBOT_ID), 'VR_ROBOT_ID must be a SIM robot');
  test.setTimeout(300_000);
  const base = baseURL!;

  // The robot starts limp (a sim powers on damped); no latch left over.
  const mode0 = await request.get(`${base}/api/robots/${ROBOT_ID}/base-mode`);
  expect(mode0.ok()).toBeTruthy();
  const status0 = (await mode0.json()) as { capability: { gate: string }; base: { mode: string } | null };
  expect(status0.capability.gate).toBe('fsm');
  expect(status0.base?.mode).toBe('limp');

  const created = await request.post(`${base}/api/teleoperation/sessions`, {
    data: { operatorId: 'live-check', robotId: ROBOT_ID, type: 'vr_quest', fps: 30, languageInstr: 'TASK-417 live check: E-stop recovery' },
  });
  expect(created.ok()).toBeTruthy();
  const sessionId = ((await created.json()) as { session: { id: string } }).session.id;
  expect((await request.post(`${base}/api/teleoperation/sessions/${sessionId}/start`)).ok()).toBeTruthy();
  await request.post(`${base}/api/safety/robots/${ROBOT_ID}/estop/reset`);
  await expect.poll(async () => (await readLive(request, base, sessionId)).phase, { timeout: 15_000 }).toBe('between');

  const questCtx = await browser.newContext({ baseURL: base, viewport: { width: QUEST_W, height: QUEST_H } });
  const deskCtx = await browser.newContext({ baseURL: base, viewport: { width: 1440, height: 900 } });
  const quest = await questCtx.newPage();
  const desk = await deskCtx.newPage();

  try {
    await desk.goto(`/data-collection/${sessionId}`);
    const card = desk.getByTestId('session-robot-mode');
    await expect(card).toBeVisible({ timeout: 30_000 });

    await openVrModal(quest, sessionId);
    await enterVr(quest);
    await expect(desk.getByTestId('operator-status')).toContainText('In VR', { timeout: 5_000 });
    // TASK-428: the Control cell names the holder (the operator, in the VR window).
    await expect(desk.getByTestId('systems-cell-control')).toHaveAttribute('data-status', 'ok', { timeout: 10_000 });
    await expect(desk.getByTestId('control-lease-holder')).not.toHaveText(/^(Nobody|You)$/);

    // The panel leads with the why line; the sim robot is limp.
    await expect.poll(async () => (await panelOf(quest))[0] ?? '', { timeout: 10_000 })
      .toBe('Robot limp — the desktop asks for Stand up, then Balance.');
    const before = await panelOf(quest);
    test.info().annotations.push({ type: 'robot panel (limp)', description: before.join(' | ') });
    expect(before.join(' ')).not.toMatch(/MODE unknown|no arming needed|LINK live \d+ ms|ik_held/);
    await panelShot(quest, 'panel-limp');
    await shot(desk, 'desk-ask-enabled');

    // ---- 1. A request A ignores expires after 10 s, and B's card says so ----
    await askFromDesk(desk, 'stand', 'Stand up');
    await expect.poll(async () => (await panelOf(quest)).join(' | '), { timeout: 5_000 }).toContain('DESKTOP ASKS: Stand up');
    await quest.waitForFunction(
      () => (window as DebugWindow).__neodemVrUi!.targets().find((t) => t.id === 'allow-mode')?.live === true,
      null,
      { timeout: 5_000 },
    );
    await panelShot(quest, 'panel-prompt');
    await shot(desk, 'desk-waiting');
    const answer = desk.getByTestId('robot-mode-answer');
    await expect(answer).toHaveAttribute('data-outcome', 'expired', { timeout: 14_000 });
    await expect(answer).toHaveText('The operator did not answer within 10 s.');
    expect((await panelOf(quest)).join(' ')).not.toContain('DESKTOP ASKS');
    await shot(desk, 'desk-expired');

    // ---- 2. A latches the E-stop with B -------------------------------------
    await desk.waitForTimeout(2_100); // the relay's 2 s per-session rate limit
    await setButton(quest, 'right', 'b-button', 1);
    await expect(quest.getByRole('dialog', { name: /VR teleop/i }).getByText('E-stop latched')).toBeVisible({ timeout: 10_000 });
    await setButton(quest, 'right', 'b-button', 0);
    await expect.poll(async () => (await panelOf(quest))[0] ?? '', { timeout: 5_000 })
      .toBe('E-stop latched — hold Reset for 1 s. Then the desktop asks for Balance.');
    await panelShot(quest, 'panel-estop');
    // B's ask is disabled, with the reason.
    await expect(desk.getByTestId('robot-mode-stand')).toBeDisabled({ timeout: 5_000 });
    await expect(desk.getByTestId('robot-mode-reasons')).toContainText('Reset the E-stop first.');
    // A request that reaches the headset anyway is declined there, never shown.
    await desk.evaluate(async (sid) => {
      const w = window as DebugWindow;
      w.__task417Replies = [];
      // Through vite, as the page itself loads it (indirect eval keeps the
      // bundler-free browser import out of Playwright's transpile).
      const mod = (await (0, eval)("import('/src/shared/utils/sessionWatch.ts')")) as typeof import('../../src/shared/utils/sessionWatch');
      await new Promise<void>((resolve) => {
        const watch = mod.openSessionWatch({
          sessionId: sid,
          role: 'assistant',
          onWatched: () => {
            watch.sendModeRequest('stand', `raw-${Date.now()}`);
            resolve();
          },
          onModeReply: (r) => { w.__task417Replies!.push(r as never); watch.close(); },
        });
      });
    }, sessionId);
    await expect.poll(() => desk.evaluate(() => (window as DebugWindow).__task417Replies ?? []), { timeout: 5_000 })
      .toEqual([expect.objectContaining({ kind: 'answer', outcome: 'declined', error: 'the E-stop is latched in the headset' })]);
    expect((await panelOf(quest)).join(' ')).not.toContain('DESKTOP ASKS');
    const liveIds = await quest.evaluate(() => (window as DebugWindow).__neodemVrUi!.targets().filter((t) => t.live).map((t) => t.id));
    expect(liveIds).toEqual(['reset-estop']);

    // ---- 3. The recovery, timed: Reset → Stand up → Balance → the arm follows
    await desk.waitForTimeout(2_100);
    const t0 = Date.now();
    const marks: string[] = [];
    const mark = (what: string) => marks.push(`${((Date.now() - t0) / 1000).toFixed(1)} s ${what}`);
    await press(quest, 'reset-estop');
    mark("press(quest, 'reset-estop');");
    await askFromDesk(desk, 'stand', 'Stand up', () => mark('desk: Ask Stand up enabled'));
    mark("askFromDesk(desk, 'stand', 'Stand up');");
    await expect.poll(async () => (await panelOf(quest)).join(' | '), { timeout: 5_000 }).toContain('DESKTOP ASKS: Stand up');
    mark('expect.poll(async () => (await panelOf(q');
    await press(quest, 'allow-mode');
    mark("press(quest, 'allow-mode');");
    await expect(desk.getByTestId('robot-mode-answer')).toHaveAttribute('data-outcome', 'allowed', { timeout: 15_000 });
    mark("expect(desk.getByTestId('robot-mode-answ");
    await expect(desk.getByTestId('robot-mode-readout')).toHaveText('Stand (locked)', { timeout: 10_000 });
    mark("expect(desk.getByTestId('robot-mode-read");
    const tStand = Date.now();
    await shot(desk, 'desk-stand-allowed');

    await askFromDesk(desk, 'balance', 'Balance', () => mark('desk: Ask Balance enabled'));
    mark("askFromDesk(desk, 'balance', 'Balance');");
    await expect.poll(async () => (await panelOf(quest)).join(' | '), { timeout: 5_000 }).toContain('DESKTOP ASKS: Balance');
    mark('expect.poll(async () => (await panelOf(q');
    await press(quest, 'allow-mode');
    mark("press(quest, 'allow-mode');");
    await expect(desk.getByTestId('robot-mode-answer')).toHaveAttribute('data-outcome', 'allowed', { timeout: 15_000 });
    mark("expect(desk.getByTestId('robot-mode-answ");
    await expect(desk.getByTestId('robot-mode-readout')).toHaveText('Balance', { timeout: 10_000 });
    mark("expect(desk.getByTestId('robot-mode-read");
    const tBalance = Date.now();

    // A re-squeezes (release → squeeze) and the arm follows.
    await setButton(quest, 'right', 'squeeze', 0);
    mark("setButton(quest, 'right', 'squeeze', 0);");
    await quest.waitForTimeout(300);
    mark('quest.waitForTimeout(300);');
    await setButton(quest, 'right', 'squeeze', 1);
    mark("setButton(quest, 'right', 'squeeze', 1);");
    await expect.poll(async () => (await panelOf(quest))[0] ?? '', { timeout: 15_000, intervals: [100] }).toBe('Following.');
    mark('expect.poll(async () => (await panelOf(q');
    if (SIDECAR) {
      await expect.poll(async () => {
        const res = await request.get(`${SIDECAR}/health`);
        return ((await res.json()) as { armed?: boolean }).armed === true;
      }, { timeout: 10_000, intervals: [200] }).toBe(true);
    }
    const total = Date.now() - t0;
    test.info().annotations.push({
      type: 'recovery time (script)',
      description: `${(total / 1000).toFixed(1)} s total — Stand up at ${((tStand - t0) / 1000).toFixed(1)} s, `
        + `Balance at ${((tBalance - t0) / 1000).toFixed(1)} s`,
    });
    console.log(marks.join('\n'));
    console.log(`[TASK-417] recovery ${(total / 1000).toFixed(1)} s (stand ${((tStand - t0) / 1000).toFixed(1)} s, balance ${((tBalance - t0) / 1000).toFixed(1)} s)`);
    // A never left VR.
    expect(await quest.evaluate(() => Boolean((window as DebugWindow).__neodemXr!.getState().session))).toBe(true);
    await panelShot(quest, 'panel-following');
    await shot(desk, 'desk-balance');
    // The AC's target is 15 s of script time; it is recorded, not asserted —
    // on a shared box the harness (ray aiming, Playwright actionability) can
    // dominate. The product's own latencies are in `marks`.
    test.info().annotations.push({ type: 'recovery steps', description: marks.join(' | ') });
    expect(total).toBeLessThan(60_000);
    await setButton(quest, 'right', 'squeeze', 0);
  } finally {
    await setButton(quest, 'right', 'squeeze', 0).catch(() => {});
    // Leave the sim limp for the next run: the E-stop disarms and damps.
    await setButton(quest, 'right', 'b-button', 1).catch(() => {});
    await quest.waitForTimeout(1_500).catch(() => {});
    await setButton(quest, 'right', 'b-button', 0).catch(() => {});
    await releaseControl(quest).catch(() => { /* the lease lapses on its TTL */ });
    await request.post(`${base}/api/safety/robots/${ROBOT_ID}/estop/reset`).catch(() => { /* best effort */ });
    await request.post(`${base}/api/teleoperation/sessions/${sessionId}/end`).catch(() => { /* best effort */ });
    await questCtx.close();
    await deskCtx.close();
  }
});
