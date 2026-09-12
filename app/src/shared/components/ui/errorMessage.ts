/**
 * @file errorMessage.ts
 * @description One readable sentence out of whatever a failed call rejects
 *              with. The API client (`@/api/client`) rejects with an
 *              `ApiRequestError` — a real `Error` carrying `code`,
 *              `statusCode` and `details` — but a rejection can also be a raw
 *              axios error, a bare string, or a plain object from code that
 *              never went through the client. This reads the server's sentence
 *              out of all of them, so use it for every toast description and
 *              form-level error rather than
 *              `err instanceof Error ? err.message : String(err)`.
 * @feature shared
 */

/** The default when nothing readable can be found. */
export const ERROR_MESSAGE_FALLBACK = 'Something went wrong. Try again.';

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

/** `response.data.message` / `response.data.error` of a raw axios error. */
function responseText(err: object): string | undefined {
  const data = (err as { response?: { data?: unknown } }).response?.data;
  if (!data) return undefined;
  if (typeof data === 'string') return nonEmpty(data);
  if (typeof data !== 'object') return undefined;
  const { message, error } = data as { message?: unknown; error?: unknown };
  return nonEmpty(message) ?? nonEmpty(error);
}

/**
 * @example
 * ```ts
 * try { await deleteRoute(id); }
 * catch (err) { toast.error("Couldn't delete route", { description: errorMessage(err) }); }
 *
 * setFormError(errorMessage(err, "Couldn't save the zone."));
 * ```
 */
export function errorMessage(err: unknown, fallback: string = ERROR_MESSAGE_FALLBACK): string {
  if (typeof err === 'string') return nonEmpty(err) ?? fallback;
  if (!err || typeof err !== 'object') return fallback;
  // A server response says more than axios' "Request failed with status code 500".
  const fromResponse = responseText(err);
  if (fromResponse) return fromResponse;
  const { message, error } = err as { message?: unknown; error?: unknown };
  return nonEmpty(message) ?? nonEmpty(error) ?? fallback;
}
