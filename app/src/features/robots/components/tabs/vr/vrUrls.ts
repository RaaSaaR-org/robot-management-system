/**
 * @file vrUrls.ts
 * @description Resolves the robot agent's HTTP/WebSocket base URLs for VR teleop.
 * @feature robots
 */

import type { TeleopTabProps } from '../types';

/**
 * Where a robot agent listens when the record carries no `a2aAgentUrl`.
 *
 * 41243 is the agent's own default (`robot-agent/src/config/config.ts`, and the
 * component table in CLAUDE.md). This constant exists because the fallback was
 * written as 41245 — a port nothing listens on — so a robot without an explicit
 * agent URL could never connect, and the modal sat on "Disconnected" with no
 * error to explain it.
 */
export const DEFAULT_AGENT_URL = 'http://localhost:41243';

export function getAgentBaseUrl(robot: TeleopTabProps['robot']): string {
  if (robot.a2aAgentUrl) return robot.a2aAgentUrl.replace(/\/$/, '');
  return DEFAULT_AGENT_URL;
}

export function getWsBaseUrl(robot: TeleopTabProps['robot']): string {
  return getAgentBaseUrl(robot).replace(/^http/, 'ws');
}
