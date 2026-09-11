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
import { Glasses } from 'lucide-react';
import { Button, Modal, Panel, StatusTag } from '@/shared/components/ui';
import type { TeleopTabProps } from '../types';
import { EMULATOR_ACTIVE } from './vrConstants';
import { resolveXrAvailability, type XrAvailability } from './vrAvailability';
import { VRTeleopModalBody } from './VRTeleopModal';

// ============================================================================
// LAUNCHER — compact card shown in the Teleop tab
// ============================================================================

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
  /**
   * Resolves to whether the boundary was actually drawn — the rig only
   * buzzes the controller when it was. See `VrTeleopRig`.
   */
  onNextEpisode?: () => boolean | Promise<boolean>;
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
      <Panel>
        <Panel.Header
          title="VR teleop (Meta Quest)"
          description="Drive the robot's arms with Quest controllers over WebXR."
          actions={
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Glasses className="h-4 w-4" strokeWidth={1.75} />}
              onClick={() => setOpen(true)}
            >
              Launch VR
            </Button>
          }
        />
        <Panel.Body>
          <div className="flex flex-wrap items-center gap-3">
            <StatusTag tone={EMULATOR_ACTIVE || (availability === 'ready' && sessionSupported) ? 'live' : 'neutral'} dot>
              {EMULATOR_ACTIVE
                ? 'Emulator'
                : availability === 'ready' && sessionSupported
                  ? 'Headset ready'
                  : 'No headset'}
            </StatusTag>
            <p className="text-[13px] text-ink-secondary">{hint}</p>
          </div>
        </Panel.Body>
      </Panel>

      <Modal isOpen={open} onClose={() => setOpen(false)} title="VR teleop (Meta Quest)" size="full">
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
