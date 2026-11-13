/**
 * @file localeGuard.test.ts
 * @description The product is English, so no number or date may be formatted
 *              with the browser's locale: a German browser wrote "69.460 frames"
 *              in the training wizard next to "69,460" in the dataset list
 *              (TASK-486). This walks the app's sources and fails on a
 *              `toLocale*String()` or `Intl.*Format()` call that names no
 *              locale — use the formatters in `shared/utils/format.ts`.
 * @feature shared
 */

import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, formatNumber, formatTime } from '../format';

/** Every source file of the app, as text. Tests are not product code. */
const SOURCES = Object.entries(
  import.meta.glob<string>('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }),
).filter(([path]) => !/\.test\.tsx?$/.test(path) && !path.includes('/__tests__/'));

/** A locale-taking call whose first argument is missing, `undefined` or `[]`. */
const BARE_LOCALE_CALL =
  /(?:\.toLocale(?:Date|Time)?String|\bIntl\.(?:NumberFormat|DateTimeFormat|RelativeTimeFormat|ListFormat|PluralRules))\(\s*(?:\)|undefined\b|\[\s*\])/;

describe('number and date formatting', () => {
  it('never falls back to the browser locale', () => {
    // A walk that found nothing would pass for the wrong reason.
    expect(SOURCES.length).toBeGreaterThan(500);
    const offenders: string[] = [];
    for (const [path, text] of SOURCES) {
      text.split('\n').forEach((line, index) => {
        if (BARE_LOCALE_CALL.test(line)) offenders.push(`${path}:${index + 1}  ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('recognises the calls it is there to catch', () => {
    expect(BARE_LOCALE_CALL.test('total.toLocaleString()')).toBe(true);
    expect(BARE_LOCALE_CALL.test('d.toLocaleDateString(undefined, { day: "numeric" })')).toBe(true);
    expect(BARE_LOCALE_CALL.test('d.toLocaleTimeString([], { hour: "2-digit" })')).toBe(true);
    expect(BARE_LOCALE_CALL.test('new Intl.NumberFormat().format(n)')).toBe(true);
    expect(BARE_LOCALE_CALL.test('total.toLocaleString(UI_DATE_LOCALE)')).toBe(false);
    expect(BARE_LOCALE_CALL.test("d.toLocaleDateString('en-US')")).toBe(false);
  });
});

describe('the shared formatters', () => {
  it('group thousands with a comma whatever the browser says', () => {
    expect(formatNumber(69460)).toBe('69,460');
    expect(formatNumber(1234.5, { maximumFractionDigits: 0 })).toBe('1,235');
  });

  it('spell the month out, so a date is never day-first or month-first', () => {
    expect(formatDate('2025-04-17T12:00:00')).toBe('Apr 17, 2025');
    expect(formatDate(new Date(2026, 10, 13))).toBe('Nov 13, 2026');
    expect(formatDateTime(new Date(2026, 10, 13, 13, 15))).toBe('Nov 13, 2026, 01:15 PM');
    expect(formatTime(new Date(2026, 10, 13, 13, 15, 2))).toBe('1:15:02 PM');
  });

  it('render a dash for a missing value', () => {
    expect(formatDate(null)).toBe('-');
    expect(formatDateTime(undefined)).toBe('-');
    expect(formatTime('')).toBe('-');
  });
});
