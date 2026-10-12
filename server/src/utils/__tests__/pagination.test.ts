/**
 * @file pagination.test.ts
 * @description Unit tests for the shared page/limit/offset parsers (TASK-386)
 * @feature core
 */

import { describe, it, expect } from 'vitest';
import { BadRequestError } from '../errors.js';
import { parseIntegerParam, parsePagination, parseOffsetPagination } from '../pagination.js';

describe('parseIntegerParam', () => {
  it('returns undefined for an absent or empty value', () => {
    expect(parseIntegerParam(undefined, 'page')).toBeUndefined();
    expect(parseIntegerParam('', 'page')).toBeUndefined();
  });

  it('parses a whole number', () => {
    expect(parseIntegerParam('42', 'page')).toBe(42);
    expect(parseIntegerParam(' 7 ', 'page')).toBe(7);
  });

  it.each(['abc', '1.5', '2abc', 'NaN', '1e3'])('refuses %s with a 400 naming the param', (raw) => {
    expect(() => parseIntegerParam(raw, 'page')).toThrow(BadRequestError);
    expect(() => parseIntegerParam(raw, 'page')).toThrow('page must be an integer');
  });

  it('refuses an array value', () => {
    expect(() => parseIntegerParam(['1', '2'], 'limit')).toThrow('limit must be an integer');
  });

  it('refuses a value below min and clamps one above max', () => {
    expect(() => parseIntegerParam('0', 'page', { min: 1 })).toThrow('page must be at least 1');
    expect(() => parseIntegerParam('-1', 'limit', { min: 1 })).toThrow('limit must be at least 1');
    expect(parseIntegerParam('5000', 'limit', { min: 1, max: 100 })).toBe(100);
  });
});

describe('parsePagination', () => {
  it('applies defaults when nothing is given', () => {
    expect(parsePagination({}, { defaultLimit: 20 })).toEqual({ page: 1, limit: 20 });
  });

  it('reads a custom limit parameter name', () => {
    expect(
      parsePagination({ page: '3', pageSize: '10' }, { limitParam: 'pageSize', defaultLimit: 50 })
    ).toEqual({ page: 3, limit: 10 });
  });

  it('refuses page=0, page=abc and limit=-1', () => {
    expect(() => parsePagination({ page: '0' }, { defaultLimit: 20 })).toThrow(BadRequestError);
    expect(() => parsePagination({ page: 'abc' }, { defaultLimit: 20 })).toThrow(BadRequestError);
    expect(() => parsePagination({ limit: '-1' }, { defaultLimit: 20 })).toThrow(
      'limit must be at least 1'
    );
  });

  it('clamps the page size to maxLimit', () => {
    expect(parsePagination({ limit: '999' }, { defaultLimit: 20, maxLimit: 100 }).limit).toBe(100);
  });
});

describe('parseOffsetPagination', () => {
  it('applies defaults and accepts offset 0', () => {
    expect(parseOffsetPagination({}, { defaultLimit: 50 })).toEqual({ offset: 0, limit: 50 });
    expect(parseOffsetPagination({ offset: '0', limit: '5' }, { defaultLimit: 50 })).toEqual({
      offset: 0,
      limit: 5,
    });
  });

  it('refuses a negative offset', () => {
    expect(() => parseOffsetPagination({ offset: '-3' }, { defaultLimit: 50 })).toThrow(
      'offset must be at least 0'
    );
  });
});
