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
  await page.setViewportSize({ width: 1512, height: 945 });
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

// ─────────────────────────────────────────────────────────────────────────────
// TASK-429 — Wrap up: one summary band with one dataset action. One lit
// action, Edit task and Create dataset one click away, the page-wide E-STOP
// clearance at 1280/1512/1920 at scroll 0, and the phone band.
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Wrap up (TASK-429)', () => {
  /** End the demo takes session after `takes` kept takes (0 → nothing to package). */
  async function wrapAfter(page: Page, takes: number): Promise<void> {
    await openRecord(page);
    for (let i = 0; i < takes; i++) {
      await page.getByTestId('take-primary').click();
      await expect(page.getByTestId('take-primary')).toHaveText(/Stop take/);
      await page.waitForTimeout(1500);
      await page.getByTestId('take-primary').click();
      await page.getByTestId('quick-check-keep').click();
    }
    const end = page.getByTestId('session-end');
    if (await end.isVisible()) await end.click();
    else {
      await page.getByTestId('session-more').click();
      await page.getByTestId('session-more-end').click();
    }
    await page.getByRole('alertdialog').getByRole('button', { name: /^End session$/ }).click();
    await expect(page.locator('[data-testid="session-command-bar"][data-phase="wrap"]')).toBeVisible();
    await expect(page.getByTestId('session-summary')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
  }

  /** Visible, enabled kit primaries (the `bg-primary` fill), the E-STOP aside. */
  const litActions = (page: Page) =>
    page.evaluate(() =>
      [...document.querySelectorAll('button, a[href]')]
        .filter((el) => el.getAttribute('data-testid') !== 'session-estop')
        .filter((el) => el.classList.contains('bg-primary') && !(el as HTMLButtonElement).disabled)
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
        })
        .map((el) => el.getAttribute('data-testid') || (el.textContent ?? '').trim()),
    );

  /**
   * Page-wide: the nearest visible interactive element to the E-STOP, anywhere
   * on the page. The shell's section rail (`nav[aria-label="Section"]`) is
   * reported on its own: it is the same in every phase and not this page's to
   * move (at 1280 its right-most tabs sit above the bar's E-STOP).
   */
  const pageClearance = (page: Page) =>
    page.evaluate(() => {
      const estop = document.querySelector('[data-testid="session-estop"]')!;
      const rail = document.querySelector('nav[aria-label="Section"]');
      const E = estop.getBoundingClientRect();
      const sel = 'a[href], button, [role="switch"], [role="menuitem"], input, select, textarea';
      const page = { d: Infinity, el: '' };
      const shell = { d: Infinity, el: '' };
      for (const el of document.querySelectorAll(sel)) {
        if (el === estop || !(el as HTMLElement).getClientRects().length) continue;
        let hidden = false;
        for (let p: Element | null = el; p; p = p.parentElement) {
          const s = getComputedStyle(p);
          if (s.display === 'none' || s.visibility === 'hidden') hidden = true;
        }
        if (hidden) continue;
        const r = el.getBoundingClientRect();
        const d = Math.round(Math.hypot(Math.max(0, E.left - r.right, r.left - E.right), Math.max(0, E.top - r.bottom, r.top - E.bottom)) * 10) / 10;
        const best = rail && rail.contains(el) ? shell : page;
        if (d < best.d) {
          best.d = d;
          best.el = el.getAttribute('data-testid') || el.getAttribute('aria-label') || (el.textContent ?? '').trim().slice(0, 30);
        }
      }
      return { page, rail: shell };
    });

  test('one lit action: Create dataset after a kept take', async ({ page }) => {
    await page.setViewportSize({ width: 1512, height: 945 });
    await wrapAfter(page, 1);
    expect(await litActions(page)).toEqual(['create-dataset']);
    // The one dataset control in the DOM; the Details row names the state without a button.
    await expect(page.getByRole('button', { name: /dataset/i })).toHaveCount(1);
    await expect(page.getByTestId('open-dataset')).toHaveCount(0);
    await expect(page.getByTestId('review-episodes')).toBeVisible();
    await expect(page.getByTestId('review-episodes').getByTestId('take-thumbnail-0')).toBeVisible();
    await expect(page.getByTestId('session-frames')).not.toHaveText('0');
    await page.screenshot({ ...shot('TASK-429-wrap-1512-e2e.png') });
  });

  test('one lit action: New session when nothing was recorded', async ({ page }) => {
    await page.setViewportSize({ width: 1512, height: 945 });
    await wrapAfter(page, 0);
    expect(await litActions(page)).toEqual(['wrap-new-session']);
    await expect(page.getByTestId('create-dataset')).toHaveCount(0);
    await expect(page.getByTestId('session-summary')).toContainText('nothing to package');
  });

  test('Edit task and Create dataset are one click away', async ({ page }) => {
    await page.setViewportSize({ width: 1512, height: 945 });
    await wrapAfter(page, 1);
    await page.getByRole('button', { name: 'Edit task' }).click();
    await expect(page.getByRole('dialog', { name: 'Edit task' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Edit task' })).toHaveCount(0);
    await page.getByTestId('create-dataset').click();
    await expect(page.getByRole('dialog', { name: 'Create dataset' })).toBeVisible();
  });

  for (const [w, h, min] of [[1280, 800, 48], [1512, 945, 64], [1920, 1080, 64]] as const) {
    test(`the E-STOP stands alone page-wide — ${w}×${h} (≥ ${min} px)`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await wrapAfter(page, 1);
      await page.evaluate(() => window.scrollTo(0, 0));
      const near = await pageClearance(page);
      test.info().annotations.push({
        type: 'clearance',
        description: `wrap@${w}: page ${near.page.d} px (${near.page.el}); section rail ${near.rail.d} px (${near.rail.el})`,
      });
      expect(near.page.d, `nearest: ${near.page.el}`).toBeGreaterThanOrEqual(min);
      // The action sits in its own column, below the band's top row.
      const band = (await page.getByTestId('session-summary').boundingBox())!;
      const action = (await page.getByTestId('create-dataset').boundingBox())!;
      expect(action.y).toBeGreaterThan(band.y + 40);
      expect(action.x).toBeGreaterThan(band.x + band.width / 2);
    });
  }

  test('on a phone: no horizontal scroll, the action spans the band in the page', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await wrapAfter(page, 1);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const action = page.getByTestId('session-summary').getByTestId('create-dataset');
    await expect(action).toBeVisible();
    await expect(page.getByTestId('estop-zone').getByTestId('create-dataset')).toHaveCount(0);
    const fill = await page.getByTestId('session-summary').evaluate((band) => {
      const b = band.getBoundingClientRect();
      const s = getComputedStyle(band);
      const a = band.querySelector('[data-testid="create-dataset"]')!.getBoundingClientRect();
      return { inner: b.width - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight) - parseFloat(s.borderLeftWidth) - parseFloat(s.borderRightWidth), action: a.width };
    });
    expect(Math.abs(fill.inner - fill.action)).toBeLessThanOrEqual(1);
    expect(await litActions(page)).toEqual(['create-dataset']);
    await page.screenshot({ ...shot('TASK-429-wrap-390-e2e.png'), fullPage: true });
  });
});
