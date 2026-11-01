/**
 * @file useDeviceRole.ts
 * @description Which side of a two-person session this browser is (TASK-426):
 *              the headset (a Meta Quest browser, or the dev `?xremu` WebXR
 *              emulator) or a desktop. `isSessionSupported('immersive-vr')`
 *              is not enough on its own — desktop Chrome with an OpenXR
 *              runtime reports it too — so the user agent decides. Testing
 *              tools can override it ("Show the headset view here").
 * @feature datacollection
 */

import { EMULATOR_ACTIVE } from '../../robots/components/tabs/vr/vrConstants';

export type DeviceRole = 'headset' | 'desktop';

const HEADSET_UA = /OculusBrowser|Quest/i;

/** The role a browser has from its user agent and the WebXR emulator alone. */
export function detectDeviceRole(userAgent: string, emulatorActive: boolean): DeviceRole {
  return emulatorActive || HEADSET_UA.test(userAgent) ? 'headset' : 'desktop';
}

/**
 * The page's device role. `override` (from Testing tools) wins; otherwise the
 * user agent and the emulator decide. Neither changes while the tab is open,
 * so it is read on every render without state.
 */
export function useDeviceRole(override?: DeviceRole | null): DeviceRole {
  if (override) return override;
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  return detectDeviceRole(ua, EMULATOR_ACTIVE);
}
