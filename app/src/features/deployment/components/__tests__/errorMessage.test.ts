/**
 * @file errorMessage.test.ts
 * @description errorMessage turns Errors, the API client's `{ message }` rejections and strings into text.
 * The deployment-local copy of this helper was deleted in TASK-297; the deployment components now
 * call the shared helper, so this suite exercises the shared one against the same expectations.
 * @feature deployment
 */

import { describe, expect, it } from 'vitest';
import { errorMessage } from '@/shared/components/ui';

describe('errorMessage', () => {
  it('reads an Error', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
  });

  it('reads the API client rejection object instead of printing [object Object]', () => {
    expect(errorMessage({ message: 'Active deployment already exists', status: 400 })).toBe(
      'Active deployment already exists',
    );
  });

  it('passes strings through and falls back for anything else', () => {
    expect(errorMessage('plain')).toBe('plain');
    expect(errorMessage({})).toBe('Something went wrong. Try again.');
    expect(errorMessage(null)).toBe('Something went wrong. Try again.');
  });
});
