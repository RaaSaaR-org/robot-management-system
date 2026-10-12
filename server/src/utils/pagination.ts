/**
 * @file pagination.ts
 * @description Shared parsers for page/limit/offset query parameters (TASK-386)
 * @feature core
 */

import { BadRequestError } from './errors.js';

/** Bounds for one integer query parameter. */
export interface IntegerParamBounds {
  /** Smallest accepted value; anything lower is refused */
  min?: number;
  /** Largest value; anything higher is clamped down to it */
  max?: number;
}

/**
 * Parse one integer query parameter.
 *
 * List routes used to hand `parseInt(req.query.page)` straight to Prisma, so
 * `?page=abc` became `skip: NaN` (a 500) and `?limit=-1` became `take: -1`
 * (the wrong rows). This refuses what is not a whole number at or above `min`
 * with a 400 naming the parameter, and clamps what is above `max`.
 *
 * @param value - The raw query value (string, array or undefined)
 * @param name - The parameter name, used in the error message
 * @param bounds - Inclusive lower bound and clamping upper bound
 * @returns The parsed number, or undefined when the parameter is absent or empty
 * @throws BadRequestError when the value is not an integer or is below `min`
 */
export function parseIntegerParam(
  value: unknown,
  name: string,
  bounds: IntegerParamBounds = {}
): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;

  const raw = typeof value === 'number' ? String(value) : value;
  if (typeof raw !== 'string' || !/^-?\d+$/.test(raw.trim())) {
    throw new BadRequestError(`${name} must be an integer`, { param: name });
  }

  const parsed = Number(raw.trim());
  if (!Number.isSafeInteger(parsed)) {
    throw new BadRequestError(`${name} must be an integer`, { param: name });
  }
  if (bounds.min !== undefined && parsed < bounds.min) {
    throw new BadRequestError(`${name} must be at least ${bounds.min}`, { param: name });
  }
  if (bounds.max !== undefined && parsed > bounds.max) return bounds.max;
  return parsed;
}

/** Options for {@link parsePagination}. */
export interface PaginationOptions {
  /** Name of the page-size parameter (`limit` or `pageSize`); default `limit` */
  limitParam?: string;
  /** Page size when the parameter is absent */
  defaultLimit: number;
  /** Largest page size; higher values are clamped down to it */
  maxLimit?: number;
}

/**
 * Parse `page` (>= 1, default 1) and a page size (>= 1) from a query object.
 *
 * @param query - The request query (`req.query`)
 * @param options - Name, default and ceiling of the page-size parameter
 * @returns `{ page, limit }`, both positive integers
 * @throws BadRequestError naming the parameter that is not a positive integer
 */
export function parsePagination(
  query: Record<string, unknown>,
  options: PaginationOptions
): { page: number; limit: number } {
  const limitParam = options.limitParam ?? 'limit';
  const page = parseIntegerParam(query.page, 'page', { min: 1 }) ?? 1;
  const limit =
    parseIntegerParam(query[limitParam], limitParam, { min: 1, max: options.maxLimit }) ??
    options.defaultLimit;
  return { page, limit };
}

/**
 * Parse `offset` (>= 0, default 0) and `limit` (>= 1) from a query object.
 *
 * @param query - The request query (`req.query`)
 * @param options - Default and ceiling of `limit`
 * @returns `{ offset, limit }`
 * @throws BadRequestError naming the parameter that is out of range
 */
export function parseOffsetPagination(
  query: Record<string, unknown>,
  options: { defaultLimit: number; maxLimit?: number }
): { offset: number; limit: number } {
  const offset = parseIntegerParam(query.offset, 'offset', { min: 0 }) ?? 0;
  const limit =
    parseIntegerParam(query.limit, 'limit', { min: 1, max: options.maxLimit }) ??
    options.defaultLimit;
  return { offset, limit };
}
