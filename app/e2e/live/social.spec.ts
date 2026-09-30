/**
 * @file social.spec.ts
 * @description Live: a comment on a dataset survives a full reload, and an
 *   agent rating's evidence chip leads to the evaluation tab (TASK-241).
 *   Needs a running stack with AUTH_DISABLED=true (the viewer is the `system`
 *   actor `dev`, which may speak as an agent through X-Agent-Name), at least
 *   one dataset, one EvaluationEpisode and an AgentCard named by
 *   SOCIAL_AGENT_NAME (default `eval-agent`).
 *   LIVE_API_URL defaults to http://localhost:3001/api.
 */
import { test, expect } from '@playwright/test';

const API = process.env.LIVE_API_URL || 'http://localhost:3001/api';
const AGENT = process.env.SOCIAL_AGENT_NAME || 'eval-agent';

test.describe('Dataset discussion (live)', () => {
  test('a comment survives a reload, and an agent chip opens the evaluation', async ({ page, request }) => {
    const datasets = await (await request.get(`${API}/datasets`)).json();
    const dataset = (datasets.datasets ?? []).find((d: { kind?: string }) => d.kind !== 'view');
    test.skip(!dataset, 'no dataset on this stack');

    const body = `live comment ${Date.now()}`;
    // The dev server uses BrowserRouter, so no `#/` here (the demo build hashes).
    await page.goto(`/datasets/${dataset.id}/episodes`);
    const panel = page.getByRole('region', { name: 'Dataset discussion' });
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await panel.getByRole('textbox', { name: 'Add a comment' }).fill(body);
    await panel.getByRole('button', { name: 'Comment' }).click();
    await expect(panel.getByTestId('comment').filter({ hasText: body })).toBeVisible();

    await page.reload();
    await expect(page.getByRole('region', { name: 'Dataset discussion' }).getByTestId('comment').filter({ hasText: body })).toBeVisible({
      timeout: 15_000,
    });

    // An agent rating with evidence, written through the API as the agent would.
    const evals = await (await request.get(`${API}/evaluation/episodes?limit=1`)).json();
    const evalId: string | undefined = (evals.episodes ?? [])[0]?.id;
    test.skip(!evalId, 'no evaluation episode on this stack');
    const put = await request.put(`${API}/social/dataset/${dataset.id}/rating`, {
      headers: { 'X-Agent-Name': AGENT },
      data: { score: 0.64, evidence: [{ kind: 'evaluation_episode', ids: [evalId] }] },
    });
    expect(put.ok(), await put.text()).toBeTruthy();

    await page.reload();
    const agentRow = page.getByTestId('rating-row').filter({ hasText: AGENT });
    await expect(agentRow.getByTestId('rating-percent')).toHaveText('64%', { timeout: 15_000 });
    await agentRow.getByTestId('evidence-chip').click();
    await expect(page).toHaveURL(new RegExp(`tab=evaluation&episode=${evalId}`));
    await expect(page.getByRole('tab', { name: 'Evaluation', selected: true })).toBeVisible();
  });
});
