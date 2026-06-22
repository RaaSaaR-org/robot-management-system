/**
 * @file error.test.ts
 * @description Tests for error handling utilities
 * @feature shared
 */

import { describe, it, expect } from 'vitest';
import { getErrorMessage, isAbortError, isNetworkError } from '../error';

describe('getErrorMessage', () => {
  it('returns the message of an Error instance', () => {
    expect(getErrorMessage(new Error('boom'))).toBe('boom');
  });

  it('returns subclass Error messages', () => {
    expect(getErrorMessage(new TypeError('bad type'))).toBe('bad type');
  });

  it('returns the string itself when given a string', () => {
    expect(getErrorMessage('plain string error')).toBe('plain string error');
  });

  it('returns the default fallback for unknown types', () => {
    expect(getErrorMessage(null)).toBe('An unknown error occurred');
    expect(getErrorMessage(undefined)).toBe('An unknown error occurred');
    expect(getErrorMessage(42)).toBe('An unknown error occurred');
    expect(getErrorMessage({ message: 'nope' })).toBe('An unknown error occurred');
  });

  it('returns a custom fallback when provided', () => {
    expect(getErrorMessage(null, 'custom fallback')).toBe('custom fallback');
    expect(getErrorMessage({}, 'custom fallback')).toBe('custom fallback');
  });
});

describe('isAbortError', () => {
  it('returns true for an Error named AbortError', () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    expect(isAbortError(err)).toBe(true);
  });

  it('returns false for a normal Error', () => {
    expect(isAbortError(new Error('aborted'))).toBe(false);
  });

  it('returns false for non-Error values', () => {
    expect(isAbortError('AbortError')).toBe(false);
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError({ name: 'AbortError' })).toBe(false);
  });
});

describe('isNetworkError', () => {
  it('detects network-related keywords case-insensitively', () => {
    expect(isNetworkError(new Error('Network request failed'))).toBe(true);
    expect(isNetworkError(new Error('Failed to FETCH'))).toBe(true);
    expect(isNetworkError(new Error('connect ECONNREFUSED 127.0.0.1'))).toBe(true);
    expect(isNetworkError(new Error('getaddrinfo ENOTFOUND host'))).toBe(true);
  });

  it('returns false for unrelated Error messages', () => {
    expect(isNetworkError(new Error('validation failed'))).toBe(false);
    expect(isNetworkError(new Error(''))).toBe(false);
  });

  it('returns false for non-Error values', () => {
    expect(isNetworkError('network down')).toBe(false);
    expect(isNetworkError(null)).toBe(false);
    expect(isNetworkError(undefined)).toBe(false);
  });
});
