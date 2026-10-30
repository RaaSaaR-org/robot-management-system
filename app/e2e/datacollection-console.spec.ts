/**
 * @file datacollection-console.spec.ts
 * @description The data-collection session page as a live console (TASK-425),
 *   on the demo build with MSW. TASK-426 — the command bar and its E-STOP:
 *   - exactly one E-STOP, in view at every scroll position (1512 and 390, all
 *     three phases), one press, no dialog, and Escape twice;
 *   - the E-STOP alone in its zone, ≥ 65 px from every other bar control at
 *     640, 1280, 1512 and 1920, with Testing tools open as well;
 *   - from 640 to 1500 px (a tablet with the sidebar included) the E-STOP lies
 *     whole inside the bar and the viewport, and nothing overlaps: the left
 *     group moves into ⋯ and the identity wraps before anything is clipped;
 *   - the stuck bar 32 px under the TopBar, every TopBar control ≥ 48 px from
 *     the E-STOP;
 *   - on a phone the zone is a bottom dock holding only the E-STOP, the ⋯ menu
 *     holds End session, Testing tools and the mute, and an open Testing tools
 *     popover ends above the dock and never covers the E-STOP;
 *   - Testing tools reaches every developer tool in one click;
 *   - a Quest user agent leads with the headset hero and Launch VR.
 *   TASK-427/428/429 add their phases' blocks here.
 *   Set SCREEN_DIR to also save screenshots there.
 * @feature datacollection
 */
import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

const shot = (name: string) => (process.env.SCREEN_DIR ? { path: path.join(process.env.SCREEN_DIR, name) } : {});
const TAKES = './#/data-collection/demo-session-takes';
const ROBOT = 'demo-g1-001';
const QUEST_UA =
  'Mozilla/5.0 (X11; Linux x86_64; Quest 3) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/35.2.0.4.43 SamsungBrowser/4.0 Chrome/126.0.0.0 VR Safari/537.36';

type Phase = 'setup' | 'record' | 'wrap';

/** Set up: a created VR session on the demo G1 (MSW keeps it in this page's memory). */
async function openSetup(page: Page): Promise<void> {
  await page.goto('./#/data-collection');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const id = await page.evaluate(async (robotId) => {
    const res = await fetch('/api/teleoperation/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ robotId, type: 'vr_quest', operatorId: 'demo-user', languageInstr: 'Pick up the apple and place it on the plate' }),
    });
    return ((await res.json()) as { session: { id: string } }).session.id;
  }, ROBOT);
  await page.evaluate((sid) => { window.location.hash = `#/data-collection/${sid}`; }, id);
  await expect(page.locator('[data-testid="session-command-bar"][data-phase="setup"]')).toBeVisible();
}

async function openRecord(page: Page): Promise<void> {
  await page.goto(TAKES);
  await expect(page.getByTestId('hud-phase')).toHaveText('READY');
}

/** Wrap up: the demo takes session, ended through the bar's End session (its confirm). */
async function openWrap(page: Page): Promise<void> {
  await openRecord(page);
  const end = page.getByTestId('session-end');
  if (await end.isVisible()) await end.click();
  else {
    await page.getByTestId('session-more').click();
    await page.getByTestId('session-more-end').click();
  }
  await page.getByRole('alertdialog').getByRole('button', { name: /^End session$/ }).click();
  await expect(page.locator('[data-testid="session-command-bar"][data-phase="wrap"]')).toBeVisible();
}

const OPEN: Record<Phase, (page: Page) => Promise<void>> = { setup: openSetup, record: openRecord, wrap: openWrap };

async function openTools(page: Page): Promise<void> {
  const toggle = page.getByTestId('session-tools-toggle');
  if (await toggle.isVisible()) await toggle.click();
  else {
    await page.getByTestId('session-more').click();
    await page.getByTestId('session-more-tools').click();
  }
  await expect(page.getByTestId('session-tools')).toBeVisible();
}

interface Clearance {
  /** Smallest rectangle distance from the E-STOP to another control in the bar (or the open Testing tools). */
  bar: { d: number; el: string } | null;
  /** Controls inside the E-STOP's zone other than the E-STOP. */
  zoneOthers: number;
}

/** The rectangle-to-rectangle distance model of the mockup's estop-gap probe. */
async function clearance(page: Page): Promise<Clearance> {
  return page.evaluate(() => {
    const estop = document.querySelector('[data-testid="session-estop"]') as HTMLElement;
    const zone = document.querySelector('[data-testid="estop-zone"]') as HTMLElement;
    const bar = document.querySelector('[data-testid="session-command-bar"]') as HTMLElement;
    const tools = document.querySelector('[data-testid="session-tools"]') as HTMLElement | null;
    const E = estop.getBoundingClientRect();
    const sel = 'a[href], button, [role="switch"], [role="menuitem"], input, select, textarea';
    const visible = (el: Element) => {
      if (!(el as HTMLElement).getClientRects().length) return false;
      for (let p: Element | null = el; p; p = p.parentElement) {
        const s = getComputedStyle(p);
        if (s.display === 'none' || s.visibility === 'hidden') return false;
      }
      return true;
    };
    const label = (el: Element) =>
      (el.getAttribute('data-testid') || el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    let best: { d: number; el: string } | null = null;
    for (const el of document.querySelectorAll(sel)) {
      if (el === estop || !visible(el)) continue;
      if (!bar.contains(el) && !(tools && tools.contains(el))) continue;
      const r = el.getBoundingClientRect();
      const dx = Math.max(0, E.left - r.right, r.left - E.right);
      const dy = Math.max(0, E.top - r.bottom, r.top - E.bottom);
      const d = Math.round(Math.hypot(dx, dy) * 10) / 10;
      if (!best || d < best.d) best = { d, el: label(el) };
    }
    const zoneOthers = [...zone.querySelectorAll(sel)].filter((el) => el !== estop).length;
    return { bar: best, zoneOthers };
  });
}

/** The E-STOP's box lies inside the viewport at every scroll position, in 200 px steps. */
async function sweep(page: Page): Promise<void> {
  const { sh, ih } = await page.evaluate(() => ({ sh: document.documentElement.scrollHeight, ih: window.innerHeight }));
  for (let y = 0; y <= Math.max(0, sh - ih) + 200; y += 200) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(30);
    const box = await page.getByTestId('session-estop').boundingBox();
    const vp = page.viewportSize()!;
    expect(box, `E-STOP box at scroll ${y}`).not.toBeNull();
    expect(box!.y, `E-STOP top at scroll ${y}`).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height, `E-STOP bottom at scroll ${y}`).toBeLessThanOrEqual(vp.height);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(vp.width);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
}

for (const [w, h] of [[1512, 945], [390, 844]] as const) {
  for (const phase of ['setup', 'record', 'wrap'] as const) {
    test(`one E-STOP, in view at every scroll position — ${phase} at ${w}×${h}`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.setViewportSize({ width: w, height: h });
      await OPEN[phase](page);
      await expect(page.getByTestId('session-estop')).toHaveCount(1);
      // No ControlLeaseBar on this page draws a second one.
      await expect(page.getByRole('button', { name: /emergency stop/i })).toHaveCount(1);
      await sweep(page);
      await page.screenshot({ ...shot(`TASK-426-${phase}-${w}.png`) });
      expect(errors).toEqual([]);
    });
  }
}

for (const [w, h] of [[640, 800], [1280, 800], [1512, 945], [1920, 1080]] as const) {
  for (const phase of ['setup', 'record'] as const) {
    test(`the E-STOP stands alone in the bar — ${phase} at ${w}, Testing tools closed and open`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await OPEN[phase](page);
      const closed = await clearance(page);
      expect(closed.zoneOthers).toBe(0);
      expect(closed.bar, 'some other bar control').not.toBeNull();
      expect(closed.bar!.d, `nearest: ${closed.bar!.el}`).toBeGreaterThanOrEqual(65);
      // The zone's neighbour is the empty clear gap, never End session.
      const neighbour = await page.getByTestId('estop-zone').evaluate((z) => z.previousElementSibling?.getAttribute('aria-hidden'));
      expect(neighbour).toBe('true');

      await openTools(page);
      const open = await clearance(page);
      expect(open.bar!.d, `nearest with tools open: ${open.bar!.el}`).toBeGreaterThanOrEqual(65);
      test.info().annotations.push({ type: 'clearance', description: `${phase}@${w}: closed ${closed.bar!.d} (${closed.bar!.el}), open ${open.bar!.d} (${open.bar!.el})` });
    });
  }
}

/** What fits in the bar at one width: the E-STOP whole and inside it, nothing overlapping. */
async function barFit(page: Page) {
  return page.evaluate(() => {
    const q = (s: string) => document.querySelector(s) as HTMLElement | null;
    const header = q('[data-testid="session-command-bar"]')!;
    const bar = header.getBoundingClientRect();
    const e = q('[data-testid="session-estop"]')!.getBoundingClientRect();
    const h1 = header.querySelector('h1')!;
    const shown = (el: Element | null): el is HTMLElement =>
      !!el && (el as HTMLElement).getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
    // Every visible box in the bar's flow, left to right: back, identity, ⋯ or the left group, gap, zone.
    const boxes = [...header.children].filter(shown).map((el) => ({ id: el.getAttribute('data-testid') || el.tagName, r: el.getBoundingClientRect() }));
    let overlap = '';
    for (let i = 1; i < boxes.length; i++) {
      if (boxes[i].r.left < boxes[i - 1].r.right - 0.5) overlap = `${boxes[i - 1].id} / ${boxes[i].id}`;
    }
    const line1 = h1.parentElement!;
    const line2 = line1.nextElementSibling as HTMLElement;
    return {
      fit: header.dataset.fit,
      estopInBar: e.left >= bar.left - 0.5 && e.right <= bar.right + 0.5 && e.top >= bar.top && e.bottom <= bar.bottom,
      estopInViewport: e.left >= 0 && e.right <= window.innerWidth,
      estopWidth: Math.round(e.width),
      h1: Math.round(h1.getBoundingClientRect().width),
      // The identity's lines never spill over what follows them.
      spill: Math.max(line1.scrollWidth - line1.clientWidth, line2.scrollWidth - line2.clientWidth),
      overlap,
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
}

for (const phase of ['setup', 'record', 'wrap'] as const) {
  test(`the bar fits from 640 to 1500 px, the E-STOP whole inside it — ${phase}`, async ({ page }) => {
    await page.setViewportSize({ width: 1512, height: 900 });
    await OPEN[phase](page);
    const fits: string[] = [];
    for (let w = 640; w <= 1500; w += 20) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.waitForTimeout(60);
      const r = await barFit(page);
      fits.push(`${w}:${r.fit}`);
      expect(r.estopInBar, `E-STOP inside the bar at ${w}`).toBe(true);
      expect(r.estopInViewport, `E-STOP inside the viewport at ${w}`).toBe(true);
      expect(r.estopWidth, `E-STOP width at ${w}`).toBeGreaterThanOrEqual(176);
      expect(r.overlap, `overlap at ${w}`).toBe('');
      expect(r.spill, `identity spill at ${w}`).toBeLessThanOrEqual(0);
      expect(r.h1, `h1 width at ${w}`).toBeGreaterThanOrEqual(100);
      expect(r.pageOverflow, `page overflow at ${w}`).toBeLessThanOrEqual(0);
      if (phase !== 'wrap') {
        const c = await clearance(page);
        expect(c.zoneOthers).toBe(0);
        expect(c.bar!.d, `nearest at ${w}: ${c.bar!.el}`).toBeGreaterThanOrEqual(65);
      }
    }
    test.info().annotations.push({ type: 'fit', description: fits.join(' ') });
  });
}

test('the stuck bar sits 32 px under the TopBar, every TopBar control ≥ 48 px from the E-STOP', async ({ page }) => {
  // 1512 wide; short enough that Set up scrolls (since TASK-427 it fits 1512×945 whole).
  await page.setViewportSize({ width: 1512, height: 600 });
  await openSetup(page);
  const atRest = await page.getByTestId('session-command-bar').boundingBox();
  expect(atRest!.y).toBeGreaterThan(100);
  await page.evaluate(() => window.scrollTo(0, 400));
  await page.waitForTimeout(100);
  const bar = await page.getByTestId('session-command-bar').boundingBox();
  expect(Math.round(bar!.y)).toBe(88);
  // The TopBar is not moved; the 32 px offset keeps it clear. Measured to the
  // account avatar (the 28 px circle) and to the nearest TopBar control's
  // whole hit box: its 38 px icon buttons (Docs sits right above the E-STOP at
  // 1512) end at 46.5 px, and the E-STOP's top is at 96.
  const top = await page.evaluate(() => {
    const E = document.querySelector('[data-testid="session-estop"]')!.getBoundingClientRect();
    const header = document.querySelector('[data-app-shell] > header')!;
    const dist = (r: DOMRect) => Math.hypot(Math.max(0, E.left - r.right, r.left - E.right), Math.max(0, E.top - r.bottom, r.top - E.bottom));
    let control = { d: Infinity, el: '' };
    for (const el of header.querySelectorAll('a[href], button, input')) {
      const r = el.getBoundingClientRect();
      if (!r.width) continue;
      const d = dist(r);
      if (d < control.d) control = { d: Math.round(d * 10) / 10, el: el.getAttribute('aria-label') || (el.textContent ?? '').trim().slice(0, 30) };
    }
    const avatar = header.querySelector('button[aria-label="Open user menu"] > span.rounded-full');
    return { control, avatar: avatar ? Math.round(dist(avatar.getBoundingClientRect()) * 10) / 10 : null };
  });
  test.info().annotations.push({ type: 'topbar', description: `avatar ${top.avatar} px, nearest control box ${top.control.d} px (${top.control.el})` });
  expect(top.avatar).not.toBeNull();
  expect(top.avatar!).toBeGreaterThanOrEqual(48);
  expect(top.control.d, `nearest TopBar control: ${top.control.el}`).toBeGreaterThanOrEqual(48);
  // The shim's canvas band covers the full 32 px: nothing shows between the TopBar and the bar.
  const band = await page.getByTestId('session-command-bar').evaluate((bar) => {
    const shim = bar.parentElement!;
    return { stuck: shim.dataset.stuck, height: getComputedStyle(shim, '::before').height };
  });
  expect(band).toEqual({ stuck: 'true', height: '32px' });
});

test('on a phone the E-STOP alone is the bottom dock; the ⋯ menu holds the bar actions', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openRecord(page);
  const zone = page.getByTestId('estop-zone');
  await expect(zone).toHaveCSS('position', 'fixed');
  const box = await zone.boundingBox();
  expect(Math.round(box!.y + box!.height)).toBe(844);
  expect((await clearance(page)).zoneOthers).toBe(0);
  const estop = await page.getByTestId('session-estop').boundingBox();
  expect(estop!.height).toBeGreaterThanOrEqual(52);
  expect(estop!.width).toBeGreaterThanOrEqual(176);
  // Back, the status tag and the robot stay in the bar; the h1 wraps to at most two lines.
  const bar = page.getByTestId('session-command-bar');
  await expect(bar.getByRole('link', { name: 'Back to Data collection' })).toBeVisible();
  await expect(bar.getByText('Recording', { exact: true })).toBeVisible();
  const lines = await bar.getByRole('heading', { level: 1 }).evaluate((h) => Math.round(h.getBoundingClientRect().height / parseFloat(getComputedStyle(h).lineHeight)));
  expect(lines).toBeLessThanOrEqual(2);
  await expect(page.getByTestId('session-actions')).toBeHidden();

  await page.getByTestId('session-more').click();
  const menu = page.getByRole('menu', { name: 'More session actions' });
  await expect(menu.getByRole('menuitem')).toHaveText(['End session', 'Testing tools', 'Mute sound cues']);
  await page.screenshot({ ...shot('TASK-426-record-390-menu.png') });
  await page.keyboard.press('Escape');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

for (const [w, h] of [[390, 844], [360, 640]] as const) {
  test(`on a phone an open Testing tools popover never covers the docked E-STOP — ${w}×${h}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await openSetup(page);
    await openTools(page);
    const tools = page.getByTestId('session-tools');
    // Open a row in place too, so the popover is as tall as it gets.
    await tools.getByTestId('joint-states-toggle').click();
    await page.waitForTimeout(100);
    for (const scroll of [0, 200]) {
      // Jump, not glide: the page scrolls smoothly, and a probe mid-glide measures a moving page.
      await page.evaluate((y) => {
        document.documentElement.style.scrollBehavior = 'auto';
        window.scrollTo(0, y);
      }, scroll);
      await page.waitForTimeout(60);
      const r = await page.evaluate(() => {
        const estop = document.querySelector('[data-testid="session-estop"]')!;
        const e = estop.getBoundingClientRect();
        const dock = document.querySelector('[data-testid="estop-zone"]')!.getBoundingClientRect();
        const t = document.querySelector('[data-testid="session-tools"]')!.getBoundingClientRect();
        // Inset past the rounded corners: every point a thumb aimed at the E-STOP would hit.
        const i = 6;
        const points = [
          [e.left + i, e.top + i], [e.right - i, e.top + i], [e.left + i, e.bottom - i], [e.right - i, e.bottom - i],
          [e.left + e.width / 2, e.top + e.height / 2],
        ];
        const hits = points.map(([x, y]) => {
          const el = document.elementFromPoint(x, y);
          return el?.closest('[data-testid="session-estop"]') ? 'session-estop' : el?.closest('[data-testid]')?.getAttribute('data-testid') ?? el?.tagName ?? 'none';
        });
        return { hits, gap: Math.round((dock.top - t.bottom) * 10) / 10 };
      });
      expect(r.hits, `E-STOP hit points at scroll ${scroll}`).toEqual(Array(5).fill('session-estop'));
      expect(r.gap, `popover bottom to dock top at scroll ${scroll}`).toBeGreaterThanOrEqual(17);
    }
    await page.screenshot({ ...shot(`TASK-426-setup-${w}-tools.png`) });
  });
}

test('the E-STOP fires on one press without a dialog, and on Escape twice', async ({ page }) => {
  await openRecord(page);
  await page.getByTestId('session-estop').click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(page.getByText('Emergency stop sent')).toBeVisible();
  await page.getByText('Emergency stop sent').waitFor({ state: 'detached', timeout: 15_000 }).catch(() => undefined);
  await page.locator('body').click({ position: { x: 5, y: 300 } });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.getByText('Emergency stop sent').first()).toBeVisible();
});

test('Testing tools reaches every developer tool in one click, kept mounted', async ({ page }) => {
  await page.setViewportSize({ width: 1512, height: 945 });
  await openSetup(page);
  const tools = page.getByTestId('session-tools');
  await expect(tools).toBeHidden();
  // Mounted while closed: the VR panel (modal, simulated input, goodbye) lives in there.
  await expect(tools.getByTestId('vr-session-panel')).toHaveCount(1);
  await openTools(page);
  for (const id of ['simulate-vr-toggle', 'vr-launch', 'keyboard-fallback-toggle', 'joint-states-toggle', 'headset-view-toggle']) {
    await expect(tools.getByTestId(id)).toBeVisible();
  }
  // Simulated input shows its tag in the bar.
  await tools.getByTestId('simulate-vr-toggle').click();
  await expect(page.getByTestId('sim-input-tag')).toHaveText('Simulated input');
  await expect(tools.getByTestId('vr-launch')).toBeDisabled();
  await page.screenshot({ ...shot('TASK-426-setup-1512-tools.png') });
  await tools.getByTestId('simulate-vr-toggle').click();
  // Escape closes it, focus returns to the button.
  await page.keyboard.press('Escape');
  await expect(tools).toBeHidden();
  await expect(page.getByTestId('session-tools-toggle')).toBeFocused();
  await expect(tools.getByTestId('vr-session-panel')).toHaveCount(1);
  // An outside click closes it too.
  await openTools(page);
  await page.mouse.click(400, 700);
  await expect(tools).toBeHidden();
});

test('a keyboard session keeps its fallback and the joint states in Testing tools', async ({ page }) => {
  await page.setViewportSize({ width: 1512, height: 945 });
  await openRecord(page);
  await expect(page.getByText('Manual control')).toHaveCount(0);
  await openTools(page);
  const tools = page.getByTestId('session-tools');
  await expect(tools.getByTestId('keyboard-fallback-toggle')).toBeVisible();
  await tools.getByTestId('joint-states-toggle').click();
  await expect(tools.getByTestId('joint-states-toggle')).toHaveText('Hide');
  // Mute lives in the bar in Record.
  await expect(page.getByTestId('session-actions').getByTestId('hud-mute')).toBeVisible();
});

for (const [w, h] of [[390, 844], [1280, 800]] as const) {
  test(`the headset leads with "This is the headset" and Launch VR above the fold at ${w}×${h}`, async ({ browser }) => {
    const context = await browser.newContext({ userAgent: QUEST_UA, viewport: { width: w, height: h }, colorScheme: 'dark' });
    const page = await context.newPage();
    await openSetup(page);
    const hero = page.getByTestId('headset-hero');
    await expect(hero).toBeVisible();
    await expect(hero).toContainText('This is the headset');
    const launch = hero.getByTestId('vr-launch');
    await expect(launch).toBeVisible();
    const box = await launch.boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(h);
    // One VR panel only, and the desktop's blocks wait behind "Robot setup".
    await expect(page.getByTestId('vr-session-panel')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Robot setup' })).toHaveAttribute('aria-expanded', 'false');
    await page.screenshot({ ...shot(`TASK-426-headset-${w}.png`) });
    await context.close();
  });
}

// ---------------------------------------------------------------------------
// TASK-427 — Set up: the guided rail with one lit action, and the preview.
// ---------------------------------------------------------------------------
test.describe('Set up (TASK-427)', () => {
  /** Enabled kit primaries on screen (the E-STOP is `bg-stop`, not counted). */
  const litPrimaries = (page: Page) =>
    page.evaluate(() =>
      [...document.querySelectorAll<HTMLButtonElement>('button.bg-primary')]
        .filter((b) => !b.disabled && b.getClientRects().length > 0 && getComputedStyle(b).visibility !== 'hidden')
        .map((b) => b.dataset.testid ?? b.textContent?.trim() ?? ''),
    );

  /** The page-wide nearest interactive element to the E-STOP, at the current scroll. */
  const pageClearance = (page: Page) =>
    page.evaluate(() => {
      const estop = document.querySelector('[data-testid="session-estop"]') as HTMLElement;
      const E = estop.getBoundingClientRect();
      const sel = 'a[href], button, [role="switch"], [role="menuitem"], input, select, textarea';
      let best = { d: Infinity, el: '' };
      for (const el of document.querySelectorAll(sel)) {
        if (el === estop || !(el as HTMLElement).getClientRects().length) continue;
        let shown = true;
        for (let p: Element | null = el; p; p = p.parentElement) {
          const s = getComputedStyle(p);
          if (s.display === 'none' || s.visibility === 'hidden') { shown = false; break; }
        }
        if (!shown) continue;
        const r = el.getBoundingClientRect();
        const d = Math.hypot(Math.max(0, E.left - r.right, r.left - E.right), Math.max(0, E.top - r.bottom, r.top - E.bottom));
        if (d < best.d) {
          best = { d: Math.round(d * 10) / 10, el: (el.getAttribute('data-testid') || el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40) };
        }
      }
      return best;
    });

  test('the current step is open and holds the page\'s one lit action; Start session is secondary', async ({ page }) => {
    await page.setViewportSize({ width: 1512, height: 945 });
    await openSetup(page);
    const robot = page.getByTestId('setup-step-robot');
    // The demo robot side starts stopped: step 1 is current, open, and its Start is the one lit action.
    await expect(robot).toHaveAttribute('data-state', 'current');
    await expect(robot).toHaveAttribute('data-expanded', 'true');
    await expect(robot.getByTestId('readiness-start')).toBeVisible();
    expect(await litPrimaries(page)).toEqual(['readiness-start']);
    const start = page.getByRole('button', { name: 'Start session' });
    await expect(start).toBeEnabled();
    await expect(start).not.toHaveClass(/bg-primary/);
    await expect(page.getByTestId('setup-start-text')).toContainText('steps open. You can start anyway');
    await expect(page.getByTestId('setup-progress')).toContainText('of 5 done');
    // The rest of the steps, in bring-up order.
    await expect(page.locator('[data-testid^="setup-step-"][data-state]')).toHaveCount(5);
    for (const id of ['arm_control', 'stance', 'quest', 'operator']) {
      await expect(page.getByTestId(`setup-step-${id}`)).toHaveAttribute('data-expanded', 'false');
    }
    // Opening another step moves the lit action with it: never two.
    await page.getByTestId('setup-step-quest-toggle').click();
    await expect(robot).toHaveAttribute('data-expanded', 'false');
    expect((await litPrimaries(page)).length).toBeLessThanOrEqual(1);
    await page.getByTestId('setup-step-quest-toggle').click();
    await expect(robot).toHaveAttribute('data-expanded', 'true');
    await page.screenshot({ ...shot('TASK-427-setup-1512.png') });
  });

  test('no duplicates in Set up: the Quest controls, "Open on headset" and the reason sentence once', async ({ page }) => {
    await page.setViewportSize({ width: 1512, height: 945 });
    await openSetup(page);
    await page.getByTestId('readiness-start').click();
    // The demo robot side walks to "up, read-only": the reason moves to step 2.
    const reason = page.getByTestId('setup-step-reason');
    await expect(page.getByTestId('setup-step-arm_control').getByTestId('setup-step-reason')).toHaveAttribute('data-code', 'read_only', { timeout: 15_000 });
    await expect(reason).toHaveCount(1);
    const text = (await reason.textContent())!.trim();
    const count = await page.evaluate((t) => document.body.innerHTML.split(t).length - 1, text);
    expect(count, `"${text}" in the DOM`).toBe(1);
    for (const id of ['quest-connect', 'quest-open', 'quest-copy-viewer-link', 'quest-connect-help']) {
      await expect(page.getByTestId(id), id).toHaveCount(1);
    }
    await expect(page.getByTestId('setup-step-quest').getByTestId('quest-connect-help')).toHaveAttribute('data-mode', 'live');
    expect(await page.evaluate(() => document.body.innerText.split('Open on headset').length - 1)).toBeLessThanOrEqual(1);
    // Nothing from the old blocks is left in Set up.
    for (const id of ['preflight', 'session-readiness', 'robot-readiness-compact', 'operator-card', 'session-lease-holder', 'session-hud']) {
      await expect(page.getByTestId(id), id).toHaveCount(0);
    }
  });

  test('every Set up function is one click away', async ({ page }) => {
    await page.setViewportSize({ width: 1512, height: 945 });
    await openSetup(page);
    const open = async (id: string) => {
      const step = page.getByTestId(`setup-step-${id}`);
      if ((await step.getAttribute('data-expanded')) !== 'true') await page.getByTestId(`setup-step-${id}-toggle`).click();
      return step;
    };
    await expect((await open('robot')).getByTestId('readiness-start')).toBeVisible();
    await page.getByTestId('readiness-start').click();
    await expect(page.getByTestId('setup-step-arm_control')).toHaveAttribute('data-state', /open|current/, { timeout: 15_000 });
    await expect((await open('robot')).getByTestId('readiness-logs')).toBeVisible();
    const arm = await open('arm_control');
    await expect(arm.getByTestId('readiness-arm-control')).toBeVisible({ timeout: 15_000 });
    // The demo has no control lease: the step says so where Take control would be.
    await expect(arm.getByTestId('readiness-take-control').or(arm.getByTestId('readiness-arm-blocked'))).toBeVisible();
    const stance = await open('stance');
    for (const m of ['limp', 'stand', 'balance']) await expect(stance.getByTestId(`robot-mode-${m}`)).toBeVisible();
    await expect(stance.getByTestId('robot-bringup')).toBeVisible({ timeout: 10_000 });
    const quest = await open('quest');
    for (const id of ['quest-connect', 'quest-open', 'quest-copy-viewer-link']) await expect(quest.getByTestId(id)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start session' })).toBeVisible();
    const preview = page.getByTestId('setup-preview');
    await expect(preview.getByTestId('live-view-switch')).toBeVisible();
    await expect(preview.getByTestId('live-view-expand')).toBeVisible();
    await expect(preview.getByTestId('session-twin')).toBeVisible();
  });

  for (const [w, h, min] of [[1280, 800, 48], [1512, 945, 64], [1920, 1080, 64]] as const) {
    test(`the E-STOP stands alone page-wide in Set up at ${w}×${h} — step 3 open, Testing tools closed and open`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await openSetup(page);
      await page.getByTestId('readiness-start').click();
      await expect(page.getByTestId('robot-bringup')).toHaveCount(1, { timeout: 15_000 });
      const notes: string[] = [];
      const measure = async (label: string) => {
        await page.evaluate(() => window.scrollTo(0, 0));
        const c = await pageClearance(page);
        notes.push(`${label} ${c.d} (${c.el})`);
        expect(c.d, `${label}: nearest ${c.el}`).toBeGreaterThanOrEqual(min);
      };
      await measure('default');
      await page.getByTestId('setup-step-stance-toggle').click();
      await expect(page.getByTestId('setup-step-stance')).toHaveAttribute('data-expanded', 'true');
      await measure('step 3 open');
      await openTools(page);
      await measure('step 3 + tools');
      await page.keyboard.press('Escape');
      if (w === 1512) await page.screenshot({ ...shot('TASK-427-setup-step3-1512.png') });
      test.info().annotations.push({ type: 'clearance', description: `setup@${w}: ${notes.join(' · ')}` });
    });
  }

  test('on a phone Set up has no horizontal scroll and Start session stays in the page', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openSetup(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const start = page.getByRole('button', { name: 'Start session' });
    // In the start bar, not in the dock (the dock holds only the E-STOP).
    await expect(page.getByTestId('setup-start').getByRole('button', { name: 'Start session' })).toHaveCount(1);
    await expect(page.getByTestId('estop-zone').getByRole('button', { name: 'Start session' })).toHaveCount(0);
    await start.scrollIntoViewIfNeeded();
    await expect(start).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ ...shot('TASK-427-setup-390.png') });
    await page.screenshot({ ...shot('TASK-427-setup-390-full.png'), fullPage: true });
  });
});
