/**
 * @file agent-mode.spec.ts
 * @description Functional test: Agent Mode page plans a command into blocks,
 *              animates the block bar and aborts on STOPP (TASK-194).
 */
import { test, expect, type Page } from '@playwright/test';

// baseURL comes from playwright.config.ts (demo mode uses HashRouter)

const COMMAND = 'geh zum Tisch mit dem Hut';

async function openAgentMode(page: Page) {
  await page.goto(`/#/agent`);
  await page.waitForSelector('text=Agent Mode', { timeout: 15_000 });
  // Robot list arrives from MSW before the page binds to a robot.
  await expect(page.getByTestId('agent-robot-select')).not.toHaveValue('', {
    timeout: 10_000,
  });
}

async function sendCommand(page: Page) {
  const input = page.getByTestId('agent-command-input');
  await expect(input).toBeEnabled({ timeout: 10_000 });
  await input.fill(COMMAND);
  await page.getByTestId('agent-send-button').click();
}

test.describe('Agent Mode page', () => {
  test('renders the cockpit with timeline, chat and scene memory', async ({ page }) => {
    await openAgentMode(page);

    await expect(page.getByTestId('agent-block-timeline')).toBeVisible();
    await expect(page.getByTestId('agent-chat')).toBeVisible();
    await expect(page.getByTestId('agent-scene-panel')).toBeVisible();
    await expect(page.getByTestId('agent-stop-button')).toHaveText('STOPP');

    // No plan yet
    await expect(page.getByTestId('agent-block-timeline')).toHaveAttribute(
      'data-plan-status',
      'none'
    );
    await expect(page.locator('text=No active plan')).toBeVisible();
  });

  test('scene panel lists the remembered entities', async ({ page }) => {
    await openAgentMode(page);

    const panel = page.getByTestId('agent-scene-panel');
    const entities = panel.getByTestId('agent-scene-entity');
    await expect(entities.first()).toBeVisible({ timeout: 10_000 });

    // The demo scene memory holds the room the G1 scanned earlier.
    await expect(panel.locator('text=Tisch').first()).toBeVisible();
    await expect(panel.locator('text=Stuhl').first()).toBeVisible();
    await expect(panel.locator('text=Person').first()).toBeVisible();
    expect(await entities.count()).toBeGreaterThanOrEqual(3);
  });

  test('sending a command renders block cards under it and runs them', async ({ page }) => {
    await openAgentMode(page);
    await sendCommand(page);

    // The utterance is echoed as a user message
    await expect(page.getByTestId('agent-user-message').first()).toHaveText(COMMAND);

    // Blocks appear inline under the command that produced them
    const cards = page.getByTestId('agent-block-card');
    await expect(cards.first()).toBeVisible({ timeout: 10_000 });
    expect(await cards.count()).toBe(6);

    // The planned sequence: scan_room → turn → walk → look → walk → speak
    await expect(cards.nth(0)).toHaveAttribute('data-block-kind', 'scan_room');
    await expect(cards.nth(1)).toHaveAttribute('data-block-kind', 'turn');
    await expect(cards.nth(2)).toHaveAttribute('data-block-kind', 'walk');
    await expect(cards.nth(3)).toHaveAttribute('data-block-kind', 'look');
    await expect(cards.nth(5)).toHaveAttribute('data-block-kind', 'speak');

    // Blocks actually progress to done and the plan finishes
    await expect(cards.nth(0)).toHaveAttribute('data-block-status', 'done', {
      timeout: 15_000,
    });
    await expect(page.getByTestId('agent-block-timeline')).toHaveAttribute(
      'data-plan-status',
      'done',
      { timeout: 20_000 }
    );

    // The `look` block wrote the hat into scene memory
    await expect(
      page.getByTestId('agent-scene-panel').locator('text=Hut').first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test('the block bar shows the running block and what comes next', async ({ page }) => {
    await openAgentMode(page);
    await sendCommand(page);

    const timeline = page.getByTestId('agent-block-timeline');
    await expect(timeline).toHaveAttribute('data-plan-status', 'running', {
      timeout: 10_000,
    });
    await expect(timeline.getByTestId('agent-current-block')).toBeVisible();
    await expect(timeline.getByTestId('agent-upcoming-block').first()).toBeVisible();
  });

  test('STOPP aborts the running plan and latches the E-Stop', async ({ page }) => {
    await openAgentMode(page);
    await sendCommand(page);

    // Wait until a block is actually running before stopping
    await expect(page.getByTestId('agent-block-timeline')).toHaveAttribute(
      'data-plan-status',
      'running',
      { timeout: 10_000 }
    );

    await page.getByTestId('agent-stop-button').click();

    await expect(page.getByTestId('agent-block-timeline')).toHaveAttribute(
      'data-plan-status',
      'aborted',
      { timeout: 10_000 }
    );
    // The plan only turns aborted because the agent acknowledged the stop —
    // an unacknowledged one keeps the banner in its "not confirmed" state.
    await expect(page.getByTestId('agent-estop-banner')).toBeVisible();
    await expect(page.getByTestId('agent-estop-banner')).toHaveAttribute(
      'data-estop-status',
      'acknowledged'
    );
    await expect(page.locator('text=E-Stop latched')).toBeVisible();

    // Pending blocks are marked skipped, not silently left running
    await expect(
      page.locator('[data-testid="agent-block-card"][data-block-status="skipped"]').first()
    ).toBeVisible({ timeout: 5_000 });

    // The plan stays aborted — no block resumes after the stop
    await page.waitForTimeout(3_000);
    await expect(page.getByTestId('agent-block-timeline')).toHaveAttribute(
      'data-plan-status',
      'aborted'
    );

    // The command input is refused while the latch is set
    await expect(page.getByTestId('agent-command-input')).toBeDisabled();

    // …and the operator can clear it again
    await page.getByTestId('agent-estop-reset').click();
    await expect(page.getByTestId('agent-estop-banner')).toBeHidden({ timeout: 10_000 });
    await expect(page.getByTestId('agent-command-input')).toBeEnabled();
  });
});
