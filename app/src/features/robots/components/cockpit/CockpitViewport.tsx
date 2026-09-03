/**
 * @file CockpitViewport.tsx
 * @description The cockpit's signature element: a primary "what the robot sees"
 *   viewport framed by a heads-up display. Shows the live MJPEG camera feed when
 *   a sidecar is streaming; when the operator asks for a camera that has no feed
 *   it says so, and only the 3D model source falls back to the posed model. HUD
 *   corner brackets, a connection pill, a camera/source selector and a telemetry
 *   ticker overlay all of them.
 * @feature robots
 */

import { memo, useState } from 'react';
import { Camera, Box, Radio, CameraOff, RefreshCw } from 'lucide-react';
import { apiClient } from '@/api/client';
import { cn } from '@/shared/utils/cn';
import { useCameraStreamUrl } from '../../hooks/useCameraStreamUrl';
import { useRobotCameras } from '../../hooks/useRobotCameras';
import { Robot3DViewer } from '../visualization/Robot3DViewer';
import type { JointState, RobotType } from '../../types/robots.types';

export interface CockpitViewportProps {
  robotId: string;
  robotType: RobotType;
  jointStates?: JointState[];
  /** Telemetry link is live (drives the LIVE pill + model breathing). */
  telemetryConnected: boolean;
  /** Camera channels to expose in the source selector. Omit to ask the robot. */
  cameras?: string[];
  className?: string;
}

type Source = { kind: 'camera'; name: string } | { kind: 'model' };

/**
 * Camera channels to offer per robot type, used only while the live list from
 * `GET /robots/:id/cameras` has not arrived yet.
 *
 * The old default for every robot was `['top', 'wrist']` — SO-101 names. On a
 * G1 that produced two selector buttons which BOTH 404: the humanoid sidecars
 * (`hardware/g1_sidecar.py` and `sim_g1_dds/sim_node.py`) serve `head_camera`,
 * which is also the one camera `embodiment/configs/g1_edu.yaml` ships enabled
 * and what the VR panel already asks for (`PANEL_CAMERA` in vrConstants).
 *
 * These are a first paint, not the answer: the sidecar knows which cameras have
 * a source behind them right now, and that is what the chips settle on.
 */
const DEFAULT_CAMERAS: Record<RobotType, string[]> = {
  g1_edu: ['head_camera'],
  g1: ['head_camera'],
  h1: ['head_camera'],
  so101: ['top', 'wrist'],
  generic: ['top', 'wrist'],
};

/** L-shaped HUD bracket pinned to a corner. */
function Bracket({ corner }: { corner: 'tl' | 'tr' | 'bl' | 'br' }) {
  const base = 'pointer-events-none absolute h-7 w-7 border-[#2A5FFF]/70';
  const map: Record<typeof corner, string> = {
    tl: 'top-3 left-3 border-t-2 border-l-2 rounded-tl-md',
    tr: 'top-3 right-3 border-t-2 border-r-2 rounded-tr-md',
    bl: 'bottom-3 left-3 border-b-2 border-l-2 rounded-bl-md',
    br: 'bottom-3 right-3 border-b-2 border-r-2 rounded-br-md',
  };
  return <span className={cn(base, map[corner])} aria-hidden />;
}

export const CockpitViewport = memo(function CockpitViewport({
  robotId,
  robotType,
  jointStates,
  telemetryConnected,
  cameras,
  className,
}: CockpitViewportProps) {
  const [source, setSource] = useState<Source>({ kind: 'model' });
  const [cameraErrored, setCameraErrored] = useState<Record<string, boolean>>({});

  // Which cameras exist is a live question, not configuration: a RealSense gets
  // attached to the bridge machine and one appears without a restart.
  const {
    cameras: servedCameras,
    source: cameraSource,
    detail: cameraDetail,
    loading: camerasLoading,
    refresh: refreshCameras,
  } = useRobotCameras(cameras ? null : robotId);
  const cameraNames =
    cameras ??
    (camerasLoading ? (DEFAULT_CAMERAS[robotType] ?? ['top', 'wrist']) : servedCameras);

  // A camera stream needs a ticket in its URL (TASK-214) — an `<img>` cannot
  // send an Authorization header, and this view never sent anything at all, so
  // with auth enabled it was a silent 401. Absolute base is fine here: unlike
  // the VR panel there is no canvas readback, so nothing taints.
  const cameraName = source.kind === 'camera' ? source.name : null;
  // Retry has to be able to re-ticket. `denied` is sticky for a given
  // (robot, camera) — a refused or expired ticket never clears itself — so
  // without a nonce to bump, the Retry button below is a no-op for the one
  // failure whose message it is showing.
  const [ticketNonce, setTicketNonce] = useState(0);
  const { url: streamUrl, denied: ticketDenied } = useCameraStreamUrl(
    robotId,
    cameraName,
    apiClient.defaults.baseURL ?? '',
    ticketNonce,
  );
  // Two states, not one. `cameraArmed` is "the operator asked for this camera
  // and nothing has refused it"; `showCamera` adds "and its URL has arrived".
  // Collapsing them would put the 3D viewer on screen for the ticket round trip
  // of every camera switch — mounting and destroying a WebGL context and a GLTF
  // load each time, for a view that is about to be an `<img>` again.
  const cameraArmed =
    source.kind === 'camera' && !cameraErrored[source.name] && !ticketDenied;
  const showCamera = cameraArmed && Boolean(streamUrl);
  const cameraPending = cameraArmed && !streamUrl;
  // The whole point of the panel below: a camera the operator selected which is
  // not going to produce a picture. It used to render `Robot3DViewer`, so asking
  // for the robot's own view answered with a rendering OF the robot — the one
  // image guaranteed not to be what its camera sees.
  const cameraFailed = source.kind === 'camera' && !showCamera && !cameraPending;
  const failureReason = (() => {
    if (source.kind !== 'camera') return null;
    if (ticketDenied) return 'The server refused a stream ticket for this camera.';
    if (!camerasLoading && !servedCameras.includes(source.name) && !cameras) {
      return cameraDetail ?? `This robot is not serving a camera called “${source.name}”.`;
    }
    return cameraDetail ?? 'The robot accepted the request but sent no frames.';
  })();

  const sourceLabel = source.kind === 'camera' ? `CAM · ${source.name.toUpperCase()}` : 'MODEL · LIVE POSE';
  const liveLabel = source.kind === 'camera'
    ? (showCamera ? 'STREAMING' : cameraPending ? 'ACQUIRING' : 'NO SIGNAL')
    : (telemetryConnected ? 'LIVE' : 'NO LINK');
  const isLive = source.kind === 'camera' ? showCamera : telemetryConnected;

  return (
    <div
      className={cn(
        'relative w-full overflow-hidden rounded-2xl border border-[#2A5FFF]/20 bg-[#06070A]',
        className,
      )}
    >
      {/* ── Feed layer ── */}
      <div className="absolute inset-0">
        {showCamera ? (
          <img
            key={streamUrl}
            src={streamUrl ?? undefined}
            alt={`${source.kind === 'camera' ? source.name : ''} camera feed`}
            className="h-full w-full object-contain"
            onError={() =>
              source.kind === 'camera' &&
              setCameraErrored((m) => ({ ...m, [source.name]: true }))
            }
          />
        ) : cameraPending ? (
          <div className="flex h-full w-full items-center justify-center bg-[#06070A] font-mono text-[11px] tracking-wider text-theme-tertiary">
            ACQUIRING STREAM…
          </div>
        ) : cameraFailed ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-[#06070A] px-8 text-center">
            <CameraOff className="h-9 w-9 text-theme-tertiary" aria-hidden />
            <p className="font-mono text-[12px] font-semibold tracking-wider text-theme-secondary">
              NO CAMERA FEED
            </p>
            {failureReason && (
              <p className="max-w-md text-[12px] leading-relaxed text-theme-tertiary">
                {failureReason}
              </p>
            )}
            <div className="mt-1 flex items-center gap-2">
              <button
                onClick={() => {
                  if (source.kind === 'camera') {
                    setCameraErrored((m) => ({ ...m, [source.name]: false }));
                  }
                  setTicketNonce((n) => n + 1);
                  refreshCameras();
                }}
                className="flex items-center gap-1.5 rounded-full bg-[#2A5FFF]/15 px-3 py-1 font-mono text-[11px] text-[#7FA3FF] transition-colors hover:bg-[#2A5FFF]/25"
              >
                <RefreshCw className="h-3 w-3" />
                Retry
              </button>
              <button
                onClick={() => setSource({ kind: 'model' })}
                className="flex items-center gap-1.5 rounded-full bg-black/55 px-3 py-1 font-mono text-[11px] text-theme-secondary transition-colors hover:text-theme-primary"
              >
                <Box className="h-3 w-3" />
                Show 3D model
              </button>
            </div>
          </div>
        ) : (
          <Robot3DViewer
            robotType={robotType}
            jointStates={jointStates}
            isAnimating={telemetryConnected}
            robotId={robotId}
            className="h-full w-full"
          />
        )}
      </div>

      {/* ── HUD overlay ── */}
      <div className="pointer-events-none absolute inset-0">
        {/* faint scan grid */}
        <div
          className="absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              'linear-gradient(#2A5FFF 1px, transparent 1px), linear-gradient(90deg, #2A5FFF 1px, transparent 1px)',
            backgroundSize: '40px 40px',
          }}
        />
        <Bracket corner="tl" />
        <Bracket corner="tr" />
        <Bracket corner="bl" />
        <Bracket corner="br" />
        {/* centre reticle — hidden over the failure copy it would strike through */}
        {!cameraFailed && (
          <div className="absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2">
            <span className="absolute left-1/2 top-0 h-2 w-px -translate-x-1/2 bg-[#18E4C3]/50" />
            <span className="absolute left-1/2 bottom-0 h-2 w-px -translate-x-1/2 bg-[#18E4C3]/50" />
            <span className="absolute top-1/2 left-0 h-px w-2 -translate-y-1/2 bg-[#18E4C3]/50" />
            <span className="absolute top-1/2 right-0 h-px w-2 -translate-y-1/2 bg-[#18E4C3]/50" />
          </div>
        )}
      </div>

      {/* source pill (top-left) */}
      <div className="absolute left-5 top-5 flex items-center gap-2 rounded-md bg-black/55 px-2.5 py-1 font-mono text-[11px] tracking-wider text-theme-secondary backdrop-blur-sm">
        {source.kind === 'camera' ? <Camera className="h-3.5 w-3.5" /> : <Box className="h-3.5 w-3.5" />}
        {sourceLabel}
      </div>

      {/* live status (top-right) */}
      <div className="absolute right-5 top-5 flex items-center gap-2 rounded-md bg-black/55 px-2.5 py-1 font-mono text-[11px] font-semibold tracking-wider backdrop-blur-sm">
        <span
          className={cn(
            'h-2 w-2 rounded-full',
            isLive ? 'bg-[#18E4C3] animate-pulse' : 'bg-theme-tertiary',
          )}
        />
        <span className={isLive ? 'text-[#18E4C3]' : 'text-theme-tertiary'}>{liveLabel}</span>
      </div>

      {/* source selector (bottom) */}
      <div className="absolute inset-x-0 bottom-4 flex flex-wrap items-center justify-center gap-1.5">
        <SourceChip
          active={source.kind === 'model'}
          onClick={() => setSource({ kind: 'model' })}
          icon={<Box className="h-3 w-3" />}
          label="Model"
        />
        {cameraNames.map((name) => (
          <SourceChip
            key={name}
            active={source.kind === 'camera' && source.name === name}
            onClick={() => setSource({ kind: 'camera', name })}
            icon={<Camera className="h-3 w-3" />}
            label={name}
          />
        ))}
        {/* Nothing to offer is worth a chip of its own. Silence here is what
            sent operators clicking a camera that was never going to work. */}
        {!cameras && !camerasLoading && cameraNames.length === 0 && (
          <span
            title={cameraDetail ?? 'This robot reports no camera source.'}
            className="flex items-center gap-1.5 rounded-full bg-black/55 px-3 py-1 font-mono text-[11px] text-theme-tertiary backdrop-blur-sm"
          >
            <CameraOff className="h-3 w-3" />
            No camera
          </span>
        )}
      </div>

      {/* ticker (bottom-left, above chips on desktop) */}
      <div className="absolute left-5 bottom-14 hidden items-center gap-2 font-mono text-[10px] text-theme-tertiary sm:flex">
        <Radio className="h-3 w-3" />
        <span className="uppercase">{robotId}</span>
        {cameraSource && <span className="uppercase">· {cameraSource}</span>}
      </div>
    </div>
  );
});

function SourceChip({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded-full px-3 py-1 font-mono text-[11px] capitalize backdrop-blur-sm transition-colors',
        active
          ? 'bg-[#2A5FFF] text-white'
          : 'bg-black/55 text-theme-secondary hover:bg-black/70 hover:text-theme-primary',
      )}
    >
      {icon}
      {label}
    </button>
  );
}
