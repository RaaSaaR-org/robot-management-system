/**
 * @file vrUrls.test.ts
 * @description TASK-393: the teleop socket goes through the server's
 *              same-origin proxy by default, carries the access token in the
 *              subprotocol (never the URL), and can still go direct.
 * @feature robots
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  getTeleopSocketUrl,
  teleopSocketProtocols,
  DEFAULT_AGENT_URL,
  TELEOP_SUBPROTOCOL,
} from '../vrUrls';

const robot = { id: 'g1 edu/1', a2aAgentUrl: 'http://10.0.0.5:41245/' };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getTeleopSocketUrl', () => {
  it('uses the page origin and the robot id, escaped', () => {
    vi.stubEnv('VITE_WS_URL', '');
    vi.stubEnv('VITE_API_BASE_URL', '');
    const url = getTeleopSocketUrl(robot, false);
    expect(url).toBe(`ws://${window.location.host}/api/robots/g1%20edu%2F1/teleop/ws`);
  });

  it('goes straight to the agent in direct mode', () => {
    expect(getTeleopSocketUrl(robot, true)).toBe('ws://10.0.0.5:41245/ws/keyboard-teleop');
    expect(getTeleopSocketUrl({ id: 'x' }, true)).toBe(`${DEFAULT_AGENT_URL.replace('http', 'ws')}/ws/keyboard-teleop`);
  });

  it('is direct only when VITE_TELEOP_DIRECT says so', () => {
    vi.stubEnv('VITE_TELEOP_DIRECT', 'true');
    expect(getTeleopSocketUrl(robot)).toBe('ws://10.0.0.5:41245/ws/keyboard-teleop');
  });
});

describe('teleopSocketProtocols', () => {
  it('offers the teleop protocol, with the token as a second entry when signed in', () => {
    expect(teleopSocketProtocols('a.b.c', false)).toEqual([TELEOP_SUBPROTOCOL, 'bearer.a.b.c']);
    expect(teleopSocketProtocols(null, false)).toEqual([TELEOP_SUBPROTOCOL]);
  });

  it('offers nothing to the agent directly — it selects no protocol', () => {
    expect(teleopSocketProtocols('a.b.c', true)).toBeUndefined();
  });
});
