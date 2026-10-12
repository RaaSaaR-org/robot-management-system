/**
 * @file connection-errors.ts
 * @description Recognise NATS errors that mean "the connection is gone", not "the work failed"
 * @feature messaging
 */

/**
 * Whether `error` is NATS saying its connection is closed or draining — what
 * every publish and KV write throws once shutdown has called `natsClient.close()`.
 * Matched on the code (nats.js `ErrorCode`), walking `cause`, so a wrapped
 * error is still recognised (TASK-359).
 */
export function isNatsConnectionClosed(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== 'object' || depth > 4) return false;
  const e = error as { code?: unknown; cause?: unknown };
  if (e.code === 'CONNECTION_CLOSED' || e.code === 'CONNECTION_DRAINING') return true;
  return e.cause !== error && isNatsConnectionClosed(e.cause, depth + 1);
}
