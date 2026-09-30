/**
 * @file social.spec.ts
 * @description The discussion layer on a dataset (TASK-241), against the demo
 *   build (MSW handlers in src/mocks/socialDemoHandlers.ts): the seeded agent
 *   rating reads as a percentage with evidence, its evaluation chip leads to
 *   the evaluation tab, a comment posted in-app shows in the thread and on
 *   the activity feed. The reload-persistence case needs a real server and
 *   lives in e2e/live/social.spec.ts.
 */
import { test, expect } from '@playwright/test';

const EPISODES_URL = '/#/datasets/demo-g1-edu/episodes';

test.describe('Dataset discussion', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(EPISODES_URL);
    await expect(page.getByRole('region', { name: 'Dataset discussion' })).toBeVisible({ timeout: 10_000 });
  });

  test('an agent rating reads as a percentage and its evidence chip opens the evaluation', async ({ page }) => {
    const panel = page.getByRole('region', { name: 'Dataset discussion' });
    const agentRow = panel.getByTestId('rating-row').filter({ hasText: 'eval-agent' });
    await expect(agentRow.getByTestId('rating-percent')).toHaveText('72%');
    await expect(panel.getByTestId('mean-agents')).toContainText('72%');

    await agentRow.getByTestId('evidence-chip').filter({ hasText: 'Evaluation' }).click();
    // The demo build shows an explainer in place of the Training studio, so the
    // route is the assertion here; e2e/live/social.spec.ts follows it for real.
    await expect(page).toHaveURL(/#\/training\?tab=evaluation&episode=demo-eval-1/);
  });

  test('a comment appears in the thread and on the activity feed', async ({ page }) => {
    const panel = page.getByRole('region', { name: 'Dataset discussion' });
    await panel.getByRole('textbox', { name: 'Add a comment' }).fill('Episode 1 needs a re-take.');
    await panel.getByRole('button', { name: 'Comment' }).click();
    await expect(panel.getByTestId('comment').filter({ hasText: 'Episode 1 needs a re-take.' })).toBeVisible();

    // A hash change, not page.goto: a full load would reset the MSW store.
    await page.evaluate(() => {
      window.location.hash = '#/activity';
    });
    const feed = page.getByTestId('activity-feed');
    await expect(feed).toContainText('Episode 1 needs a re-take.');
    await expect(feed).toContainText('eval-agent');
  });
});
