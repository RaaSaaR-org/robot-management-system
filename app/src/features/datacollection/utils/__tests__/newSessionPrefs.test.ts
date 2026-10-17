/**
 * @file newSessionPrefs.test.ts
 * @description Remembered New session values (TASK-392): malformed storage is
 *              ignored, recent tasks are deduplicated and capped.
 * @feature datacollection
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  DATASET_REPO_ID, NEW_SESSION_DEFAULTS, loadNewSessionPrefs, mergeRecentTasks, prefsKey, saveNewSessionPrefs, withRecentTask,
} from '../newSessionPrefs';

beforeEach(() => window.localStorage.clear());

describe('newSessionPrefs', () => {
  it('round-trips per user', () => {
    saveNewSessionPrefs('u1', { fps: 15, type: 'gamepad', recentTasks: ['a'] });
    expect(loadNewSessionPrefs('u1')).toMatchObject({ fps: 15, type: 'gamepad', recentTasks: ['a'] });
    expect(loadNewSessionPrefs('u2')).toEqual({});
  });

  it('stores the recording numbers only where they differ from the default', () => {
    saveNewSessionPrefs('u1', { fps: NEW_SESSION_DEFAULTS.fps, episodeTimeS: 60, numEpisodes: NEW_SESSION_DEFAULTS.numEpisodes });
    expect(JSON.parse(window.localStorage.getItem(prefsKey('u1'))!)).toEqual({ episodeTimeS: 60 });
  });

  it('ignores what the v1 form stored, defaults included', () => {
    // v1 kept the old 10 fps default as if it had been chosen.
    window.localStorage.setItem('neodem.datacollection.newSession.v1:u1', JSON.stringify({ fps: 10 }));
    expect(loadNewSessionPrefs('u1')).toEqual({});
  });

  it('drops malformed values', () => {
    window.localStorage.setItem(prefsKey('u1'), JSON.stringify({ fps: -3, type: 'telepathy', numEpisodes: 2.5, recentTasks: [1, ' ', 'ok'] }));
    expect(loadNewSessionPrefs('u1')).toEqual({ robotId: undefined, type: undefined, numEpisodes: undefined, episodeTimeS: undefined, fps: undefined, recentTasks: ['ok'] });
    window.localStorage.setItem(prefsKey('u1'), '{not json');
    expect(loadNewSessionPrefs('u1')).toEqual({});
  });

  it('keeps recent tasks newest first, unique and capped', () => {
    let list = withRecentTask(undefined, 'a');
    for (const t of ['b', 'c', 'd', 'e', 'f', ' A ']) list = withRecentTask(list, t);
    expect(list).toEqual(['A', 'f', 'e', 'd', 'c']);
    expect(mergeRecentTasks(['x', 'y'], [null, 'X', 'z'])).toEqual(['x', 'y', 'z']);
  });

  it('accepts name and owner/name dataset ids only', () => {
    expect(DATASET_REPO_ID.test('g1-pick')).toBe(true);
    expect(DATASET_REPO_ID.test('neodem/g1_pick.v2')).toBe(true);
    expect(DATASET_REPO_ID.test('a/b/c')).toBe(false);
    expect(DATASET_REPO_ID.test('bad name')).toBe(false);
    expect(DATASET_REPO_ID.test('/lead')).toBe(false);
  });
});
