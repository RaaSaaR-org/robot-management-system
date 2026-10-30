/**
 * @file VRSessionPanel.tsx
 * @description Control surface for VR teleoperation sessions (vr_quest /
 *              vr_vision_pro). Hosts the WebXR VR rig (a real headset on the
 *              same network opens this page and enters XR), a clearly-labeled
 *              "Simulate VR input" switch that streams synthetic pick-and-place
 *              motion to the robot agent for headset-less testing, and a
 *              collapsed keyboard fallback. The simulated input joins the
 *              session page's control lease when one is passed (TASK-320).
 *              The page owns the switch (TASK-396): it holds its lease only
 *              while simulating, and the headset path is closed meanwhile, so
 *              the operator only ever sees one "Take control".
 *              TASK-413: the headset reads the session's shared live state and
 *              starts, stops, advances and discards takes through one
 *              `VrSessionBridge` built here from the data-collection store.
 *              TASK-418: the bridge also carries the task instruction, the
 *              session's frame count, and who ended it (from presence).
 *              TASK-426: on the session page it is drawn as the Testing tools
 *              rows (desktop) or as the headset hero's Launch VR (Quest); it
 *              stays the one owner of the VR modal, the simulated input and
 *              the goodbye in either role.
 * @feature datacollection
 */

import { useMemo, useState } from 'react';
import { Glasses } from 'lucide-react';
import { Button, Panel, StatusTag, Switch, type StatusTagTone } from '@/shared/components/ui';
import { VRTeleopSection, type VRLauncherState } from '../../robots/components/tabs/vr/VRTeleopSection';
import { KeyboardTeleopSection } from '../../robots/components/tabs/TeleopTab';
import { useSimulatedVrInput, type SimInputStatus } from '../hooks/useSimulatedVrInput';
import type { Robot } from '../../robots/types/robots.types';
import type { InputLease } from '../hooks/inputLease';
import { useDataCollectionStore, selectKept } from '../store/datacollectionStore';
import { groupLabel, warningLabel } from '../utils/takeFormat';
import { watchingLabel } from '../utils/presenceFormat';
import { TestingToolsRow } from './console/TestingTools';
import {
  buildVrSessionView,
  type VrSessionBridge,
  type VrTakeOutcome,
} from '../../robots/components/tabs/vr/vrSessionBridge';

/**
 * Where the panel is drawn (TASK-426). `card`: the stacked cards (the default,
 * outside the session page). `tools`: rows of the session page's Testing tools
 * popover on a desktop. `hero`: Launch VR as the primary of the headset hero.
 * The session page mounts exactly one, in either role.
 */
export type VRSessionPanelVariant = 'card' | 'tools' | 'hero';

export interface VRSessionPanelProps {
  robot: Robot | null;
  /** The session page's control lease; the simulated input streams only while it is bound. */
  lease?: InputLease;
  /** "Simulate VR input" switch, when the page owns it; local state otherwise. */
  simulate?: boolean;
  onSimulateChange?: (on: boolean) => void;
  /** The VR modal opened or closed (TASK-414). */
  onVrOpenChange?: (open: boolean) => void;
  /** Show the readiness panel in the VR card (default); the session page shows it in its side column. */
  showReadiness?: boolean;
  /** How the panel is drawn (default `card`). */
  variant?: VRSessionPanelVariant;
}

const STATUS: Record<SimInputStatus | 'off', { label: string; tone: StatusTagTone }> = {
  off: { label: 'Simulation off', tone: 'neutral' },
  disconnected: { label: 'Input disconnected', tone: 'neutral' },
  connecting: { label: 'Connecting…', tone: 'warning' },
  awaiting_control: { label: 'Take control to stream', tone: 'warning' },
  streaming: { label: 'Streaming synthetic motion', tone: 'sim' },
};

const OFFLINE = 'Robot offline. Start the robot agent to connect a headset.';

export function VRSessionPanel({
  robot, lease, simulate: simulateProp, onSimulateChange, onVrOpenChange, showReadiness = true, variant = 'card',
}: VRSessionPanelProps) {
  const sessionId = useDataCollectionStore((s) => s.selectedSession?.id ?? null);
  // TASK-413 (D2): one object for the headset, read through a getter from the
  // scene's frame loops — the canvas never re-renders because a take ticked.
  const vrSession = useMemo(() => (sessionId ? createVrSessionBridge(sessionId) : undefined), [sessionId]);
  const [simulateLocal, setSimulateLocal] = useState(false);
  const simulate = simulateProp ?? simulateLocal;
  const setSimulate = (on: boolean): void => {
    setSimulateLocal(on);
    onSimulateChange?.(on);
  };
  const [showKeyboard, setShowKeyboard] = useState(false);
  const simStatus = useSimulatedVrInput({ robot, enabled: simulate, lease });
  const status = STATUS[simulate ? simStatus : 'off'];
  const launchDisabledReason = simulate ? 'Simulated VR input is driving the robot. Switch it off to use a headset.' : undefined;

  if (variant === 'hero') {
    return (
      <div className="flex flex-col gap-3" data-testid="vr-session-panel">
        {robot ? (
          <VRTeleopSection
            robot={robot}
            vrSession={vrSession}
            onOpenChange={onVrOpenChange}
            showReadiness={false}
            launchDisabledReason={launchDisabledReason}
            renderLauncher={(launcher) => <HeroLauncher launcher={launcher} />}
          />
        ) : (
          <p className="text-[13px] text-ink-tertiary">{OFFLINE}</p>
        )}
      </div>
    );
  }

  if (variant === 'tools') {
    return (
      <div data-testid="vr-session-panel">
        <TestingToolsRow
          title="Simulate VR input"
          help={
            <>
              Streams reach-and-grasp motion to the robot. Needs control.
              <span data-testid="sim-input-status" className="mt-1 flex empty:hidden">
                {simulate && (
                  <StatusTag tone={status.tone} size="sm" dot pulse={simStatus !== 'disconnected'}>{status.label}</StatusTag>
                )}
              </span>
            </>
          }
          control={
            <Switch
              id="simulate-vr-input"
              data-testid="simulate-vr-toggle"
              checked={simulate}
              onCheckedChange={setSimulate}
              aria-label="Simulate VR input"
              disabled={!robot}
            />
          }
        />
        {robot ? (
          <VRTeleopSection
            robot={robot}
            vrSession={vrSession}
            onOpenChange={onVrOpenChange}
            showReadiness={false}
            launchDisabledReason={launchDisabledReason}
            renderLauncher={(launcher) => (
              <TestingToolsRow
                title="VR window on this browser"
                help={<span data-testid="vr-launch-hint">{launcher.hint}</span>}
                control={
                  <Button
                    variant="secondary"
                    size="sm"
                    leftIcon={<Glasses className="h-3.5 w-3.5" strokeWidth={1.75} />}
                    onClick={launcher.launch}
                    disabled={launcher.disabled}
                    data-testid="vr-launch"
                  >
                    Launch VR
                  </Button>
                }
              >
                {launcher.questHelp}
              </TestingToolsRow>
            )}
          />
        ) : (
          <TestingToolsRow title="VR window on this browser" help={OFFLINE} />
        )}
        <TestingToolsRow
          title="Keyboard fallback"
          help="Drive single joints from the keyboard."
          wide={showKeyboard && !!robot}
          control={
            <Button
              variant="ghost"
              size="sm"
              data-testid="keyboard-fallback-toggle"
              aria-expanded={showKeyboard}
              disabled={!robot}
              onClick={() => setShowKeyboard((v) => !v)}
            >
              {showKeyboard ? 'Close' : 'Open'}
            </Button>
          }
        >
          {showKeyboard && robot ? <KeyboardTeleopSection robot={robot} /> : null}
        </TestingToolsRow>
      </div>
    );
  }

  if (!robot) {
    return (
      <Panel data-testid="vr-session-panel">
        <Panel.Header title="VR input" />
        <Panel.Body>
          <p className="text-[13px] text-ink-tertiary">{OFFLINE}</p>
        </Panel.Body>
      </Panel>
    );
  }

  return (
    <div className="flex flex-col gap-6" data-testid="vr-session-panel">
      {/* Real headset path: WebXR rig (launcher card + full-screen modal) */}
      <VRTeleopSection
        robot={robot}
        vrSession={vrSession}
        onOpenChange={onVrOpenChange}
        showReadiness={showReadiness}
        launchDisabledReason={launchDisabledReason}
      />

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

/** The headset hero's Launch VR: the one primary on the headset's page. */
function HeroLauncher({ launcher }: { launcher: VRLauncherState }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <Button
        size="lg"
        leftIcon={<Glasses className="h-[18px] w-[18px]" strokeWidth={1.75} />}
        onClick={launcher.launch}
        disabled={launcher.disabled}
        data-testid="vr-launch"
        className="min-w-[200px]"
      >
        Launch VR
      </Button>
      <StatusTag tone={launcher.status.tone} dot>{launcher.status.label}</StatusTag>
      <p className="basis-full text-[13px] text-ink-secondary" data-testid="vr-launch-hint">{launcher.hint}</p>
    </div>
  );
}

// ============================================================================
// THE HEADSET'S VIEW OF THE SESSION (TASK-413)
// ============================================================================

const toOutcome = (ok: boolean): VrTakeOutcome => (ok ? 'ok' : 'refused');

/**
 * The bridge for one session, over the store's shared live state (TASK-410).
 * Every action is sent with `source: 'vr'`, so the desktop names the headset;
 * a 409 is adopted by the store and answers `refused`.
 *
 * A recorder without explicit takes (`phase` null) keeps the old boundary:
 * Start and Next draw it through the legacy next-episode route.
 */
export function createVrSessionBridge(sessionId: string): VrSessionBridge {
  const store = useDataCollectionStore;
  const isLive = (): boolean => store.getState().selectedSession?.id === sessionId;
  const legacy = (): boolean => {
    const live = store.getState().live;
    return !live || live.sessionId !== sessionId || live.phase === null;
  };
  const legacyBoundary = async (): Promise<VrTakeOutcome> => {
    try {
      await store.getState().nextEpisode(sessionId);
      return 'ok';
    } catch {
      return 'refused';
    }
  };
  /**
   * TASK-418: the desktop that was watching, remembered — presence empties as
   * the session ends, and that is exactly when the headset says who ended it.
   * The wearer has no End in VR, so an end they did not cause came from a
   * desktop; with several, the first one presence lists.
   */
  let lastDesk: string | null = null;
  let endedBy: string | null | undefined;
  const deskName = (): string | null => {
    const presence = store.getState().presence;
    if (presence?.sessionId === sessionId) {
      const desk = presence.viewers.find((v) => v.role === 'assistant');
      if (desk) lastDesk = desk.displayName;
    }
    return lastDesk;
  };
  return {
    sessionId,
    // TASK-414: who watches from a desktop, for the robot panel's title.
    watching: () => {
      const presence = store.getState().presence;
      return presence?.sessionId === sessionId ? watchingLabel(presence.viewers) : null;
    },
    getState: () => {
      const state = store.getState();
      const live = state.live?.sessionId === sessionId ? state.live : null;
      const session = state.selectedSession?.id === sessionId ? state.selectedSession : null;
      const status = live?.status ?? session?.status ?? 'unknown';
      const desk = deskName();
      const ended = status === 'completed' || status === 'failed';
      if (ended && endedBy === undefined) endedBy = desk;
      if (!ended) endedBy = undefined;
      return buildVrSessionView(
        {
          sessionStatus: session?.status ?? 'unknown',
          instruction: session?.languageInstr ?? null,
          sessionFrames: session?.frameCount ?? 0,
          endedBy: endedBy ?? null,
          live,
          lastQuickCheck: live ? state.lastQuickCheck : null,
          keptFallback: selectKept(state),
          pending: state.takePending !== null,
        },
        Date.now() + state.liveClockOffsetMs,
        { group: groupLabel, warning: warningLabel },
      );
    },
    actions: {
      start: async () => {
        if (!isLive()) return 'refused';
        if (legacy()) return legacyBoundary();
        return toOutcome(await store.getState().startTake(sessionId, 'vr'));
      },
      stop: async () => {
        if (!isLive() || legacy()) return 'refused';
        return toOutcome(await store.getState().stopTake(sessionId, 'vr'));
      },
      next: async () => {
        if (!isLive()) return 'refused';
        if (legacy()) return legacyBoundary();
        return toOutcome(await store.getState().nextTake(sessionId, 'vr'));
      },
      discardLast: async () => {
        if (!isLive() || legacy()) return 'refused';
        const live = store.getState().live;
        return toOutcome(await store.getState().discardLastTake(sessionId, 'vr', live?.take ?? null));
      },
    },
  };
}
