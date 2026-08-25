/**
 * @file vitest.setup.ts
 * @description Binds every ephemeral test server to loopback, so a throwaway
 *              port cannot collide with a foreign IPv4 listener (TASK-218).
 * @feature testing
 */

import net from 'node:net';

/**
 * The whole of the fix, and why it is here rather than at the call sites.
 *
 * These suites start a throwaway HTTP server with `listen(0)` and then talk to
 * it at `http://127.0.0.1:<port>`. `supertest` does exactly that inside
 * `Test.serverAddress`, and the robot-agent's route tests do it by hand with
 * `fetch`.
 *
 * `listen(0)` with no host binds the DUAL-STACK wildcard `::`, and macOS picks
 * the port by looking for a free one in the IPv6 table. A port another process
 * already holds on IPv4 — tailscaled's LocalAPI, a stray socket left behind by
 * a dead process — is therefore handed out as "free". The bind succeeds and
 * `address().port` reports that port, but the IPv4 connect that follows is
 * delivered to the OTHER listener. The test then reads a stranger's answer:
 *
 *   - tailscaled replies `401 auth required` to every path, so the test sees
 *     `expected 401 to be 200` (or 400, or 500, or 201) in whichever route file
 *     happened to draw that port;
 *   - a squatter that never `accept()`s leaves the connect in SYN_RCVD until it
 *     gives up, which supertest reports as `ETIMEDOUT: Operation timed out`.
 *
 * Neither depends on the test, which is why the victim moved from run to run
 * and why the file passed when run on its own — one worker instead of
 * seventeen draws far fewer ports.
 *
 * Binding `127.0.0.1` makes the kernel choose a port that is free in the same
 * address family the client actually uses, so the collision cannot happen.
 * Measured on a box carrying two such squatters: the wildcard `listen(0)` drew
 * both inside 6000 attempts; a loopback bind drew neither.
 *
 * Patched on the prototype because the worst offender is inside supertest,
 * where there is no host argument to pass. Only the ephemeral-port-with-no-host
 * case is touched — an explicit port or an explicit host is left exactly as
 * written, so a test that means to bind a fixed port still fails loudly.
 */
const LOOPBACK = '127.0.0.1';
const IPV4 = 4;

/** The arguments of a `listen()` that would draw an ephemeral wildcard port. */
interface EphemeralListen {
  backlog?: number;
  callback?: () => void;
}

function ephemeralWildcard(args: readonly unknown[]): EphemeralListen | null {
  const [first, ...rest] = args;

  // listen(options[, callback])
  if (typeof first === 'object' && first !== null) {
    const options = first as net.ListenOptions;
    // Anything beyond a port and a backlog (a host, a path, an fd, ipv6Only,
    // exclusive, a signal) is left to Node — this shim has no business
    // re-implementing it.
    const plain = Object.keys(options).every((key) => key === 'port' || key === 'backlog');
    if (!plain || options.port) return null;
    return {
      backlog: options.backlog,
      callback: rest.find((arg) => typeof arg === 'function') as (() => void) | undefined,
    };
  }

  // listen([port][, host][, backlog][, callback]) — a host is the only string.
  if (first !== undefined && first !== 0 && typeof first !== 'function') return null;
  const tail = first === 0 ? rest : args;
  if (tail.some((arg) => typeof arg === 'string')) return null;
  return {
    backlog: tail.find((arg) => typeof arg === 'number') as number | undefined,
    callback: tail.find((arg) => typeof arg === 'function') as (() => void) | undefined,
  };
}

type ListenFn = (this: net.Server, ...args: unknown[]) => net.Server;
type SetupListenHandle = (
  address: string,
  port: number,
  addressType: number,
  backlog: number | undefined,
  fd: number | undefined,
  flags: number,
) => void;

const originalListen = net.Server.prototype.listen as unknown as ListenFn;

const patchedListen: ListenFn = function patchedListen(this: net.Server, ...args: unknown[]) {
  const ephemeral = ephemeralWildcard(args);
  const server = this as net.Server & { _listen2?: SetupListenHandle; _handle?: unknown };

  // `_listen2` is where Node's own `listen()` lands once it has a resolved
  // address, and it binds SYNCHRONOUSLY. The public `listen(0, '127.0.0.1', …)`
  // does not: giving it a host routes it through `dns.lookup`, which defers the
  // bind by a tick even for a literal IP. supertest reads
  // `server.address().port` on the line after `app.listen(0)`, so the bind has
  // to have happened before this returns — hence the internal call rather than
  // the public one. If a future Node drops it, fall through to the stock
  // behaviour; `loopback-listen.test.ts` then fails and says so.
  if (ephemeral === null || typeof server._listen2 !== 'function' || server._handle) {
    return originalListen.apply(this, args);
  }

  if (ephemeral.callback) this.once('listening', ephemeral.callback);
  server._listen2(LOOPBACK, 0, IPV4, ephemeral.backlog, undefined, 0);
  return this;
};

net.Server.prototype.listen = patchedListen as unknown as net.Server['listen'];
