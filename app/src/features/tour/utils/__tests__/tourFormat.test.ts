/**
 * @file tourFormat.test.ts
 * @description The talk-track chunking and speech estimate the editor shows an
 *              author — pinned against what the ROBOT does with the same text
 *              (`chunkTalkTrack` / `estimateSpeechSeconds` in
 *              robot-agent/src/agent-mode/host.ts). If host.ts changes its
 *              chunking or its characters-per-second, this test is the tripwire:
 *              a counter that quietly disagrees with the robot is worse than no
 *              counter, because an author believes it.
 * @feature tour
 */

import { describe, it, expect } from 'vitest';
import {
  TOUR_SPEECH_CHARS_PER_S,
  TOUR_STOP_SPEECH_CAP_S,
  chunkTalkTrack,
  declinedTurns,
  estimateSpeechSeconds,
  estimateTourSeconds,
  formatEstimate,
  isRunActive,
  runProgressText,
  stopSpeechSeconds,
  talkTrackTruncated,
  transcriptState,
} from '../tourFormat';
import { TOUR_TALK_TRACK_MAX } from '../../types/tour.types';
import type { TourRun, TourStop, TourTurn } from '../../types/tour.types';

/**
 * Sixteen 35-character sentences plus a 24-character closer, single spaces:
 * exactly {@link TOUR_TALK_TRACK_MAX} characters — a talk track written right up
 * to the wire cap, which is the case the cap actually bites in.
 */
const SENTENCES = [
  ...Array.from({ length: 16 }, (_, i) => `Dies ist Satz ${String(i + 1).padStart(2, '0')} an dieser Station.`),
  'Damit endet der Vortrag.',
];
const TRACK = SENTENCES.join(' ');

describe('chunkTalkTrack — the robot’s own chunking', () => {
  it('the fixture really is a 600-character track', () => {
    expect(TRACK).toHaveLength(TOUR_TALK_TRACK_MAX);
    expect(SENTENCES).toHaveLength(17);
  });

  it('splits a 600-char track into ≤2-sentence parts and drops the tail past the 40 s cap', () => {
    // 17 sentences → 9 parts; the 8th would take the stop to 40.8 s, so the
    // robot stops after 7 and says 35.7 s worth. Same numbers on both sides.
    expect(chunkTalkTrack(TRACK, Number.POSITIVE_INFINITY)).toHaveLength(9);
    const kept = chunkTalkTrack(TRACK);
    expect(kept).toHaveLength(7);
    expect(kept[0]).toBe('Dies ist Satz 01 an dieser Station. Dies ist Satz 02 an dieser Station.');
    expect(kept[kept.length - 1]).toBe('Dies ist Satz 13 an dieser Station. Dies ist Satz 14 an dieser Station.');
    expect(stopSpeechSeconds(TRACK)).toBeCloseTo(35.7, 1);
    expect(stopSpeechSeconds(TRACK)).toBeLessThanOrEqual(TOUR_STOP_SPEECH_CAP_S);
    expect(talkTrackTruncated(TRACK)).toBe(true);
  });

  it('never splits mid-sentence, and keeps ! ? … as sentence ends', () => {
    expect(chunkTalkTrack('Eins! Zwei? Drei… Vier.')).toEqual(['Eins! Zwei?', 'Drei… Vier.']);
    // No terminator at all is still one sentence — not a dropped line.
    expect(chunkTalkTrack('Kein Punkt am Ende')).toEqual(['Kein Punkt am Ende']);
    expect(chunkTalkTrack('   ')).toEqual([]);
  });

  it('always keeps the first part, even when it alone is over the cap', () => {
    const monster = `${'a'.repeat(TOUR_STOP_SPEECH_CAP_S * TOUR_SPEECH_CHARS_PER_S * 2)}.`;
    // A stop that says nothing at all is worse than one that runs over.
    expect(chunkTalkTrack(monster)).toHaveLength(1);
  });

  it('estimates speech at 14 characters per second, to one decimal', () => {
    expect(estimateSpeechSeconds('a'.repeat(TOUR_SPEECH_CHARS_PER_S))).toBe(1);
    expect(estimateSpeechSeconds('a'.repeat(70))).toBe(5);
    expect(estimateSpeechSeconds('  ab  ')).toBeCloseTo(0.1, 1);
  });
});

describe('estimateTourSeconds', () => {
  const stop = (over: Partial<TourStop> = {}): TourStop => ({
    id: 's1',
    placeId: 'AISLE-1',
    headline: 'Aisle 1',
    talkTrack: 'a'.repeat(TOUR_SPEECH_CHARS_PER_S * 10) + '.',
    facts: [],
    demo: null,
    dwellS: 12,
    askToContinue: false,
    ...over,
  });

  it('counts speech, dwell, demos and a walk per stop', () => {
    const base = estimateTourSeconds({ greeting: '', farewell: '', stops: [] });
    // Greeting + farewell + the walk to the first stop.
    expect(base).toBe(20);
    const one = estimateTourSeconds({ greeting: '', farewell: '', stops: [stop()] });
    expect(one).toBe(base + 20 + 12 + Math.round(estimateSpeechSeconds(stop().talkTrack)));
    const withDemo = estimateTourSeconds({
      greeting: '',
      farewell: '',
      stops: [stop({ demo: { skillId: 'sk', skillName: 'Apple pick', modelVersionId: null, expectSeconds: 30 } })],
    });
    expect(withDemo).toBe(one + 30);
  });

  it('prints an estimate without false precision', () => {
    expect(formatEstimate(45)).toBe('about 45 s');
    expect(formatEstimate(360)).toBe('about 6 min');
  });
});

describe('run summaries', () => {
  const turn = (over: Partial<TourTurn> = {}): TourTurn => ({
    at: '2026-08-17T10:00:00.000Z',
    stopId: 's1',
    question: 'Was kostet der Roboter?',
    answer: 'Das weiß ich nicht.',
    answered: 'declined',
    language: 'de',
    ...over,
  });
  const run = (over: Partial<TourRun> = {}): TourRun => ({
    runId: 'run-1',
    routeId: 'route-1',
    routeName: 'ZeMA visitor tour',
    robotId: 'g1',
    origin: 'visitor',
    status: 'done',
    startedAt: '2026-08-17T10:00:00.000Z',
    finishedAt: '2026-08-17T10:08:00.000Z',
    legs: [
      { index: 0, stopId: 's1', placeId: 'a', name: 'A', status: 'done' },
      { index: 1, stopId: 's2', placeId: 'b', name: 'B', status: 'failed' },
      { index: 2, stopId: 's3', placeId: 'c', name: 'C', status: 'pending' },
    ],
    turns: [turn(), turn({ answered: 'grounded' })],
    language: 'de',
    disclosureSpoken: true,
    ...over,
  });

  it('counts only the stops the visitor was SHOWN, and names the rest', () => {
    expect(runProgressText(run())).toBe('1/3 stops shown · 1 failed · 2 questions');
  });

  it('a visit that ended early does not read as a complete one', () => {
    const early = run({
      status: 'abandoned',
      legs: [
        { index: 0, stopId: 's1', placeId: 'a', name: 'A', status: 'done' },
        { index: 1, stopId: 's2', placeId: 'b', name: 'B', status: 'skipped' },
        { index: 2, stopId: 's3', placeId: 'c', name: 'C', status: 'skipped' },
      ],
    });
    expect(runProgressText(early)).toBe('1/3 stops shown · 2 skipped · 2 questions');
    // The run list has a Questions column of its own; repeating it there is
    // what overflowed a 390px viewport.
    expect(runProgressText(early, { questions: false })).toBe('1/3 stops shown · 2 skipped');
  });

  it('collects the questions the facts did not cover', () => {
    expect(declinedTurns(run())).toHaveLength(1);
    expect(declinedTurns(null)).toEqual([]);
  });

  it('only a running tour is active', () => {
    expect(isRunActive(run({ status: 'running' }))).toBe(true);
    expect(isRunActive(run({ status: 'declined' }))).toBe(false);
    expect(isRunActive(null)).toBe(false);
  });
});

describe('transcriptState', () => {
  const emptyRun = (startedAt: string): TourRun => ({
    runId: 'r',
    routeId: 'x',
    routeName: 'x',
    robotId: 'g1',
    origin: 'operator',
    status: 'done',
    startedAt,
    finishedAt: startedAt,
    legs: [],
    turns: [],
    language: 'de',
    disclosureSpoken: true,
  });
  const now = Date.parse('2026-08-17T12:00:00.000Z');

  it('a recent run with no turns simply had no questions', () => {
    expect(transcriptState(emptyRun('2026-08-16T12:00:00.000Z'), now)).toBe('none');
  });

  it('an old run with no turns was swept — never reported as "nobody asked"', () => {
    // The robot's TourRunStore.sweep() clears turns past the retention window
    // and keeps the run. Rendering that as an empty transcript would be a claim
    // about a visitor's conversation the record can no longer support.
    expect(transcriptState(emptyRun('2026-01-01T12:00:00.000Z'), now)).toBe('swept');
  });

  it('turns in hand are turns in hand', () => {
    const run = emptyRun('2026-01-01T12:00:00.000Z');
    expect(
      transcriptState(
        { ...run, turns: [{ at: 'x', stopId: null, question: 'q', answer: 'a', answered: 'grounded', language: 'de' }] },
        now
      )
    ).toBe('present');
  });
});
