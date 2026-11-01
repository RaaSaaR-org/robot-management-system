/**
 * @file useInputPresence.ts
 * @description What this browser can tell about the operator's input before a
 *              recording starts (TASK-392): secure context, whether it can
 *              open an immersive VR session, and whether a gamepad is
 *              connected. Read-only — it never opens a session or a device.
 * @feature datacollection
 */

import { useEffect, useState } from 'react';

export interface InputPresence {
  secureContext: boolean;
  /** null while the browser has not answered (or is not asked). */
  vrSupported: boolean | null;
  gamepadConnected: boolean;
}

interface XrLike {
  isSessionSupported?: (mode: string) => Promise<boolean>;
}

function anyGamepad(): boolean {
  try {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    return Array.from(pads ?? []).some((p) => !!p && p.connected !== false);
  } catch {
    return false;
  }
}

/**
 * @param askVr     ask WebXR for immersive-vr support (VR sessions only)
 * @param watchPads listen for gamepads (gamepad sessions only)
 */
export function useInputPresence(askVr: boolean, watchPads: boolean): InputPresence {
  const secureContext = typeof window !== 'undefined' && window.isSecureContext === true;
  const [vrSupported, setVrSupported] = useState<boolean | null>(null);
  const [gamepadConnected, setGamepadConnected] = useState(() => (watchPads ? anyGamepad() : false));

  useEffect(() => {
    if (!askVr) { setVrSupported(null); return; }
    const xr = (navigator as Navigator & { xr?: XrLike }).xr;
    if (!xr?.isSessionSupported) { setVrSupported(false); return; }
    let cancelled = false;
    xr.isSessionSupported('immersive-vr')
      .then((ok) => { if (!cancelled) setVrSupported(!!ok); })
      .catch(() => { if (!cancelled) setVrSupported(false); });
    return () => { cancelled = true; };
  }, [askVr]);

  useEffect(() => {
    if (!watchPads) return;
    const update = () => setGamepadConnected(anyGamepad());
    update();
    window.addEventListener('gamepadconnected', update);
    window.addEventListener('gamepaddisconnected', update);
    return () => {
      window.removeEventListener('gamepadconnected', update);
      window.removeEventListener('gamepaddisconnected', update);
    };
  }, [watchPads]);

  return { secureContext, vrSupported, gamepadConnected };
}
