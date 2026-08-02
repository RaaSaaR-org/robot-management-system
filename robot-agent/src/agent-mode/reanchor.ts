/**
 * @file reanchor.ts
 * @description *"You are in aisle 3."* — recognising an operator telling the
 *              robot where it is (TASK-200), so the belief can be re-anchored to
 *              `source: 'declared'` with the drift budget spent afresh.
 *
 *              Pure and deterministic: no model call. A re-anchor overrides
 *              geometry, and a statement that important is not something an LLM
 *              gets to infer from "go and check aisle 3".
 * @feature agentmode
 * @status live
 */

import type { Place } from './place-resolver.js';

/**
 * Phrases that make the rest of the sentence a CLAIM ABOUT THE ROBOT'S POSITION
 * rather than an instruction.
 *
 * The distinction is the whole safety argument of this file. *"You are in aisle
 * 3"* re-anchors; *"go to aisle 3"*, *"is anyone in aisle 3?"* and *"put it down
 * in aisle 3"* must not, and none of them start with one of these. German is
 * here because the voice stack runs bilingually on this box and *"du bist in
 * Halle A"* is how the re-anchor will actually be said out loud.
 *
 * Each pattern is anchored at the START of the utterance: an operator re-anchors
 * by saying so, not by mentioning it in a subordinate clause.
 */
const LEAD_INS: readonly RegExp[] = [
  /^you(?:'re|\s+are)\s+(?:now\s+)?(?:in|at)\s+(.+)$/i,
  /^we(?:'re|\s+are)\s+(?:now\s+)?(?:in|at)\s+(.+)$/i,
  /^(?:the\s+)?robot\s+is\s+(?:now\s+)?(?:in|at)\s+(.+)$/i,
  /^this\s+is\s+(.+)$/i,
  /^du\s+bist\s+(?:jetzt\s+)?(?:in|im|an|am|bei)\s+(?:der\s+|die\s+|das\s+|dem\s+)?(.+)$/i,
  /^wir\s+sind\s+(?:jetzt\s+)?(?:in|im|an|am|bei)\s+(?:der\s+|die\s+|das\s+|dem\s+)?(.+)$/i,
  /^(?:das\s+)?(?:hier\s+)?ist\s+(?:der\s+|die\s+|das\s+)?(.+)$/i,
];

/**
 * Articles, dropped only in LEADING position.
 *
 * `a` is both an English article and the last token of `Charging Bay A`, so
 * stripping it everywhere would collapse bay A and bay B onto the same key and
 * re-anchor the robot into whichever the loop happened to reach first.
 */
const LEADING_ARTICLES = new Set(['the', 'a', 'an', 'der', 'die', 'das', 'dem', 'den']);

/** Words that carry no meaning wherever they appear in a place phrase. */
const FILLER = new Set(['area', 'zone', 'bereich']);

/**
 * `Aisle 3` / `AISLE-3` / `aisle three` → `aisle 3`. Spelled-out digits are
 * mapped because speech-to-text produces them and a place id never does.
 */
const SPOKEN_NUMBERS: Record<string, string> = {
  one: '1', two: '2', three: '3', four: '4', five: '5',
  six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
  eins: '1', zwei: '2', drei: '3', vier: '4', fünf: '5',
  sechs: '6', sieben: '7', acht: '8', neun: '9', zehn: '10',
};

/** Reduce an id, a name or a spoken phrase to comparable tokens. */
export function normalizePlacePhrase(text: string): string {
  const tokens = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .map((token) => SPOKEN_NUMBERS[token] ?? token)
    .filter((token) => token.length > 0 && !FILLER.has(token));
  while (tokens.length > 1 && LEADING_ARTICLES.has(tokens[0] as string)) tokens.shift();
  return tokens.join(' ');
}

/** What an operator's statement resolved to. */
export interface ReanchorRequest {
  /** The place graph id to declare. */
  placeId: string;
  /** The place's human name, for the acknowledgement. */
  placeName: string;
  /** The phrase that matched, so the operator can see what was understood. */
  spoken: string;
}

/**
 * Parse an operator utterance into a re-anchor, or `null` when it is not one.
 *
 * Returning `null` for anything ambiguous is the point: an unrecognised place
 * name falls through to the planner as an ordinary command, which is a harmless
 * outcome. Guessing the nearest-sounding place would move the robot's belief
 * about where it is on the strength of a mishearing.
 */
export function parseReanchorUtterance(
  text: string,
  places: readonly Place[],
): ReanchorRequest | null {
  const trimmed = text.trim().replace(/[.!?]+$/, '');
  if (!trimmed) return null;

  let phrase: string | null = null;
  for (const pattern of LEAD_INS) {
    const match = pattern.exec(trimmed);
    if (match?.[1]) {
      phrase = match[1];
      break;
    }
  }
  if (phrase === null) return null;

  const normalized = normalizePlacePhrase(phrase);
  if (!normalized) return null;

  // Exact first, then "the phrase contains the place name" (so "you are in the
  // charging bay a right now" still resolves), longest match winning so
  // AISLE-3 is never beaten by a place called AISLE.
  let best: { place: Place; score: number } | null = null;
  for (const place of places) {
    for (const candidate of [place.id, place.name]) {
      const key = normalizePlacePhrase(candidate);
      if (!key) continue;
      const score = key === normalized ? 1000 + key.length : normalized.includes(key) ? key.length : 0;
      if (score > 0 && (!best || score > best.score)) best = { place, score };
    }
  }

  if (!best) return null;
  return { placeId: best.place.id, placeName: best.place.name, spoken: phrase.trim() };
}
