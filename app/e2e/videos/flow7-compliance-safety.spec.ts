import { test } from '@playwright/test';
import { smoothGoto, smoothClick, scenePause } from '../helpers/videoHelpers';
import { mkdirSync } from 'fs';

mkdirSync('e2e/results/videos', { recursive: true });

test('Flow 7: EU AI Act Compliance & Safety', async ({ page }) => {
  // Scene 1: Compliance audit log
  await smoothGoto(page, '/#/compliance', 4000);

  // Scene 2: Scroll through log entries
  await page.evaluate(() => window.scrollBy(0, 300));
  await scenePause(page, 2500);

  // Scene 3: AI Explainability — decision transparency
  await smoothGoto(page, '/#/explainability', 4000);

  // Scene 4: Scroll through explanations
  await page.evaluate(() => window.scrollBy(0, 300));
  await scenePause(page, 2500);

  // Scene 5: Human Oversight dashboard
  await smoothGoto(page, '/#/oversight', 4000);

  // Scene 6: Approvals — human-in-the-loop
  await smoothGoto(page, '/#/approvals', 3000);

  // Scene 7: Data Privacy (GDPR portal)
  await smoothGoto(page, '/#/gdpr', 3000);

  // Scene 8: Incidents
  await smoothGoto(page, '/#/incidents', 3000);

  // Scene 9: Back to dashboard — everything in one place
  await smoothGoto(page, '/#/dashboard', 3000);

  // Final pause
  await scenePause(page, 2000);
});
