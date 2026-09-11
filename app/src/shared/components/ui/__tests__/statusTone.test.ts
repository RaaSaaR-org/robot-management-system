/**
 * @file statusTone.test.ts
 * @description Tests for statusTone / humanizeStatus / normalizeStatus
 * @feature shared
 */

import { describe, it, expect } from 'vitest';
import { humanizeStatus, normalizeStatus, statusTone } from '../statusTone';

describe('statusTone', () => {
  it.each([
    ['online', 'success'],
    ['completed', 'success'],
    ['published', 'success'],
    ['queued', 'info'],
    ['in_progress', 'info'],
    ['rolling_out', 'info'],
    ['charging', 'warning'],
    ['pending_review', 'warning'],
    ['draft_review', 'warning'],
    ['error', 'danger'],
    ['estop', 'danger'],
    ['e-stop', 'danger'],
    ['fault', 'danger'],
    ['offline', 'neutral'],
    ['cancelled', 'neutral'],
    ['unknown', 'neutral'],
  ])('maps %s to %s', (status, tone) => {
    expect(statusTone(status)).toBe(tone);
  });

  it('is case- and separator-insensitive', () => {
    expect(statusTone('In Progress')).toBe('info');
    expect(statusTone('IN-PROGRESS')).toBe('info');
    expect(statusTone('Rolling_Out')).toBe('info');
    expect(statusTone('E-Stop')).toBe('danger');
    expect(statusTone('E_STOP')).toBe('danger');
    expect(statusTone('  Online ')).toBe('success');
  });

  it('falls back to neutral for unknown, empty and missing statuses', () => {
    expect(statusTone('something-new')).toBe('neutral');
    expect(statusTone('')).toBe('neutral');
    expect(statusTone(null)).toBe('neutral');
    expect(statusTone(undefined)).toBe('neutral');
  });
});

describe('humanizeStatus', () => {
  it('turns separators into spaces and uses sentence case', () => {
    expect(humanizeStatus('in_progress')).toBe('In progress');
    expect(humanizeStatus('ROLLING-OUT')).toBe('Rolling out');
    expect(humanizeStatus('online')).toBe('Online');
  });

  it('keeps the E-stop spelling', () => {
    expect(humanizeStatus('estop')).toBe('E-stop');
    expect(humanizeStatus('E_STOP')).toBe('E-stop');
  });

  it('labels missing statuses Unknown', () => {
    expect(humanizeStatus(undefined)).toBe('Unknown');
  });
});

describe('normalizeStatus', () => {
  it('produces one key for every spelling', () => {
    expect(normalizeStatus('Pending Review')).toBe('pending_review');
    expect(normalizeStatus('pending-review')).toBe('pending_review');
    expect(normalizeStatus('PENDING_REVIEW')).toBe('pending_review');
  });
});
