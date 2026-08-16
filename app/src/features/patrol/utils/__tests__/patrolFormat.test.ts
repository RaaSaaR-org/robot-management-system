/**
 * @file patrolFormat.test.ts
 * @description The finding link an alert carries, and the run summaries.
 * @feature patrol
 */

import { describe, it, expect } from 'vitest';
import { findingLinkPath, parseFindingLink, runProgressText, sortFindings, stripFindingLink, formatWindow } from '../patrolFormat';
import type { PatrolFinding, PatrolRun } from '../../types/patrol.types';

describe('finding link', () => {
  it('parses `[finding:<id> run:<runId>]` from an alert message', () => {
    const link = parseFindingLink('unexpected object in Hall — route Night round, run run-1, 01:02 [finding:f-1 run:run-1]');
    expect(link).toEqual({ findingId: 'f-1', runId: 'run-1' });
    expect(findingLinkPath(link!)).toBe('/patrol/runs/run-1#finding-f-1');
  });

  it('tolerates a link without a run (no path then)', () => {
    const link = parseFindingLink('… [finding:f-2]');
    expect(link).toEqual({ findingId: 'f-2', runId: null });
    expect(findingLinkPath(link!)).toBeNull();
  });

  it('returns null for ordinary alerts', () => {
    expect(parseFindingLink('Battery low')).toBeNull();
    expect(parseFindingLink(null)).toBeNull();
  });

  it('strips the tag from the prose', () => {
    expect(stripFindingLink('Door open in Kitchen [finding:f-1 run:r-1]')).toBe('Door open in Kitchen');
  });
});

describe('summaries', () => {
  const run: PatrolRun = {
    runId: 'r',
    routeId: 'x',
    routeName: 'x',
    robotId: 'g1',
    mode: 'patrol',
    origin: 'operator',
    window: null,
    status: 'running',
    startedAt: '2026-08-16T01:00:00.000Z',
    legs: [
      { index: 0, checkpointId: 'a', placeId: 'a', name: 'A', status: 'done', findingIds: [] },
      { index: 1, checkpointId: 'b', placeId: 'b', name: 'B', status: 'failed', findingIds: [] },
      { index: 2, checkpointId: 'c', placeId: 'c', name: 'C', status: 'pending', findingIds: [] },
    ],
    findingCount: 1,
  };
  it('counts finished legs, failed legs and findings', () => {
    expect(runProgressText(run)).toBe('2/3 legs · 1 failed · 1 finding');
  });
  it('formats a window', () => {
    expect(formatWindow({ id: 'night', name: 'Night', startHour: 19, endHour: 7 })).toBe('19:00–07:00');
  });
  it('sorts findings high first, then newest', () => {
    const f = (id: string, severity: PatrolFinding['severity'], at: string): PatrolFinding => ({
      id, runId: 'r', routeId: 'x', robotId: 'g1', legIndex: 0, type: 'other', severity, source: 'checkpoint',
      place: null, pose: null, at, summary: id, evidence: {}, model: null, confidence: 1, status: 'open',
    });
    const sorted = sortFindings([f('lo', 'low', '2026-01-01T00:00:03Z'), f('hi', 'high', '2026-01-01T00:00:01Z'), f('hi2', 'high', '2026-01-01T00:00:02Z')]);
    expect(sorted.map((x) => x.id)).toEqual(['hi2', 'hi', 'lo']);
  });
});
