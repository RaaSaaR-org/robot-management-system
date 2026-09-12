/**
 * @file approvalFormat.test.ts
 * @description Tests for the approval label/tone helpers, above all the shared
 *   `isOpen` predicate (TASK-290)
 * @feature approvals
 */

import { describe, it, expect } from 'vitest';
import { OPEN_APPROVAL_STATUSES } from '../../types';
import type { ApprovalRequest, ApprovalStatus } from '../../types';
import { formatRelative, humanize, isOpen, priorityTone, slaInfo, statusTone, stepTone } from '../approvalFormat';

const HOUR = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 12, 12, 0, 0);

/** Just the three fields slaInfo reads. */
function req(status: ApprovalStatus, deadlineOffsetMs: number, slaHours = 48) {
  return {
    status,
    slaHours,
    slaDeadline: new Date(NOW + deadlineOffsetMs).toISOString(),
  } as Pick<ApprovalRequest, 'slaDeadline' | 'slaHours' | 'status'>;
}

describe('isOpen', () => {
  it('treats an escalated request as open', () => {
    // The bug this file was written for: escalation is the SLA-breach path, so
    // a breached request must stay actionable instead of dropping out of the
    // queue the moment it breaches.
    expect(isOpen('escalated')).toBe(true);
  });

  it('accepts every status in the shared open set', () => {
    for (const status of OPEN_APPROVAL_STATUSES) {
      expect(isOpen(status)).toBe(true);
    }
  });

  it('rejects the terminal statuses', () => {
    for (const status of ['approved', 'rejected', 'cancelled', 'expired'] as ApprovalStatus[]) {
      expect(isOpen(status)).toBe(false);
    }
  });
});

describe('slaInfo', () => {
  it('reports an escalated request as overdue, not Closed', () => {
    // `escalate()` never moves slaDeadline, so an escalated row is always past
    // it. Reading "Closed" here would contradict the row the queue still lists.
    const info = slaInfo(req('escalated', -3 * HOUR), NOW);
    expect(info.label).toBe('3h overdue');
    expect(info.tone).toBe('stopped');
    expect(info.remainingMs).toBe(-3 * HOUR);
  });

  it('reports a pending request past its deadline as overdue', () => {
    expect(slaInfo(req('pending', -90 * 60 * 1000), NOW)).toMatchObject({
      tone: 'stopped',
      label: '2h overdue',
    });
  });

  it('gates a request inside the last quarter of its SLA', () => {
    // 48h SLA → the last 12h are gated.
    expect(slaInfo(req('in_progress', 6 * HOUR), NOW)).toMatchObject({
      tone: 'gated',
      label: '6h left',
    });
  });

  it('stays neutral with plenty of time left', () => {
    // Under 24h so the span still reads in hours; 48h SLA gates only the last 12h.
    expect(slaInfo(req('pending', 20 * HOUR), NOW)).toMatchObject({
      tone: 'neutral',
      label: '20h left',
    });
  });

  it('returns Closed with no remaining time once decided', () => {
    expect(slaInfo(req('approved', -3 * HOUR), NOW)).toEqual({
      tone: 'neutral',
      label: 'Closed',
      remainingMs: null,
    });
  });

  it('formats spans in minutes, hours and days', () => {
    expect(slaInfo(req('pending', 30 * 60 * 1000), NOW).label).toBe('30m left');
    expect(slaInfo(req('pending', 72 * HOUR, 400), NOW).label).toBe('3d left');
  });
});

describe('humanize', () => {
  it('turns a snake_case status into a sentence-cased label', () => {
    expect(humanize('safety_parameter_modification')).toBe('Safety parameter modification');
    expect(humanize('in_progress')).toBe('In progress');
  });
});

describe('tones', () => {
  it('maps priorities to their tones', () => {
    expect(priorityTone('urgent')).toBe('danger');
    expect(priorityTone('critical')).toBe('danger');
    expect(priorityTone('high')).toBe('warning');
    expect(priorityTone('normal')).toBe('info');
    expect(priorityTone('low')).toBe('neutral');
  });

  it('maps statuses to their tones', () => {
    expect(statusTone('approved')).toBe('success');
    expect(statusTone('rejected')).toBe('danger');
    expect(statusTone('expired')).toBe('danger');
    expect(statusTone('escalated')).toBe('warning');
    expect(statusTone('pending')).toBe('info');
    expect(statusTone('in_progress')).toBe('info');
    expect(statusTone('cancelled')).toBe('neutral');
  });

  it('maps step statuses to their tones', () => {
    expect(stepTone('approved')).toBe('success');
    expect(stepTone('rejected')).toBe('danger');
    expect(stepTone('awaiting')).toBe('warning');
    expect(stepTone('pending')).toBe('neutral');
    expect(stepTone('skipped')).toBe('neutral');
  });
});

describe('formatRelative', () => {
  it('says "just now" under a minute and a span otherwise', () => {
    expect(formatRelative(new Date(NOW - 5000).toISOString(), NOW)).toBe('just now');
    expect(formatRelative(new Date(NOW - 4 * HOUR).toISOString(), NOW)).toBe('4h ago');
  });
});
