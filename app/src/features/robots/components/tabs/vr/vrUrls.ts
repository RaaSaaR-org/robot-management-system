/**
 * @file vrUrls.ts
 * @description Resolves where the teleop socket lives: the server's same-origin
 *              proxy by default (TASK-393), the robot agent directly as a
 *              fallback. Also the subprotocols that carry the access token.
 * @feature robots
 */

import { tokenStorage } from '@/api/client';
import { getWebSocketUrl } from '@/shared/utils/websocket';
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

/** The subprotocol the server's teleop proxy selects. */
export const TELEOP_SUBPROTOCOL = 'neodem.teleop';

/** `server/src/websocket/teleopProxy.ts` reads the token from `bearer.<token>`. */
const TOKEN_PROTOCOL_PREFIX = 'bearer.';

type RobotAddress = Pick<TeleopTabProps['robot'], 'a2aAgentUrl'>;

export function getAgentBaseUrl(robot: RobotAddress): string {
  if (robot.a2aAgentUrl) return robot.a2aAgentUrl.replace(/\/$/, '');
  return DEFAULT_AGENT_URL;
}

export function getWsBaseUrl(robot: RobotAddress): string {
  return getAgentBaseUrl(robot).replace(/^http/, 'ws');
}

/**
 * Whether teleop goes straight to the agent instead of through the server.
 *
 * Off by default. The direct socket is what broke on the Quest: over
 * `adb reverse` only the page's port is forwarded, over Tailscale the agent's
 * LAN address is not routable, and on an https page `ws://` is mixed content.
 * Kept as a fallback (`VITE_TELEOP_DIRECT=true`) for a deployment whose server
 * cannot reach its agents but whose browsers can.
 */
export function teleopDirect(): boolean {
  return import.meta.env.VITE_TELEOP_DIRECT === 'true';
}

/**
 * The teleop socket URL for a robot.
 *
 * Through the server by default: `/api/robots/:id/teleop/ws` on the page's own
 * origin (the Vite dev proxy forwards `/api` WebSockets), so the headset needs
 * nothing but the page. Direct to the agent when {@link teleopDirect}.
 */
export function getTeleopSocketUrl(
  robot: Pick<TeleopTabProps['robot'], 'id' | 'a2aAgentUrl'>,
  direct: boolean = teleopDirect(),
): string {
  if (direct) return `${getWsBaseUrl(robot)}/ws/keyboard-teleop`;
  return getWebSocketUrl(`/api/robots/${encodeURIComponent(robot.id)}/teleop/ws`);
}

/**
 * Subprotocols to open the teleop socket with.
 *
 * The access token rides here because a browser cannot set an `Authorization`
 * header on a WebSocket and the token must never be in the URL. A JWT's
 * base64url segments and dots are all valid subprotocol characters. Under
 * `AUTH_DISABLED` there is no token and the server needs none. The direct
 * socket takes no protocols: the agent selects none, and a browser fails a
 * handshake that offered protocols and got none back.
 */
export function teleopSocketProtocols(
  accessToken: string | null,
  direct: boolean = teleopDirect(),
): string[] | undefined {
  if (direct) return undefined;
  return accessToken ? [TELEOP_SUBPROTOCOL, `${TOKEN_PROTOCOL_PREFIX}${accessToken}`] : [TELEOP_SUBPROTOCOL];
}

/**
 * Open a robot's teleop socket the way every console should: through the
 * server, with the current access token in the subprotocol.
 */
export function openTeleopSocket(robot: Pick<TeleopTabProps['robot'], 'id' | 'a2aAgentUrl'>): WebSocket {
  return new WebSocket(getTeleopSocketUrl(robot), teleopSocketProtocols(tokenStorage.getAccessToken()));
}
