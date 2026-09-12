/**
 * @file app-routes.spec.ts
 * @description Route smoke for the design system (TASK-269): every app route in
 *   the demo build, at desktop and phone width, renders on the landing tokens —
 *   no page error, exactly one h1, no horizontal overflow, no visible text under
 *   10px, no backdrop-filter, and the dark matte ground.
 * @feature design
 */
import { expect, test, type Page } from '@playwright/test';

// Every route App.tsx serves inside the app shell, plus the tab each redirect
// lands on and the not-found page. Parameterised routes use the ids the demo
// mocks serve (src/mocks); detail routes with no demo record (sites, patrol and
// tour routes/runs, processes, deployments, incidents, collection sessions,
// federated rounds) are left out. Excluded: the landing page (its own scoped
// styles), the public auth pages, /set-password (outside the shell) and
// /design-system (DEV builds only).
const ROUTES = [
  // Overview + Operate
  '/dashboard', '/fleet', '/fleet?tab=list', '/fleet?tab=sites',
  '/robots/demo-h1-001', '/robots/demo-g1-001/cockpit',
  '/control-center', '/agent', '/patrol', '/patrol/routes/new', '/tour', '/tour/routes/new',
  '/processes', '/alerts', '/alerts?tab=history', '/alerts?tab=incidents', '/chat',
  // Build
  '/pipeline', '/data-collection', '/data-collection/new', '/datasets',
  '/datasets/demo-g1-edu/episodes', '/training', '/training?tab=evaluation',
  '/training?tab=simulation', '/models', '/deployments', '/deployments?tab=skills',
  '/fleet-learning', '/marketplace', '/marketplace/mine', '/marketplace/ml-001',
  // Comply
  '/compliance', '/compliance?tab=explainability', '/compliance?tab=gdpr',
  '/compliance?tab=oversight', '/compliance?tab=approvals',
  // System + Admin + account
  '/updates', '/docs', '/docs/brand', '/settings', '/account', '/organizations', '/team',
  // A2A
  '/a2a', '/a2a/agents', '/a2a/agents/Demo%20Agent', '/a2a/tasks', '/a2a/events',
  '/this-route-does-not-exist',
];

// Headless Chromium has no GPU, so the 3D pages cannot create a WebGL context
// and three.js throws from the renderer's constructor. That says nothing about
// the page's design, so exactly this message is dropped; every other page
// error fails the test.
const HEADLESS_WEBGL = /Error creating WebGL context/;

const WIDTHS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'phone', width: 390, height: 844 },
];

interface PageFacts {
  h1: number;
  overflowX: number;
  smallText: string[];
  backdrop: number;
  bodyBg: string;
}

async function collectFacts(page: Page): Promise<PageFacts> {
  return page.evaluate(() => {
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
    };
    const smallText: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.textContent?.trim();
      const el = n.parentElement;
      if (!text || !el || !visible(el) || el.closest('svg, canvas, [aria-hidden="true"]')) continue;
      if (parseFloat(getComputedStyle(el).fontSize) < 10) smallText.push(text.slice(0, 40));
    }
    let backdrop = 0;
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const s = getComputedStyle(el);
      const bf = s.backdropFilter || (s as CSSStyleDeclaration & { webkitBackdropFilter?: string }).webkitBackdropFilter;
      if (bf && bf !== 'none' && visible(el)) backdrop += 1;
    }
    return {
      h1: Array.from(document.querySelectorAll('h1')).filter(visible).length,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      smallText: smallText.slice(0, 5),
      backdrop,
      bodyBg: getComputedStyle(document.body).backgroundColor,
    };
  });
}

for (const size of WIDTHS) {
  for (const route of ROUTES) {
    test(`${route} renders on the design system (${size.name})`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => {
        if (!HEADLESS_WEBGL.test(error.message)) errors.push(error.message);
      });
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto(`./#${route}`);
      await expect(page.locator('h1').first()).toBeVisible();
      await page.waitForLoadState('networkidle');

      const facts = await collectFacts(page);
      expect(errors, 'page errors').toEqual([]);
      expect(facts.h1, 'visible h1 count').toBe(1);
      expect(facts.overflowX, 'horizontal overflow in px').toBeLessThanOrEqual(0);
      expect(facts.smallText, 'visible text under 10px').toEqual([]);
      expect(facts.backdrop, 'elements with backdrop-filter').toBe(0);
      expect(facts.bodyBg, 'dark ground').toBe('rgb(8, 15, 24)');
    });
  }
}
