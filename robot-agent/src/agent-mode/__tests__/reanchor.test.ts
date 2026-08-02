/**
 * @file reanchor.test.ts
 * @description Recognising *"you are in aisle 3"* — and, more importantly,
 *   NOT recognising "go to aisle 3" (TASK-200).
 * @feature agentmode
 *
 * A re-anchor is the one input allowed to outrank geometry, so the false
 * POSITIVES are the dangerous direction: a command that moves the robot must
 * never also move the robot's belief about where it already is.
 */

import { describe, expect, it } from 'vitest';
import { normalizePlacePhrase, parseReanchorUtterance } from '../reanchor.js';
import { parsePlaceGraph } from '../place-resolver.js';

const PLACES = parsePlaceGraph({
  version: 1,
  frame: { id: 'f', kind: 'site', units: 'm', yawConvention: 'deg,+x=0,CCW+' },
  places: [
    { id: 'AISLE-3', name: 'Aisle 3', placeType: 'aisle', floor: 0, source: 'surveyed', polygon: [[8, -4], [10, -4], [10, 2]] },
    { id: 'CHARGING-A', name: 'Charging Bay A', placeType: 'charging', floor: 0, source: 'surveyed', polygon: [[0, 0], [1, 0], [1, 1]] },
    { id: 'DOCK-1', name: 'Dock 1', placeType: 'dock', floor: 0, source: 'surveyed', polygon: [[-9, -3], [-5, -3], [-5, 3]] },
  ],
}).places;

describe('normalizePlacePhrase', () => {
  it('reduces ids, names and speech to the same tokens', () => {
    expect(normalizePlacePhrase('AISLE-3')).toBe('aisle 3');
    expect(normalizePlacePhrase('Aisle 3')).toBe('aisle 3');
    // Speech-to-text spells numbers out; a place id never does.
    expect(normalizePlacePhrase('aisle three')).toBe('aisle 3');
    expect(normalizePlacePhrase('the charging bay a area')).toBe('charging bay a');
  });
});

describe('parseReanchorUtterance — statements', () => {
  it.each([
    'you are in aisle 3',
    "You're in Aisle 3.",
    'you are now in aisle three',
    'we are in aisle 3',
    'the robot is in aisle 3',
    'this is aisle 3',
    // German: the voice stack on this box runs bilingually, and this is how the
    // re-anchor will actually be said out loud next to the robot.
    'du bist in Aisle 3',
    'du bist jetzt im AISLE-3',
    'wir sind in aisle 3',
  ])('recognises %j', (text) => {
    expect(parseReanchorUtterance(text, PLACES)?.placeId).toBe('AISLE-3');
  });

  it('matches on the human name as well as the id', () => {
    expect(parseReanchorUtterance('you are in the charging bay a', PLACES)?.placeId).toBe('CHARGING-A');
  });

  it('prefers the longest match, so AISLE-3 is never beaten by AISLE', () => {
    const withParent = [
      ...PLACES,
      { ...PLACES[0]!, id: 'AISLE', name: 'Aisle' },
    ];
    expect(parseReanchorUtterance('you are in aisle 3', withParent)?.placeId).toBe('AISLE-3');
  });

  it('carries the spoken phrase through for the acknowledgement', () => {
    expect(parseReanchorUtterance('You are in Dock 1!', PLACES)).toMatchObject({
      placeId: 'DOCK-1',
      placeName: 'Dock 1',
      spoken: 'Dock 1',
    });
  });
});

describe('parseReanchorUtterance — everything that is NOT a re-anchor', () => {
  it.each([
    'go to aisle 3',
    'walk to aisle 3 and look around',
    'is anyone in aisle 3?',
    'put the box down in aisle 3',
    'remember that aisle 3 is blocked',
    'what do you see in aisle 3',
    // A mention in a subordinate clause: an operator re-anchors by SAYING so.
    'after you finish, tell me if you are in aisle 3',
  ])('refuses %j', (text) => {
    expect(parseReanchorUtterance(text, PLACES)).toBeNull();
  });

  it('refuses a statement about a place the graph does not have', () => {
    // Guessing the nearest-sounding place would move the robot's belief about
    // where it is on the strength of a mishearing.
    expect(parseReanchorUtterance('you are in aisle 9', PLACES)).toBeNull();
    expect(parseReanchorUtterance('you are in the canteen', PLACES)).toBeNull();
    expect(parseReanchorUtterance('du bist in Gang 3', PLACES)).toBeNull();
  });

  it('refuses empty and place-less utterances', () => {
    expect(parseReanchorUtterance('', PLACES)).toBeNull();
    expect(parseReanchorUtterance('you are in ', PLACES)).toBeNull();
    expect(parseReanchorUtterance('you are in the way', PLACES)).toBeNull();
  });

  it('refuses everything when the robot has no place graph', () => {
    expect(parseReanchorUtterance('you are in aisle 3', [])).toBeNull();
  });
});
