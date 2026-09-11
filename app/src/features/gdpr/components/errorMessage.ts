/**
 * @file errorMessage.ts
 * @description Turns whatever the API client rejects with into a readable message
 * @feature gdpr
 */

/** The API client rejects with plain objects ({ message } / { error }), not Error instances. */
export function errorMessage(err: unknown, fallback = 'Something went wrong. Try again.'): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err) return err;
  if (err && typeof err === 'object') {
    const o = err as { message?: unknown; error?: unknown };
    if (typeof o.message === 'string' && o.message) return o.message;
    if (typeof o.error === 'string' && o.error) return o.error;
  }
  return fallback;
}
