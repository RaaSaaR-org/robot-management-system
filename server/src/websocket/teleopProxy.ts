/**
 * @file teleopProxy.ts
 * @description Same-origin teleop socket (TASK-393): `/api/robots/:id/teleop/ws`
 *              on the server, piped frame for frame to the robot agent's
 *              `/ws/keyboard-teleop`. Authenticated at the upgrade, before a
 *              single frame can reach the robot.
 * @feature robots
 *
 * WHY A PROXY. The VR console used to open the agent's socket directly, at the
 * robot's `a2aAgentUrl`. Three ways that breaks, all of which a Quest operator
 * hits:
 *
 *  - over `adb reverse`, only the page's port is forwarded. `localhost:1420`
 *    inside the headset reaches the workstation; `localhost:41243` reaches the
 *    headset itself;
 *  - over Tailscale or any NAT the agent's LAN address is not routable;
 *  - on an https page, a `ws://` socket is mixed content and the browser
 *    refuses it outright — and https (or localhost) is what WebXR requires.
 *
 * Through the page's own origin the headset needs exactly one forwarded port,
 * and the socket inherits the page's scheme. The Vite dev server proxies `/api`
 * with `ws: true`, so in development the same path works from :1420.
 *
 * AUTH. A browser cannot set an `Authorization` header on a WebSocket, and the
 * token must never be in the URL (TASK-366: URLs are logged and proxied). It
 * rides in `Sec-WebSocket-Protocol` instead — the one header a page may set —
 * as `bearer.<token>` next to the `neodem.teleop` protocol the server selects.
 * Under `AUTH_DISABLED=true` no token is needed, as everywhere else.
 *
 * Towards the agent the server presents `AGENT_MEMORY_TOKEN`, like every other
 * server→agent call (`agentServiceAuth.ts`).
 */

import type { IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import { identityFromToken, mayObserveTenant, type AccessTokenVerifier, type SocketIdentity } from './socketIdentity.js';
import { DEFAULT_TENANT_ID } from '../config/features.js';

/** `/api/robots/:id/teleop/ws`. */
export const TELEOP_WS_PATH = /^\/api\/robots\/([^/]+)\/teleop\/ws\/?$/;
/** The subprotocol the server selects; the client offers it first. */
export const TELEOP_SUBPROTOCOL = 'neodem.teleop';
/** Prefix of the subprotocol entry that carries the access token. */
export const TELEOP_TOKEN_PROTOCOL_PREFIX = 'bearer.';
/** Same ceiling the agent applies (`keyboard-teleop.ts` MAX_PAYLOAD_BYTES). */
const MAX_PAYLOAD_BYTES = 64 * 1024;
/**
 * Frames held while the agent socket is still opening. A client that streams
 * at 50 Hz into an agent that never answers would otherwise grow this forever;
 * past the bound the client is closed rather than fed a stale backlog.
 */
const MAX_PENDING_FRAMES = 64;

/** One path on the shared HTTP server's upgrade dispatcher. */
export interface UpgradeRoute {
  matches(pathname: string): boolean;
  handle(req: IncomingMessage, socket: Duplex, head: Buffer): void;
}

export interface TeleopProxyDeps {
  /** The robot's agent base URL and tenant, or null when there is no such robot. */
  resolveRobot(robotId: string): Promise<{ baseUrl: string; tenantId: string | null } | null>;
  verifyAccessToken: AccessTokenVerifier;
  /** `AUTH_DISABLED=true`; read per upgrade. */
  authDisabled(): boolean;
  /** Headers the server presents to the agent (`AGENT_MEMORY_TOKEN`). */
  agentHeaders(): Record<string, string>;
  /** Opens the agent socket; injectable for tests. */
  connectUpstream?(url: string, headers: Record<string, string>): WebSocket;
  /**
   * TASK-416: the browser just sent an E-stop for `robotId` (the headset's B/Y).
   * Told after the frame is forwarded, never instead of it.
   */
  onEStop?(robotId: string): void;
}

/** `"estop"` as a JSON key — `{ "estop": { "reason": … } }` is the client's E-stop frame. */
const ESTOP_KEY = Buffer.from('"estop"');

/** Whether a text frame from the browser carries an E-stop. Cheap: no parse. */
export function isEStopFrame(data: RawData, isBinary: boolean): boolean {
  if (isBinary) return false;
  if (Buffer.isBuffer(data)) return data.includes(ESTOP_KEY);
  if (Array.isArray(data)) return data.some((b) => b.includes(ESTOP_KEY));
  return Buffer.from(data).includes(ESTOP_KEY);
}

const DEV_IDENTITY: SocketIdentity = { userId: 'dev-user-id', role: 'super-admin', tenantId: DEFAULT_TENANT_ID };

/** Roles that may never drive a robot. */
const READ_ONLY_ROLES = new Set(['viewer']);

/** The offered subprotocols, as the header lists them. */
function offeredProtocols(req: IncomingMessage): string[] {
  const raw = req.headers['sec-websocket-protocol'];
  const joined = Array.isArray(raw) ? raw.join(',') : raw ?? '';
  return joined.split(',').map((p) => p.trim()).filter(Boolean);
}

/** The access token offered as `bearer.<token>`, or null. */
export function tokenFromProtocols(protocols: readonly string[]): string | null {
  const entry = protocols.find((p) => p.startsWith(TELEOP_TOKEN_PROTOCOL_PREFIX));
  if (!entry) return null;
  const token = entry.slice(TELEOP_TOKEN_PROTOCOL_PREFIX.length);
  return token.length > 0 ? token : null;
}

/** `http://host:41243/` → `ws://host:41243/ws/keyboard-teleop`. */
export function agentTeleopUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  return `${trimmed.replace(/^http/i, 'ws')}/ws/keyboard-teleop`;
}

/** Refuse an upgrade with a plain HTTP status — no handshake, no frames. */
function refuse(socket: Duplex, status: number, reason: string): void {
  if (socket.destroyed) return;
  try {
    socket.write(
      `HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Type: text/plain\r\n` +
        `Content-Length: ${Buffer.byteLength(reason)}\r\n\r\n${reason}`,
    );
  } finally {
    socket.destroy();
  }
}

/** Close codes 1005/1006/1015 are reserved and may not be sent. */
function sendableCloseCode(code: number): number {
  if (code === 1005 || code === 1006 || code === 1015 || code < 1000 || code >= 5000) return 1011;
  return code;
}

/**
 * Pipe one browser socket to one agent socket, both directions, and tear both
 * down together. Text stays text: the agent speaks JSON frames and the
 * browser's `onmessage` must keep getting strings.
 */
export function bridgeSockets(client: WebSocket, upstream: WebSocket, onEStop?: () => void): void {
  const pending: Array<{ data: RawData; isBinary: boolean }> = [];
  let closed = false;

  const closeBoth = (code: number, reason: string): void => {
    if (closed) return;
    closed = true;
    const sendable = sendableCloseCode(code);
    if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) {
      client.close(sendable, reason.slice(0, 120));
    }
    if (upstream.readyState === WebSocket.OPEN) upstream.close(sendable === 1011 ? 1000 : sendable, 'client gone');
    else if (upstream.readyState === WebSocket.CONNECTING) upstream.terminate();
  };

  client.on('message', (data: RawData, isBinary: boolean) => {
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.send(data, { binary: isBinary });
    } else if (upstream.readyState === WebSocket.CONNECTING) {
      if (pending.length >= MAX_PENDING_FRAMES) {
        closeBoth(1013, 'the robot agent is not answering');
        return;
      }
      pending.push({ data, isBinary });
    }
    if (onEStop && isEStopFrame(data, isBinary)) {
      try {
        onEStop();
      } catch (err) {
        console.warn(`[TeleopProxy] E-stop listener failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  });
  upstream.on('open', () => {
    for (const frame of pending.splice(0)) upstream.send(frame.data, { binary: frame.isBinary });
  });
  upstream.on('message', (data: RawData, isBinary: boolean) => {
    if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
  });
  upstream.on('close', (code: number, reason: Buffer) => {
    closeBoth(code, reason.toString() || 'the robot agent closed the teleop socket');
  });
  upstream.on('error', (err: Error) => {
    console.warn(`[TeleopProxy] agent socket error: ${err.message}`);
    closeBoth(1011, 'cannot reach the robot agent');
  });
  client.on('close', (code: number) => closeBoth(code, 'client gone'));
  client.on('error', () => closeBoth(1011, 'client error'));
}

/**
 * The `/api/robots/:id/teleop/ws` route for the shared upgrade dispatcher.
 */
export function createTeleopProxy(deps: TeleopProxyDeps): UpgradeRoute {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_PAYLOAD_BYTES,
    // Select our protocol when offered; never echo the token entry back.
    handleProtocols: (protocols) => (protocols.has(TELEOP_SUBPROTOCOL) ? TELEOP_SUBPROTOCOL : false),
  });
  const connectUpstream = deps.connectUpstream
    ?? ((url: string, headers: Record<string, string>) => new WebSocket(url, { headers, maxPayload: MAX_PAYLOAD_BYTES }));

  const identify = (req: IncomingMessage): SocketIdentity | null => {
    if (deps.authDisabled()) return DEV_IDENTITY;
    return identityFromToken(tokenFromProtocols(offeredProtocols(req)), deps.verifyAccessToken);
  };

  return {
    matches: (pathname: string) => TELEOP_WS_PATH.test(pathname),
    handle(req: IncomingMessage, socket: Duplex, head: Buffer): void {
      socket.on('error', () => socket.destroy());
      let robotId: string;
      try {
        const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
        const match = TELEOP_WS_PATH.exec(pathname);
        if (!match) return refuse(socket, 404, 'Not Found');
        robotId = decodeURIComponent(match[1]);
      } catch {
        return refuse(socket, 400, 'Bad Request');
      }

      const identity = identify(req);
      if (!identity) return refuse(socket, 401, 'Unauthorized');
      if (READ_ONLY_ROLES.has(identity.role)) return refuse(socket, 403, 'Forbidden');

      void deps.resolveRobot(robotId).then(
        (robot) => {
          // A robot of another tenant answers exactly like one that does not
          // exist: the route must not confirm which ids are real.
          if (!robot || !mayObserveTenant(identity, robot.tenantId)) return refuse(socket, 404, 'Robot not found');
          if (socket.destroyed) return;
          wss.handleUpgrade(req, socket, head, (client) => {
            const url = agentTeleopUrl(robot.baseUrl);
            let upstream: WebSocket;
            try {
              upstream = connectUpstream(url, deps.agentHeaders());
            } catch (err) {
              console.warn(`[TeleopProxy] cannot open ${url}: ${err instanceof Error ? err.message : String(err)}`);
              client.close(1011, 'cannot reach the robot agent');
              return;
            }
            console.log(`[TeleopProxy] ${identity.userId} → robot ${robotId} (${url})`);
            bridgeSockets(client, upstream, deps.onEStop ? () => deps.onEStop!(robotId) : undefined);
          });
        },
        (err: unknown) => {
          console.error('[TeleopProxy] robot lookup failed:', err);
          refuse(socket, 500, 'Internal Server Error');
        },
      );
    },
  };
}

/**
 * One `upgrade` listener for the whole HTTP server.
 *
 * `ws` servers attached with `{ server }` each answer EVERY upgrade, and abort
 * the ones whose path they do not own with a 400 — so a second endpoint on the
 * same port is impossible that way. Same fix the robot agent made (its
 * `index.ts` dispatcher).
 */
export function attachUpgradeRoutes(
  server: { on(event: 'upgrade', listener: (req: IncomingMessage, socket: Duplex, head: Buffer) => void): unknown },
  routes: readonly UpgradeRoute[],
): void {
  server.on('upgrade', (req, socket, head) => {
    let pathname = '/';
    try {
      pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    } catch {
      socket.destroy();
      return;
    }
    const route = routes.find((r) => r.matches(pathname));
    if (!route) {
      refuse(socket, 404, 'Not Found');
      return;
    }
    route.handle(req, socket, head);
  });
}
