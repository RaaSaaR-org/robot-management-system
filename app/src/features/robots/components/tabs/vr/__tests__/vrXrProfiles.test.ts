/**
 * @file vrXrProfiles.test.ts
 * @description TASK-397: the WebXR input profiles are served by the app itself,
 *              so a Quest on a network without internet still gets a controller
 *              state (and with it a grip). Checks the base URL and that every
 *              profile a Quest 3 controller can fall back to is shipped.
 * @feature robots
 */

import { describe, it, expect } from 'vitest';
import { XR_PROFILES_BASE } from '../vrConstants';

// The shipped profile files, as raw text keyed by path. import.meta.glob rather
// than node:fs, for the reason design-drift.test.ts gives: the app's tsconfig
// carries no Node types, and Vite resolves the glob when it transforms this file.
const PUBLIC_PROFILES = '../../../../../../../public/xr-profiles/';
const FILES = import.meta.glob<string>('../../../../../../../public/xr-profiles/**/*.json', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** The profile ids a Quest 3 (Touch Plus) controller or hand may report. */
const QUEST_PROFILE_IDS = [
  'meta-quest-touch-plus',
  'oculus-touch-v3',
  'oculus-touch-v2',
  'oculus-touch',
  'generic-trigger-squeeze-thumbstick',
  'generic-trigger',
  'generic-hand',
];

function readJson(file: string): Record<string, unknown> {
  const text = FILES[file];
  if (text === undefined) throw new Error(`not shipped: ${file}`);
  return JSON.parse(text) as Record<string, unknown>;
}

describe('XR_PROFILES_BASE', () => {
  it('is an absolute URL ending in /xr-profiles/', () => {
    const url = new URL(XR_PROFILES_BASE);
    expect(url.href).toBe(XR_PROFILES_BASE);
    expect(url.origin).toBe(window.location.origin);
    expect(XR_PROFILES_BASE.endsWith('/xr-profiles/')).toBe(true);
  });

  it('resolves profile files under itself, as the loader does', () => {
    expect(new URL('profilesList.json', XR_PROFILES_BASE).pathname).toMatch(
      /\/xr-profiles\/profilesList\.json$/,
    );
  });
});

describe('public/xr-profiles', () => {
  const list = readJson(`${PUBLIC_PROFILES}profilesList.json`) as Record<
    string,
    { path?: string }
  >;

  it.each(QUEST_PROFILE_IDS)('ships %s at the path profilesList.json names', (id) => {
    const entry = list[id];
    expect(entry?.path).toBeTruthy();
    const file = `${PUBLIC_PROFILES}${entry.path}`;
    expect(Object.keys(FILES)).toContain(file);
    expect(readJson(file).profileId).toBe(id);
  });

  it('ships every fallback the Quest Touch Plus profile itself names', () => {
    const profile = readJson(`${PUBLIC_PROFILES}${list['meta-quest-touch-plus'].path}`);
    const fallbacks = profile.fallbackProfileIds as string[];
    expect(fallbacks.length).toBeGreaterThan(0);
    for (const id of fallbacks) {
      expect(QUEST_PROFILE_IDS).toContain(id);
    }
  });
});
