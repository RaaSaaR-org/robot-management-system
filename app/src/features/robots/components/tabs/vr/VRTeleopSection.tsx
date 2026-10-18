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

import { useState, useEffect, useMemo, useRef } from 'react';
import { Glasses } from 'lucide-react';
import { Button, Modal, Panel, StatusTag } from '@/shared/components/ui';
import type { TeleopTabProps } from '../types';
import { EMULATOR_ACTIVE } from './vrConstants';
import { resolveXrAvailability, type XrAvailability } from './vrAvailability';
import { VRTeleopModalBody } from './VRTeleopModal';
import { QuestConnectHelp } from './QuestConnectHelp';
import { RobotReadinessPanel } from '../../readiness/RobotReadinessPanel';
import type { VrSessionBridge } from './vrSessionBridge';

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
   * The recording session (TASK-413): the session board, the stick shortcuts
   * and the wrist HUD's take line inside the headset. Absent on the robot
   * detail page, which has no session — then none of them exist.
   */
  vrSession?: VrSessionBridge;
  /**
   * Set while another input drives the robot (the session page's simulated VR,
   * TASK-396): "Launch VR" is disabled and this line replaces the hint.
   */
  launchDisabledReason?: string;
  /**
   * The full-screen VR modal opened or closed (TASK-414): the session page
   * then unmounts its own 3D viewer and camera tiles behind it, and stops
   * declaring itself the desktop assistant.
   */
  onOpenChange?: (open: boolean) => void;
  /**
   * Show the compact readiness panel in the card (default). Off where the page
   * shows it elsewhere (the session page's side column, TASK-414) — that one
   * keeps the readiness store fresh for the headset's robot panel instead.
   */
  showReadiness?: boolean;
}

export function VRTeleopSection({ robot, vrSession, launchDisabledReason, onOpenChange, showReadiness = true }: VRTeleopSectionProps) {
  const [open, setOpen] = useState(false);
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  useEffect(() => {
    onOpenChangeRef.current?.(open);
  }, [open]);
  // Closing on unmount: the page must not keep its viewer hidden for a modal that is gone.
  useEffect(() => () => onOpenChangeRef.current?.(false), []);
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
              disabled={!!launchDisabledReason}
              data-testid="vr-launch"
            >
              Launch VR
            </Button>
          }
        />
        <Panel.Body>
          {/* TASK-411: why the arms would not follow, before anyone puts the
              headset on — the session page gets it through this section (D5). */}
          {showReadiness && <RobotReadinessPanel robotId={robot.id} variant="compact" className="mb-3" />}
          <div className="flex flex-wrap items-center gap-3">
            <StatusTag tone={EMULATOR_ACTIVE || (availability === 'ready' && sessionSupported) ? 'live' : 'neutral'} dot>
              {EMULATOR_ACTIVE
                ? 'Emulator'
                : availability === 'ready' && sessionSupported
                  ? 'Headset ready'
                  : 'No headset'}
            </StatusTag>
            <p className="text-[13px] text-ink-secondary" data-testid="vr-launch-hint">{launchDisabledReason ?? hint}</p>
          </div>
          {/* TASK-393: how to get a Quest onto this page — collapsed once the
              page can already do WebXR, open when it cannot. */}
          {!EMULATOR_ACTIVE && (
            <div className="mt-3">
              <QuestConnectHelp location={window.location} robotId={robot.id} />
            </div>
          )}
        </Panel.Body>
      </Panel>

      <Modal isOpen={open} onClose={() => setOpen(false)} title="VR teleop (Meta Quest)" size="full">
        <VRTeleopModalBody
          robot={robot}
          availability={availability}
          sessionSupported={sessionSupported}
          onClose={() => setOpen(false)}
          vrSession={vrSession}
        />
      </Modal>
    </>
  );
}
