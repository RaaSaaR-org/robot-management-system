/**
 * @file error.ts
 * @description Error handling utilities
 * @feature shared
 */

/**
 * Extract a user-friendly error message from an unknown error
 * Handles Error objects, strings, and unknown types
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
  return fallback;
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
