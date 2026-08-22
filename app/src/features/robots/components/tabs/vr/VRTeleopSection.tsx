/**
 * @file VRTeleopSection.tsx
 * @description Meta Quest (WebXR) teleoperation. The Teleop tab hosts only a
 *              compact launcher card; the full experience (3D preview, controller
 *              mapping, "Enter VR") lives in a full-screen modal so it stays out
 *              of the way until intentionally opened. Open this page in the Quest
 *              browser, launch the modal, press "Enter VR", and the controllers
 *              drive the robot's simulated arm joints in real time. Controller
 *              poses are retargeted to absolute joint angles (see `vrRetarget.ts`)
 *              and streamed to the robot agent over the same `/ws/keyboard-teleop`
 *              WebSocket using the batch `{positions}` message. Hold the grip
 *              (squeeze) on a controller to move that arm; release to freeze it.
 * @feature robots
 */

import { useState, useEffect, useMemo } from 'react';
import { Card, Button, Modal } from '@/shared/components/ui';
import type { TeleopTabProps } from '../types';
import { EMULATOR_ACTIVE } from './vrConstants';
import { resolveXrAvailability, type XrAvailability } from './vrAvailability';
import { VRTeleopModalBody } from './VRTeleopModal';

// ============================================================================
// LAUNCHER — compact card shown in the Teleop tab
// ============================================================================

/** Small headset glyph for the launcher card. */
function HeadsetIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 11a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v3a2 2 0 0 1-2 2h-1.6a2 2 0 0 1-1.6-.8l-.9-1.2a1.5 1.5 0 0 0-1.2-.6h-3.4a1.5 1.5 0 0 0-1.2.6l-.9 1.2a2 2 0 0 1-1.6.8H5a2 2 0 0 1-2-2v-3Z" />
    </svg>
  );
}

/** One line each, matching the three states `resolveXrAvailability` tells apart. */
const AVAILABILITY_HINT: Record<XrAvailability, string> = {
  ready: 'Headset detected — launch to enter VR.',
  'insecure-origin':
    'This origin is not secure, so no browser exposes WebXR here — the headset included. Launch for the USB and network options.',
  unsupported: 'Open this page in a Meta Quest browser to enter VR. Launch to preview the robot.',
};

export interface VRTeleopSectionProps {
  robot: TeleopTabProps['robot'];
  /**
   * End the current episode and start the next — bound to the LEFT stick click
   * inside the headset, and listed on the modal's mapping card only when it is
   * supplied. Absent on the robot detail page, which has no session.
   */
  onNextEpisode?: () => void;
  /** The episode being captured, for the wrist HUD's REC line. */
  recording?: { episode: number; frames: number } | null;
}

export function VRTeleopSection({ robot, onNextEpisode, recording }: VRTeleopSectionProps) {
  const [open, setOpen] = useState(false);
  const [sessionSupported, setSessionSupported] = useState<boolean | null>(null);

  /**
   * Read once, at mount. Nothing here changes without a navigation: the origin
   * cannot become secure and `navigator.xr` cannot appear while the tab is open.
   */
  const availability = useMemo(
    () =>
      resolveXrAvailability({
        hasXr: (navigator as Navigator & { xr?: XRSystem }).xr != null,
        isSecureContext: window.isSecureContext,
        hostname: window.location.hostname,
      }),
    [],
  );

  // Whether a VR device is actually attached. Separate from `availability` on
  // purpose: "this browser has WebXR" and "this browser has a headset plugged
  // into it" are different answers, and only the second gates "Enter VR".
  useEffect(() => {
    let cancelled = false;
    const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
    if (!xr?.isSessionSupported) {
      setSessionSupported(false);
      return;
    }
    xr.isSessionSupported('immersive-vr')
      .then((ok) => { if (!cancelled) setSessionSupported(ok); })
      .catch(() => { if (!cancelled) setSessionSupported(false); });
    return () => { cancelled = true; };
  }, []);

  const hint = EMULATOR_ACTIVE
    ? 'Dev emulator available — launch to test without a headset.'
    : availability === 'ready' && sessionSupported === false
      ? 'WebXR is available, but no VR device is connected. Launch to preview the robot.'
      : AVAILABILITY_HINT[availability];

  return (
    <>
      <Card className="p-4">
        <div className="flex items-center gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-cobalt-500/15 text-cobalt-600 dark:text-cobalt-400">
            <HeadsetIcon className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-theme-primary">VR Teleop</h3>
              <span className="rounded-full bg-theme-secondary px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-theme-tertiary">
                Meta Quest
              </span>
            </div>
            <p className="mt-0.5 text-xs text-theme-secondary">{hint}</p>
          </div>
          <Button variant="primary" size="sm" onClick={() => setOpen(true)} className="shrink-0">
            Launch VR
          </Button>
        </div>
      </Card>

      <Modal isOpen={open} onClose={() => setOpen(false)} title="VR Teleop (Meta Quest)" size="full">
        <VRTeleopModalBody
          robot={robot}
          availability={availability}
          sessionSupported={sessionSupported}
          onClose={() => setOpen(false)}
          onNextEpisode={onNextEpisode}
          recording={recording}
        />
      </Modal>
    </>
  );
}
