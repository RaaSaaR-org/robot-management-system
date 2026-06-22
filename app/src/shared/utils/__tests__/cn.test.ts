/**
 * @file cn.test.ts
 * @description Tests for the cn class-merging utility
 * @feature shared
 */

import { describe, it, expect } from 'vitest';
import { cn } from '../cn';

describe('cn', () => {
  it('joins multiple class strings', () => {
    expect(cn('px-4', 'py-2')).toBe('px-4 py-2');
  });

  it('resolves conflicting Tailwind classes (last wins)', () => {
    expect(cn('text-sm', 'text-lg')).toBe('text-lg');
    expect(cn('px-2', 'px-4')).toBe('px-4');
  });

  it('drops falsy conditional values', () => {
    expect(cn('base', false && 'hidden', null, undefined, '')).toBe('base');
  });

  it('includes truthy conditional values', () => {
    const isActive = true;
    expect(cn('px-4', isActive && 'bg-cobalt')).toBe('px-4 bg-cobalt');
  });

  it('handles arrays and objects via clsx', () => {
    expect(cn(['px-4', 'py-2'])).toBe('px-4 py-2');
    expect(cn({ 'text-red-500': true, 'text-blue-500': false })).toBe('text-red-500');
  });

  it('merges object + conflict resolution together', () => {
    expect(cn('p-2', { 'p-4': true })).toBe('p-4');
  });

  it('returns empty string for no/empty input', () => {
    expect(cn()).toBe('');
    expect(cn(false, null, undefined)).toBe('');
  });
});
