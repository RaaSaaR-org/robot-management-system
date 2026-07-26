/**
 * @file terminal-estop.ts
 * @description Terminal keypress E-Stop for Agent Mode — the third trigger next to the
 *   UI button and the spoken stop word.
 * @feature agent-mode
 *
 * Agent Mode ships with a manual E-Stop as its ONLY safety mechanism (TASK-194, a
 * deliberate deviation from `hardware/real_g1_bridge/README.md`). Whoever runs the agent
 * from a terminal is usually the person standing next to the robot, so that terminal has
 * to be a working stop button — not just a log tail.
 *
 * Deliberately blunt:
 *   - SPACE or ESC stop. Both, because under stress people reach for whichever they know,
 *     and for a stop an accidental trigger is the safe direction to fail in.
 *   - No key resets the latch. Recovery stays an explicit, considered act (UI or REST),
 *     so a stray keystroke can never re-arm a robot nobody is looking at.
 *   - Ctrl+C keeps working. Raw mode swallows SIGINT, so we re-raise it by hand;
 *     losing the ability to kill the process would trade one hazard for another.
 *
 * No-ops when stdin is not a TTY, which is the normal case under systemd and Docker.
 */

import { agentModeController } from './agent-mode/agent-mode-controller.js';

/** Keys that trigger the stop: SPACE and ESC. */
const ESTOP_KEYS = new Set([' ', '\u001b']);
const CTRL_C = '\u0003';

export interface TerminalEstop {
  /** Restore the terminal. Safe to call more than once. */
  dispose(): void;
}

/**
 * Wire the terminal's stop key to {@link agentModeController.estop}.
 *
 * @param stdin - injectable for tests; defaults to `process.stdin`.
 * @returns a handle whose `dispose()` restores cooked mode, or `null` when stdin is not
 *   an interactive TTY and no key handling is possible.
 */
export function startTerminalEstop(
  stdin: NodeJS.ReadStream = process.stdin,
): TerminalEstop | null {
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
    return null;
  }

  const onData = (chunk: Buffer | string): void => {
    const key = chunk.toString('utf8');

    if (key === CTRL_C) {
      // Raw mode means the terminal no longer turns Ctrl+C into SIGINT for us.
      process.kill(process.pid, 'SIGINT');
      return;
    }

    if (!ESTOP_KEYS.has(key)) return;

    console.log('\n[AgentMode] ⏹  TERMINAL E-STOP');
    void agentModeController
      .estop('Terminal E-Stop key')
      .then((r) => {
        console.log(
          r.stopped
            ? '[AgentMode] E-Stop latched — running plan aborted, robot damped.'
            : '[AgentMode] E-Stop latched — no plan was running.',
        );
      })
      .catch((error: unknown) => {
        // Never swallow this: the operator pressed stop and must learn it did not take.
        console.error('[AgentMode] E-STOP FAILED — the robot may still be moving:', error);
      });
  };

  stdin.setRawMode(true);
  stdin.resume();
  stdin.on('data', onData);

  console.log('[AgentMode] Terminal E-Stop armed — press SPACE or ESC to stop the robot');

  let disposed = false;
  return {
    dispose(): void {
      if (disposed) return;
      disposed = true;
      stdin.off('data', onData);
      if (stdin.isTTY) stdin.setRawMode(false);
      stdin.pause();
    },
  };
}
