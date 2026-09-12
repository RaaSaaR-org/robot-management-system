/**
 * @file errorMessage.test.ts
 * @description Tests for errorMessage(): every rejection shape reads as a sentence
 * @feature shared
 */

import { describe, it, expect } from 'vitest';
import { errorMessage, ERROR_MESSAGE_FALLBACK } from '../errorMessage';

describe('errorMessage', () => {
  it('reads an Error', () => {
    expect(errorMessage(new Error('Robot not reachable'))).toBe('Robot not reachable');
  });

  it("reads the API client's plain ApiError object (never [object Object])", () => {
    const apiError = { code: 'NOT_FOUND', message: 'Zone not found', statusCode: 404 };
    expect(errorMessage(apiError)).toBe('Zone not found');
    expect(errorMessage(apiError)).not.toContain('[object Object]');
  });

  it('reads a bare { message } and a bare { error }', () => {
    expect(errorMessage({ message: 'Name taken' })).toBe('Name taken');
    expect(errorMessage({ error: 'Tenant is suspended' })).toBe('Tenant is suspended');
  });

  it("prefers a raw axios error's response body over axios' own message", () => {
    const axiosLike = Object.assign(new Error('Request failed with status code 409'), {
      response: { status: 409, data: { error: 'A route with that name exists' } },
    });
    expect(errorMessage(axiosLike)).toBe('A route with that name exists');
    expect(errorMessage({ response: { data: { message: 'Quota exceeded' } } })).toBe('Quota exceeded');
    expect(errorMessage({ response: { data: 'Bad gateway' } })).toBe('Bad gateway');
  });

  it('reads a non-empty string', () => {
    expect(errorMessage('Timed out')).toBe('Timed out');
  });

  it('falls back for empty, missing and unreadable values', () => {
    expect(errorMessage(undefined)).toBe(ERROR_MESSAGE_FALLBACK);
    expect(errorMessage(null)).toBe(ERROR_MESSAGE_FALLBACK);
    expect(errorMessage('')).toBe(ERROR_MESSAGE_FALLBACK);
    expect(errorMessage(42)).toBe(ERROR_MESSAGE_FALLBACK);
    expect(errorMessage({})).toBe(ERROR_MESSAGE_FALLBACK);
    expect(errorMessage(new Error(''))).toBe(ERROR_MESSAGE_FALLBACK);
    expect(errorMessage({ message: { nested: true } })).toBe(ERROR_MESSAGE_FALLBACK);
  });

  it('takes a caller fallback', () => {
    expect(errorMessage({}, "Couldn't save the zone.")).toBe("Couldn't save the zone.");
  });
});
