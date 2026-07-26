/**
 * @file error.ts
 * @description Error handling utilities
 * @feature shared
 */

/**
 * The rejection value of `@/api/client` — a plain object, not an `Error`.
 * Mirrors `ApiError` from `shared/types/api.types` without importing it, so
 * this module stays dependency-free.
 */
interface ApiErrorLike {
  message: string;
  code?: string;
  statusCode?: number;
}

/**
 * Recognise the api client's rejection envelope.
 *
 * The client rejects with `{ code, message, statusCode }` (see
 * `api/client.ts` → `createApiError`), so an `instanceof Error` check alone
 * throws away the server's message and every caller reads "An unknown error
 * occurred". Only objects carrying that envelope (`message` *plus* `code` or
 * `statusCode`) are unwrapped — an arbitrary `{ message }` bag is still an
 * unknown value and keeps falling through to the fallback.
 */
function asApiErrorLike(error: unknown): ApiErrorLike | null {
  if (!error || typeof error !== 'object') return null;
  const candidate = error as Partial<ApiErrorLike>;
  if (typeof candidate.message !== 'string' || candidate.message.length === 0) return null;
  const hasEnvelope =
    typeof candidate.code === 'string' || typeof candidate.statusCode === 'number';
  return hasEnvelope ? (candidate as ApiErrorLike) : null;
}

/**
 * Extract a user-friendly error message from an unknown error
 * Handles Error objects, strings, api client errors, and unknown types
 * @param error - The error to extract a message from
 * @param fallback - Fallback message if error type is unknown (default: 'An unknown error occurred')
 * @returns A string error message
 */
export function getErrorMessage(error: unknown, fallback = 'An unknown error occurred'): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  const apiError = asApiErrorLike(error);
  if (apiError) {
    return apiError.message;
  }
  return fallback;
}

/**
 * HTTP status of an api client rejection, when it carries one.
 * @param error - The error to inspect
 * @returns The status code, or null when the error has none
 */
export function getErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  if (typeof statusCode === 'number') return statusCode;
  // Raw axios errors (an interceptor-free client) keep the status on `response`.
  const response = (error as { response?: { status?: unknown } }).response;
  if (response && typeof response.status === 'number') return response.status;
  return null;
}

/**
 * Whether an error is a 404. Lets callers treat "nothing here yet" as an empty
 * state instead of reporting it to the operator as a failure.
 * @param error - The error to check
 * @returns true when the request came back 404
 */
export function isNotFoundError(error: unknown): boolean {
  return getErrorStatus(error) === 404;
}

/**
 * Check if an error is an AbortError (from AbortController)
 * @param error - The error to check
 * @returns true if the error is an AbortError
 */
export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/**
 * Check if an error is a network error
 * @param error - The error to check
 * @returns true if the error appears to be a network error
 */
export function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes('network') ||
    message.includes('fetch') ||
    message.includes('econnrefused') ||
    message.includes('enotfound')
  );
}
