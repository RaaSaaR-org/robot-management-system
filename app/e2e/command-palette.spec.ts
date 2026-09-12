/**
 * @file command-palette.spec.ts
 * @description The ⌘K palette in the demo build (TASK-280): the shortcut opens
 *   it from any page, a subsequence reaches a row that survived the navigation
 *   cut, and it reaches a tab of a page that lost its row — the case the cut
 *   depends on.
 * @feature layout
 */
import { expect, test } from '@playwright/test';

/** ⌘K on macOS, Ctrl+K everywhere else — the binding the hook makes. */
const SHORTCUT = 'ControlOrMeta+KeyK';

const field = 'Search pages';

test('the shortcut opens the palette and reaches a row from anywhere in the shell', async ({ page }) => {
  await page.goto('./#/dashboard');
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();

  await page.keyboard.press(SHORTCUT);
  await expect(page.getByTestId('command-palette')).toBeVisible();

  await page.getByRole('combobox', { name: field }).fill('control');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/control-center/);
  await expect(page.getByTestId('command-palette')).toBeHidden();
});

test('it reaches a tab of a page that lost its sidebar row', async ({ page }) => {
  await page.goto('./#/dashboard');
  // Wait for the shell before pressing: the binding is a listener the mounted
  // app installs, so a key sent to a blank document goes nowhere.
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();

  // Guide became a stop on the Missions rail in TASK-277, and its Visits tab
  // was never a row at all — the palette is the only way in by name.
  await page.keyboard.press(SHORTCUT);
  await page.getByRole('combobox', { name: field }).fill('visits');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/tour\?tab=visits/);
  await expect(page.getByRole('tab', { name: 'Visits' })).toHaveAttribute('aria-selected', 'true');
});

test('the top bar offers the same palette, with the shortcut spelled out', async ({ page }) => {
  await page.goto('./#/dashboard');
  const search = page.getByRole('button', { name: field });
  await expect(search).toContainText(/⌘K|Ctrl K/);
  await search.click();
  await expect(page.getByTestId('command-palette')).toBeVisible();
  // Esc closes it and hands focus back to the button that opened it.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('command-palette')).toBeHidden();
  await expect(search).toBeFocused();
});
