/**
 * @file move-args.test.ts
 * @description `roboctl move <place>` vs `roboctl move <x> <y>` (TASK-329).
 * @feature cli
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeDestination, parseMoveArgs } from './move-args.js';

test('a single non-numeric argument is a place', () => {
  assert.deepEqual(parseMoveArgs(['CHARGING-A']), { place: 'CHARGING-A' });
});

test('two numbers are coordinates', () => {
  assert.deepEqual(parseMoveArgs(['3', '-1.5']), { x: 3, y: -1.5 });
});

test('a multi-word place is joined', () => {
  assert.deepEqual(parseMoveArgs(['Aisle', '1']), { place: 'Aisle 1' });
});

test('a lone number is a place name, not half a coordinate', () => {
  assert.deepEqual(parseMoveArgs(['7']), { place: '7' });
});

test('--place and --floor ride along with coordinates', () => {
  assert.deepEqual(parseMoveArgs(['1', '2'], { place: 'AISLE-1', floor: '1' }), {
    x: 1,
    y: 2,
    place: 'AISLE-1',
    floor: '1',
  });
});

test('no arguments is a usage error', () => {
  assert.throws(() => parseMoveArgs([]), /Usage: move <place>/);
});

test('destinations read naturally', () => {
  assert.equal(describeDestination({ place: 'CHARGING-A' }), '"CHARGING-A"');
  assert.equal(describeDestination({ x: 1, y: 2 }), '(1, 2)');
});
