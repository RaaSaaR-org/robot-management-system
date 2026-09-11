/**
 * @file landing-hero.spec.ts
 * @description Exercise automatic WebGL transformations, motion preferences and asset recovery.
 * @feature landing
 */
import { expect, test, type Page } from '@playwright/test';

test.use({
  launchOptions: {
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  },
});

/** Crop the hardware itself, excluding changing HTML captions. */
async function twinImage(page: Page) {
  const bounds = await page.locator('.hero-universe-canvas').boundingBox();
  if (!bounds) throw new Error('Missing hero canvas');
  return page.screenshot({
    clip: {
      x: bounds.x + bounds.width * 0.38,
      y: bounds.y + bounds.height * 0.25,
      width: bounds.width * 0.24,
      height: bounds.height * 0.5,
    },
  });
}

async function expectPoster(page: Page) {
  const poster = page.locator('.hero-universe-fallback img');
  await expect(poster).toBeVisible();
  await expect
    .poll(() =>
      poster.evaluate(
        (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
      ),
    )
    .toBe(true);
  await expect(page.locator('.hero-universe')).toHaveAttribute(
    'data-embodiment',
    'all',
  );
}

test('the same exhibit cycles humanoid → drone → quadruped → humanoid without controls', async ({
  page,
}) => {
  test.setTimeout(75_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      /THREE|WebGL|shader/i.test(message.text())
    )
      errors.push(message.text());
  });
  await page.goto('./');
  const exhibit = page.locator('.hero-universe');
  await expect(exhibit).toHaveClass(/is-ready/, { timeout: 20_000 });
  await expect(page.locator('.field-hero').getByRole('button')).toHaveCount(0);
  await expect(exhibit).toHaveAttribute('data-embodiment', 'humanoid');
  await expect(exhibit.locator('canvas')).toHaveCSS('opacity', '1');
  const humanoid = await twinImage(page);
  await expect(exhibit).toHaveAttribute('data-embodiment', 'drone', {
    timeout: 20_000,
  });
  // Caption changes during transport; allow the incoming surface to resolve.
  await page.waitForTimeout(2600);
  const drone = await twinImage(page);
  expect(drone.equals(humanoid)).toBe(false);
  await expect(exhibit).toHaveAttribute('data-embodiment', 'quadruped', {
    timeout: 20_000,
  });
  await page.waitForTimeout(2600);
  expect((await twinImage(page)).equals(drone)).toBe(false);
  await expect(exhibit).toHaveAttribute('data-embodiment', 'humanoid', {
    timeout: 20_000,
  });
  await expect(exhibit.locator('canvas')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('reduced motion shows all embodiments without loading 3D and reacts to preference changes', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const assets: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('.glb')) assets.push(request.url());
  });
  await page.goto('./');
  await expectPoster(page);
  await expect(page.locator('.hero-universe canvas')).toHaveCount(0);
  expect(assets).toEqual([]);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.locator('.hero-universe')).toHaveClass(/is-ready/, {
    timeout: 20_000,
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expectPoster(page);
  await expect(page.locator('.hero-universe canvas')).toHaveCount(0);
});

test('context loss restores one working exhibit', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('.hero-universe')).toHaveClass(/is-ready/, {
    timeout: 20_000,
  });
  await page
    .locator('.hero-universe canvas')
    .evaluate((canvas: HTMLCanvasElement) => {
      const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
      const extension = gl?.getExtension('WEBGL_lose_context');
      if (!extension) throw new Error('Missing context-loss extension');
      canvas.addEventListener(
        'webglcontextlost',
        () => {
          window.setTimeout(() => extension.restoreContext(), 700);
        },
        { once: true },
      );
      extension.loseContext();
    });
  await expectPoster(page);
  await expect(page.locator('.hero-universe')).toHaveClass(/is-ready/, {
    timeout: 15_000,
  });
  await expect(page.locator('.hero-universe canvas')).toHaveCount(1);
});

for (const failure of ['WebGL unavailable', 'models unavailable']) {
  test(`${failure}: the full embodiment poster and navigation remain available`, async ({
    page,
  }) => {
    if (failure === 'WebGL unavailable') {
      await page.addInitScript(`
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
          return kind.includes('webgl') ? null : original.call(this, kind, ...args);
        };
      `);
    } else {
      await page
        .context()
        .route('**/assets/landing/*-twin.glb', (route) =>
          route.fulfill({ status: 404, body: 'Unavailable for recovery test' }),
        );
    }
    await page.goto('./');
    await expectPoster(page);
    // Demo startup and GPU initialization can precede the failed fetches.
    await expect(page.locator('.hero-universe canvas')).toHaveCount(0, {
      timeout: 20_000,
    });
    await page.getByRole('link', { name: 'Explore the platform' }).click();
    await expect(
      page.getByRole('heading', { name: 'Fleet Dashboard', exact: true }),
    ).toBeVisible();
  });
}

test('an unavailable drone does not prevent the remaining embodiments from transforming', async ({
  page,
}) => {
  test.setTimeout(45_000);
  await page
    .context()
    .route('**/assets/landing/x500-twin.glb', (route) => route.abort());
  await page.goto('./');
  const exhibit = page.locator('.hero-universe');
  await expect(exhibit).toHaveClass(/is-ready/, { timeout: 20_000 });
  await expect(exhibit).toHaveAttribute('data-embodiment', 'humanoid');
  await expect(exhibit).toHaveAttribute('data-embodiment', 'quadruped', {
    timeout: 20_000,
  });
});

test('the exhibit and copy fit small phones and tablets', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./');
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(
      page.getByRole('heading', { name: /Intelligence.*Made physical\./ }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    for (const label of [
      '.hero-scene-heading',
      '.hero-scene-caption',
      '.field-primary',
    ]) {
      const bounds = await page.locator(label).boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    }
    // Labels are normal text: the body face, and never below 10px.
    const labels = await page
      .locator(
        '.field-hero :is(.field-kicker, .hero-scene-heading, .hero-scene-caption, .hero-callout > span, .field-footnote)',
      )
      .evaluateAll((elements) =>
        elements.map((element) => {
          const style = getComputedStyle(element);
          return { family: style.fontFamily, size: parseFloat(style.fontSize) };
        }),
      );
    for (const { family, size } of labels) {
      expect(family).toMatch(/^"?Inter/);
      expect(size).toBeGreaterThanOrEqual(10);
    }
    await expect(page.locator('.field-hero').getByRole('button')).toHaveCount(
      0,
    );
  }
});
