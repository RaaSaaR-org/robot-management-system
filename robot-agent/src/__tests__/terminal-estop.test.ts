/**
 * @file terminal-estop.test.ts
 * @description Covers the terminal keypress E-Stop — the third trigger the Agent Mode
 *   safety contract promises next to the UI button and the spoken stop word.
 * @feature agent-mode
 */

import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentModeController } from '../agent-mode/agent-mode-controller.js';
import { startTerminalEstop } from '../terminal-estop.js';

/** A stdin double that reports as a TTY and records raw-mode transitions. */
class FakeTTY extends EventEmitter {
  isTTY = true;
  rawModeCalls: boolean[] = [];
  resumed = 0;
  paused = 0;

  setRawMode(on: boolean): this {
    this.rawModeCalls.push(on);
    return this;
  }
  resume(): this {
    this.resumed += 1;
    return this;
  }
  pause(): this {
    this.paused += 1;
    return this;
  }
  press(key: string): void {
    this.emit('data', Buffer.from(key, 'utf8'));
  }
}

const asStdin = (t: FakeTTY): NodeJS.ReadStream => t as unknown as NodeJS.ReadStream;

describe('startTerminalEstop', () => {
  let estop: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    estop = vi
      .spyOn(agentModeController, 'estop')
      .mockResolvedValue({ ok: true as const, stopped: true, delivered: true });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does nothing when stdin is not a TTY — the systemd/Docker case', () => {
    const notATty = new FakeTTY();
    notATty.isTTY = false;

    expect(startTerminalEstop(asStdin(notATty))).toBeNull();
    expect(notATty.rawModeCalls).toEqual([]);
  });

  it.each([
    ['SPACE', ' '],
    ['ESC', '\u001b'],
  ])('%s triggers the E-Stop', async (_name, key) => {
    const tty = new FakeTTY();
    const handle = startTerminalEstop(asStdin(tty));

    tty.press(key);
    await vi.waitFor(() => expect(estop).toHaveBeenCalledTimes(1));
    expect(estop).toHaveBeenCalledWith('Terminal E-Stop key');

    handle?.dispose();
  });

  it('ignores keys that are not the stop key', () => {
    const tty = new FakeTTY();
    const handle = startTerminalEstop(asStdin(tty));

    for (const key of ['a', 'q', '\r', 'x']) tty.press(key);

    expect(estop).not.toHaveBeenCalled();
    handle?.dispose();
  });

  it('re-raises Ctrl+C, because raw mode swallows SIGINT', () => {
    const tty = new FakeTTY();
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
    const handle = startTerminalEstop(asStdin(tty));

    tty.press('\u0003');

    expect(kill).toHaveBeenCalledWith(process.pid, 'SIGINT');
    expect(estop).not.toHaveBeenCalled();
    handle?.dispose();
  });

  it('reports a failed stop instead of swallowing it', async () => {
    const tty = new FakeTTY();
    estop.mockRejectedValue(new Error('sidecar unreachable'));
    const handle = startTerminalEstop(asStdin(tty));

    tty.press(' ');

    await vi.waitFor(() =>
      expect(console.error).toHaveBeenCalledWith(
        '[AgentMode] E-STOP FAILED — the robot may still be moving:',
        expect.any(Error),
      ),
    );
    handle?.dispose();
  });

  it('restores cooked mode on dispose, and dispose is idempotent', () => {
    const tty = new FakeTTY();
    const handle = startTerminalEstop(asStdin(tty));
    expect(tty.rawModeCalls).toEqual([true]);

    handle?.dispose();
    handle?.dispose();

    expect(tty.rawModeCalls).toEqual([true, false]);
    expect(tty.paused).toBe(1);
    expect(tty.listenerCount('data')).toBe(0);
  });

  it('no longer stops the robot after dispose', () => {
    const tty = new FakeTTY();
    const handle = startTerminalEstop(asStdin(tty));
    handle?.dispose();

    tty.press(' ');

    expect(estop).not.toHaveBeenCalled();
  });
});
