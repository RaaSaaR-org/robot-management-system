import { test } from '@playwright/test';
import { smoothGoto, scenePause, smoothScroll } from '../helpers/videoHelpers';
import { mkdirSync } from 'fs';

mkdirSync('e2e/results/videos', { recursive: true });

test('Flow 7: EU AI Act Compliance & Safety', async ({ page }) => {
  // Scene 1: Audit log
  await smoothGoto(page, '/#/compliance', 4000);
  await smoothScroll(page, 300, 2500);

  // Scene 2: Explainability
  await smoothGoto(page, '/#/explainability', 4000);
  await smoothScroll(page, 300, 2500);

  // Scene 3: Oversight
  await smoothGoto(page, '/#/oversight', 4000);

  // Scene 4: Approvals
  await smoothGoto(page, '/#/approvals', 3000);

  // Scene 5: GDPR
  await smoothGoto(page, '/#/gdpr', 3000);
  await smoothScroll(page, 200, 2000);

  // Scene 6: Incidents
  await smoothGoto(page, '/#/incidents', 3000);

  // Scene 7: Dashboard
  await smoothGoto(page, '/#/dashboard', 3000);

  await scenePause(page, 2000);
});
