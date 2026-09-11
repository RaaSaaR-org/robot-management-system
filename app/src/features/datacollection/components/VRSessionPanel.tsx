/**
 * @file VRSessionPanel.tsx
 * @description Control surface for VR teleoperation sessions (vr_quest /
 *              vr_vision_pro). Hosts the WebXR VR rig (a real headset on the
 *              same network opens this page and enters XR), a clearly-labeled
 *              "Simulate VR input" switch that streams synthetic pick-and-place
 *              motion to the robot agent for headset-less testing, and a
 *              collapsed keyboard fallback.
 * @feature datacollection
 */

import { useState } from 'react';
import { Button, Panel, StatusTag, Switch, type StatusTagTone } from '@/shared/components/ui';
import { VRTeleopSection } from '../../robots/components/tabs/vr/VRTeleopSection';
import { KeyboardTeleopSection } from '../../robots/components/tabs/TeleopTab';
import { useSimulatedVrInput, type SimInputStatus } from '../hooks/useSimulatedVrInput';
import type { Robot } from '../../robots/types/robots.types';

export interface VRSessionPanelProps {
  robot: Robot | null;
  /**
   * End the current episode and start the next one. Threaded down to the WebXR
   * rig, which binds it to the LEFT thumbstick click — an operator wearing a
   * Quest cannot reach the "Next episode" button on this page.
   * Resolves to whether the boundary was actually drawn — the rig only
   * buzzes the controller when it was. See `VrTeleopRig`.
   */
  onNextEpisode?: () => boolean | Promise<boolean>;
  /** The episode being captured, for the in-headset REC line. Null when idle. */
  recording?: { episode: number; frames: number } | null;
}

const STATUS: Record<SimInputStatus | 'off', { label: string; tone: StatusTagTone }> = {
  off: { label: 'Simulation off', tone: 'neutral' },
  disconnected: { label: 'Input disconnected', tone: 'neutral' },
  connecting: { label: 'Connecting…', tone: 'warning' },
  streaming: { label: 'Streaming synthetic motion', tone: 'sim' },
};

export function VRSessionPanel({ robot, onNextEpisode, recording }: VRSessionPanelProps) {
  const [simulate, setSimulate] = useState(false);
  const [showKeyboard, setShowKeyboard] = useState(false);
  const simStatus = useSimulatedVrInput({ robot, enabled: simulate });
  const status = STATUS[simulate ? simStatus : 'off'];

  if (!robot) {
    return (
      <Panel data-testid="vr-session-panel">
        <Panel.Header title="VR input" />
        <Panel.Body>
          <p className="text-[13px] text-ink-tertiary">Robot offline. Start the robot agent to connect a headset.</p>
        </Panel.Body>
      </Panel>
    );
  }

  return (
    <div className="flex flex-col gap-6" data-testid="vr-session-panel">
      {/* Real headset path: WebXR rig (launcher card + full-screen modal) */}
      <VRTeleopSection robot={robot} onNextEpisode={onNextEpisode} recording={recording} />

      <Panel>
        <Panel.Header title="Test without a headset" />
        <Panel.Body className="flex flex-col gap-3">
          <Switch
            id="simulate-vr-input"
            data-testid="simulate-vr-toggle"
            checked={simulate}
            onCheckedChange={setSimulate}
            label="Simulate VR input"
            description="Streams smooth synthetic reach-and-grasp motion to the robot, so you can test recording end to end."
          />
          <div data-testid="sim-input-status">
            <StatusTag tone={status.tone} dot pulse={simulate && simStatus !== 'disconnected'}>{status.label}</StatusTag>
          </div>
        </Panel.Body>
      </Panel>

      <Panel>
        <Panel.Header
          title="Keyboard fallback"
          description="Drive joints without VR."
          actions={
            <Button variant="ghost" size="sm" data-testid="keyboard-fallback-toggle" onClick={() => setShowKeyboard((v) => !v)}>
              {showKeyboard ? 'Hide' : 'Show'}
            </Button>
          }
        />
        {showKeyboard && (
          <Panel.Body>
            <KeyboardTeleopSection robot={robot} />
          </Panel.Body>
        )}
      </Panel>
    </div>
  );
}
