/**
 * @file sessionPhase.test.ts
 * @description The phase engine (TASK-426): one layout per status, and the
 *              command bar's tally colour per state.
 * @feature datacollection
 */

import { describe, expect, it } from 'vitest';
import { commandBarTally, sessionPhase } from '../sessionPhase';

describe('sessionPhase', () => {
  it('maps created to Set up, recording and paused to Record, completed and failed to Wrap up', () => {
    expect(sessionPhase('created')).toBe('setup');
    expect(sessionPhase('recording')).toBe('record');
    expect(sessionPhase('paused')).toBe('record');
    expect(sessionPhase('completed')).toBe('wrap');
    expect(sessionPhase('failed')).toBe('wrap');
  });
});

describe('commandBarTally', () => {
  const t = (status: Parameters<typeof commandBarTally>[0]['status'], capturing = false, fault = false) =>
    commandBarTally({ status, capturing, fault });

  it('is amber while setting up, red while a take records, quiet between takes', () => {
    expect(t('created')).toBe('setup');
    expect(t('recording', true)).toBe('rec');
    expect(t('recording', false)).toBe('between');
    expect(t('paused')).toBe('between');
  });

  it('turns to fault on a robot stop, and the end states win over it', () => {
    expect(t('recording', true, true)).toBe('fault');
    expect(t('created', false, true)).toBe('fault');
    expect(t('completed', false, true)).toBe('done');
    expect(t('failed')).toBe('failed');
  });
});
