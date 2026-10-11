/**
 * @file ImportActivityLog.test.ts
 * @description The bounded in-memory import log: ring size, eviction, restart.
 * @feature datasets
 */

import { describe, it, expect } from 'vitest';
import { ImportActivityLog } from '../ImportActivityLog.js';

describe('ImportActivityLog', () => {
  it('keeps the newest lines and counts the ones it dropped', () => {
    const log = new ImportActivityLog(3, 10);
    for (let i = 1; i <= 5; i++) log.append('d1', 'info', `line ${i}`);

    const entry = log.get('d1')!;
    expect(entry.lines.map((l) => l.message)).toEqual(['line 3', 'line 4', 'line 5']);
    expect(entry.dropped).toBe(2);
  });

  it('forgets the oldest import first once it holds too many', () => {
    const log = new ImportActivityLog(10, 2);
    log.append('a', 'info', 'a');
    log.append('b', 'info', 'b');
    log.append('c', 'info', 'c');

    expect(log.get('a')).toBeNull();
    expect(log.get('b')).not.toBeNull();
    expect(log.get('c')).not.toBeNull();
  });

  it('starts a retry with an empty log, and counts it as the newest import', () => {
    const log = new ImportActivityLog(10, 2);
    log.append('a', 'error', 'first attempt failed');
    log.append('b', 'info', 'b');
    log.start('a');
    log.append('c', 'info', 'c');

    expect(log.get('a')!.lines).toEqual([]);
    expect(log.get('b')).toBeNull();
  });

  it('remembers the last progress frame for a page that attaches late', () => {
    const log = new ImportActivityLog();
    log.setProgress('d1', { datasetId: 'd1', status: 'importing', phase: 'downloading', progress: 42 });
    expect(log.get('d1')!.progress).toMatchObject({ progress: 42, phase: 'downloading' });
  });

  it('hands out a copy, so a reader cannot rewrite the log', () => {
    const log = new ImportActivityLog();
    log.append('d1', 'info', 'one');
    log.get('d1')!.lines.push({ at: '', level: 'info', message: 'forged' });
    expect(log.get('d1')!.lines).toHaveLength(1);
  });
});
