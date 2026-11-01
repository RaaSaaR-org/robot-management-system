/**
 * @file useDeviceRole.test.ts
 * @description Which side of the session a browser is (TASK-426): a Quest
 *              user agent or the dev emulator is the headset, a desktop
 *              browser is not, and the Testing tools override wins.
 * @feature datacollection
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { detectDeviceRole, useDeviceRole } from '../useDeviceRole';

const QUEST_UA =
  'Mozilla/5.0 (X11; Linux x86_64; Quest 3) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/35.2.0.4.43 SamsungBrowser/4.0 Chrome/126.0.0.0 VR Safari/537.36';
const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

afterEach(() => vi.restoreAllMocks());

describe('detectDeviceRole', () => {
  it('reads a Meta Quest browser as the headset', () => {
    expect(detectDeviceRole(QUEST_UA, false)).toBe('headset');
  });

  it('reads a desktop browser as the desktop, even with an OpenXR runtime', () => {
    expect(detectDeviceRole(DESKTOP_UA, false)).toBe('desktop');
  });

  it('reads the dev ?xremu emulator as the headset', () => {
    expect(detectDeviceRole(DESKTOP_UA, true)).toBe('headset');
  });
});

describe('useDeviceRole', () => {
  it('follows the user agent', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(QUEST_UA);
    expect(renderHook(() => useDeviceRole()).result.current).toBe('headset');
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(DESKTOP_UA);
    expect(renderHook(() => useDeviceRole()).result.current).toBe('desktop');
  });

  it('lets the Testing tools override win', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(DESKTOP_UA);
    expect(renderHook(() => useDeviceRole('headset')).result.current).toBe('headset');
    expect(renderHook(() => useDeviceRole(null)).result.current).toBe('desktop');
  });
});
