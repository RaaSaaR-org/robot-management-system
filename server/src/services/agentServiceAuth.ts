/**
 * @file agentServiceAuth.ts
 * @description How the SERVER authenticates itself to a robot-agent's
 *              personal-data routes: the shared `AGENT_MEMORY_TOKEN` secret and
 *              the request headers that carry it.
 * @feature agentmode
 *
 * The robot-agent gates everything that serves or destroys personal data
 * (`personalDataGate` in `robot-agent/src/api/rest-routes.ts`): `MEMORY.md`, the
 * memory digest, the standing intents, the erasure route — and, since round 3,
 * `GET /robots/:id/agent-mode`, which carries the operator's own words in the
 * plan. Off-box callers must present this token as a bearer; with the variable
 * unset the agent answers LOOPBACK callers only.
 *
 * That default is why this module exists as its own thing rather than as one
 * more literal at a call site: on a single box every server→agent call is
 * loopback and passes the gate without a token, so a forgotten header is
 * invisible in dev and 401s only on a split-host deployment. Every server-side
 * client that talks to a gated agent route builds its headers here.
 */

/**
 * The robot agents' `AGENT_MEMORY_TOKEN` — the same variable name on both sides.
 * If the name changes on either side, change it on the other (each names the
 * other).
 */
export const AGENT_SERVICE_TOKEN_ENV = 'AGENT_MEMORY_TOKEN';

/**
 * The configured shared secret, or `''` when there is none.
 *
 * Read from `process.env` per call rather than captured at import: rotating the
 * secret must not require a server restart, and a test must be able to turn it
 * on and off.
 */
export function agentServiceToken(): string {
  return process.env[AGENT_SERVICE_TOKEN_ENV] ?? '';
}

/**
 * `Authorization` header for a server→agent call, or `{}` when no secret is
 * configured — in which case the agent answers loopback callers only, which is
 * exactly the single-box dev setup.
 */
export function agentServiceAuthHeaders(): Record<string, string> {
  const token = agentServiceToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
