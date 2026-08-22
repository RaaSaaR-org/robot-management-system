/**
 * @file VRSessionPanel.tsx
 * @description Control surface for VR teleoperation sessions (vr_quest /
 *              vr_vision_pro). Hosts the WebXR VR rig (a real headset on the
 *              same network opens this page and enters XR), a clearly-labeled
 *              "Simulate VR input" toggle that streams synthetic pick-and-place
 *              motion to the robot agent for headset-less testing, and a
 *              collapsed keyboard fallback.
 * @feature datacollection
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight, Waves } from 'lucide-react';
import { Card } from '@/shared/components/ui/Card';
import { VRTeleopSection } from '../../robots/components/tabs/vr/VRTeleopSection';
import { KeyboardTeleopSection } from '../../robots/components/tabs/TeleopTab';
import { useSimulatedVrInput, type SimInputStatus } from '../hooks/useSimulatedVrInput';
import type { Robot } from '../../robots/types/robots.types';

export interface VRSessionPanelProps {
  robot: Robot | null;
  /**
   * End the current episode and start the next one. Threaded down to the WebXR
   * rig, which binds it to the LEFT thumbstick click — an operator wearing a
   * Quest cannot reach the "Next episode" button on this page, and until they
   * could, episode boundaries were a thing only the person at the desk could set.
   */
  onNextEpisode?: () => void;
  /** The episode being captured, for the in-headset REC line. Null when idle. */
  recording?: { episode: number; frames: number } | null;
}

const STATUS_LABEL: Record<SimInputStatus, string> = {
  disconnected: 'Input disconnected',
  connecting: 'Connecting...',
  streaming: 'Streaming synthetic motion',
};

const STATUS_DOT: Record<SimInputStatus, string> = {
  disconnected: 'bg-gray-400',
  connecting: 'bg-yellow-400 animate-pulse',
  streaming: 'bg-green-500 animate-pulse',
};

export function VRSessionPanel({ robot, onNextEpisode, recording }: VRSessionPanelProps) {
  const [simulate, setSimulate] = useState(false);
  const [showKeyboard, setShowKeyboard] = useState(false);
  const simStatus = useSimulatedVrInput({ robot, enabled: simulate });

  if (!robot) {
    return (
      <Card data-testid="vr-session-panel">
        <p className="text-sm text-theme-muted">Robot not connected</p>
      </Card>
    );
  }

  return (
    <div className="space-y-3" data-testid="vr-session-panel">
      {/* Real headset path: WebXR rig (launcher card + full-screen modal) */}
      <VRTeleopSection robot={robot} onNextEpisode={onNextEpisode} recording={recording} />

      {/* Headset-less testing: synthetic input driver */}
      <Card className="!p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-brand bg-turquoise-500/15 text-turquoise-400">
              <Waves size={18} />
            </div>
            <div className="min-w-0">
              <label
                htmlFor="simulate-vr-input"
                className="text-sm font-medium text-theme-primary cursor-pointer"
              >
                Simulate VR input (no headset)
              </label>
              <p className="text-xs text-theme-muted mt-0.5">
                Streams smooth synthetic reach-and-grasp motion to the robot — use this to test
                recording without a headset.
              </p>
            </div>
          </div>
          {/* Toggle */}
          <button
            id="simulate-vr-input"
            role="switch"
            aria-checked={simulate}
            data-testid="simulate-vr-toggle"
            onClick={() => setSimulate((v) => !v)}
            className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${
              simulate ? 'bg-turquoise-500' : 'bg-glass-subtle border border-theme'
            }`}
          >
            <span
              className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                simulate ? 'translate-x-[22px]' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>

        {/* Status chip */}
        <div
          className="mt-3 inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-glass-subtle text-xs text-theme-secondary"
          data-testid="sim-input-status"
        >
          <span className={`w-2 h-2 rounded-full ${STATUS_DOT[simulate ? simStatus : 'disconnected']}`} />
          {simulate ? STATUS_LABEL[simStatus] : 'Simulation off'}
        </div>
      </Card>

      {/* Keyboard fallback — collapsed by default for VR sessions */}
      <Card className="!p-4">
        <button
          onClick={() => setShowKeyboard((v) => !v)}
          data-testid="keyboard-fallback-toggle"
          className="flex items-center gap-2 text-sm font-medium text-theme-secondary hover:text-theme-primary transition-colors w-full"
        >
          {showKeyboard ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          Keyboard fallback
          <span className="text-xs font-normal text-theme-tertiary">
            (drive joints without VR)
          </span>
        </button>
        {showKeyboard && (
          <div className="mt-3">
            <KeyboardTeleopSection robot={robot} />
          </div>
        )}
      </Card>
    </div>
  );
}
