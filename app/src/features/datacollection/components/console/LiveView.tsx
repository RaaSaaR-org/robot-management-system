/**
 * @file LiveView.tsx
 * @description The session page's live view (TASK-427), shared by Set up (the
 *              preview, Twin first so the assistant watches the robot stand up)
 *              and Record (TASK-428, the head camera first): one main view and
 *              the other as a picture-in-picture with a swap button, a view
 *              switch over the twin and every camera the robot serves, the
 *              live state and an expand button, all sitting on the picture
 *              inside four reticle ticks. A camera main view is framed 4:3 by
 *              container units, so the overlays never sit on the letterbox.
 *              No camera is one amber line with a "Why"; an offline robot is a
 *              small empty state. The twin and the cameras unmount while the
 *              page's own VR modal is open. TASK-428: Record leads with the
 *              camera, rings the well and the reticle red while a take records,
 *              and puts the operator chip on the picture's bottom-left.
 *              TASK-430: a camera in the PiP draws its placeholder compact,
 *              below the PiP's bar, so its name shows once; the bar's label
 *              stays on one line (a narrow PiP drops its icon).
 *              TASK-442: a session that records wrist cameras gets a row of
 *              two 4:3 tiles under the main view, left wrist left; a tile
 *              swaps its camera into the main view and shows the head camera
 *              in its place, and a wrist the robot does not serve shows an
 *              offline plate and opens no stream. Without wrist cameras the
 *              view is exactly what it was. A tile's label keeps the PiP
 *              bar's inset on both sides.
 * @feature datacollection
 */

import { Suspense, lazy, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeftRight, Box, Maximize2, Minimize2, TriangleAlert, Video, VideoOff } from 'lucide-react';
import { Button, EmptyState, Skeleton } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import { CameraStreamView } from '../CameraStreamView';
import { WRIST_CAMERAS, wristCameraLabel } from '../../utils/cameras';
import type { JointState, RobotType } from '../../../robots/types/robots.types';

const Robot3DViewer = lazy(() =>
  import('../../../robots/components/visualization/Robot3DViewer').then((m) => ({ default: m.Robot3DViewer })),
);

/** `head_camera` → "Head camera". */
export function cameraLabel(name: string): string {
  const words = name.replace(/[_-]+/g, ' ').trim();
  const text = /camera$/i.test(words) ? words : `${words} camera`;
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

/** The camera that leads: the head camera, else the first one served. */
export function leadCameraOf(names: string[]): string | null {
  if (names.length === 0) return null;
  return names.find((n) => /head/i.test(n)) ?? names[0];
}

const TWIN = 'twin';
const NO_WRISTS: string[] = [];

/** `left_wrist_camera` → "Left wrist"; any other camera by `cameraLabel` (the switch stays short). */
function wristLabel(name: string): string {
  return wristCameraLabel(name) ?? cameraLabel(name);
}

export interface LiveViewProps {
  robotId: string;
  robotType: RobotType;
  /** The robot is online; offline shows an empty state and no views. */
  online: boolean;
  /** The robot's telemetry is live (the "Live" chip), else stale. */
  live: boolean;
  /** The lead camera's measured frame rate, when known. */
  fps?: number | null;
  jointStates?: JointState[];
  /** The operator's ghost hands, mounted in one twin link. */
  twinOverlay?: { link: string; node: ReactNode };
  /** The cameras the robot serves (`useRobotCameras`). */
  cameras: { names: string[]; loading: boolean; detail?: string | null };
  /**
   * The wrist cameras the session records (`sessionWristCameras`), left
   * first: a tile each under the main view (TASK-442). Empty: no tile row.
   */
  wristCameras?: string[];
  /** Which view leads: the twin in Set up, the camera in Record. */
  defaultMain: 'twin' | 'camera';
  /** A take is being captured: the recording ring and the camera's wording. */
  isRecording?: boolean;
  /** The page's VR modal is open: no second scene or stream behind it. */
  suspended?: boolean;
  /**
   * Where the expand button sits: top-right beside the live state, or
   * bottom-left — Set up's preview top edge lies right under the E-STOP, and
   * no control may come within 64 px of it.
   */
  expandAt?: 'top' | 'bottom';
  /** Bottom-left on the picture: the operator chip in Record (TASK-428). */
  bottomLeft?: ReactNode;
  className?: string;
  'data-testid'?: string;
}

const chip = 'inline-flex items-center rounded-tag border border-line-subtle bg-canvas/80';

/** A 14 px reticle tick in one corner of the picture. */
function Tick({ corner, recording }: { corner: 'tl' | 'tr' | 'bl' | 'br'; recording: boolean }) {
  const pos = {
    tl: 'left-3 top-3 border-l border-t',
    tr: 'right-3 top-3 border-r border-t',
    bl: 'bottom-3 left-3 border-b border-l',
    br: 'bottom-3 right-3 border-b border-r',
  }[corner];
  return (
    <span
      aria-hidden
      className={cn('pointer-events-none absolute z-20 h-3.5 w-3.5', pos, recording ? 'border-signal-stopped/80' : 'border-line-strong')}
    />
  );
}

export function LiveView({
  robotId,
  robotType,
  online,
  live,
  fps = null,
  jointStates,
  twinOverlay,
  cameras,
  wristCameras = NO_WRISTS,
  defaultMain,
  isRecording = false,
  suspended = false,
  expandAt = 'top',
  bottomLeft = null,
  className,
  'data-testid': testId = 'live-view',
}: LiveViewProps) {
  const lead = leadCameraOf(cameras.names);
  const [mainPick, setMainPick] = useState<string | null>(null);
  const [whyOpen, setWhyOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const wellRef = useRef<HTMLDivElement>(null);

  // The main view: what the user picked while it still exists, else the default.
  const views = [TWIN, ...cameras.names];
  const fallback = defaultMain === 'camera' && lead ? lead : TWIN;
  const main = mainPick && views.includes(mainPick) ? mainPick : fallback;
  // The PiP shows the other one of twin and camera.
  const pip = main === TWIN ? lead : TWIN;
  const mainIsCamera = main !== TWIN;

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === wellRef.current && wellRef.current !== null);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = () => {
    const el = wellRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen?.();
    else void el.requestFullscreen?.().catch(() => undefined);
  };

  const noCamera = online && !cameras.loading && cameras.names.length === 0;
  const compactSwitch = wristCameras.length > 0;

  const expand = (
    <button
      type="button"
      onClick={toggleFullscreen}
      aria-label={fullscreen ? 'Leave full screen' : 'Expand the view'}
      title={fullscreen ? 'Leave full screen' : 'Expand the view'}
      className={cn(chip, 'h-7 w-7 flex-none justify-center text-ink-secondary hover:text-ink-primary')}
      data-testid="live-view-expand"
    >
      {fullscreen ? <Minimize2 className="h-3.5 w-3.5" strokeWidth={1.75} /> : <Maximize2 className="h-3.5 w-3.5" strokeWidth={1.75} />}
    </button>
  );

  const twin = (
    <Suspense fallback={<Skeleton className="h-full w-full rounded-none" />}>
      <Robot3DViewer
        robotType={robotType}
        robotId={robotId}
        jointStates={jointStates}
        isAnimating={live}
        linkOverlay={twinOverlay}
        className="h-full w-full"
      />
    </Suspense>
  );

  const camera = (name: string, role: 'main' | 'pip' | 'tile') => (
    <CameraStreamView
      robotId={robotId}
      cameraName={name}
      label={cameraLabel(name)}
      isRecording={isRecording}
      offline={!online}
      fit
      compact={role !== 'main'}
      className={role !== 'main' ? 'text-[11px]' : undefined}
    />
  );

  /** Where a view sits: the whole frame, the PiP box, or nowhere. */
  const slot = (view: string): 'main' | 'pip' | null => (view === main ? 'main' : view === pip ? 'pip' : null);
  const box = (role: 'main' | 'pip') =>
    role === 'main'
      ? 'absolute inset-0'
      : 'absolute bottom-4 right-4 z-10 aspect-[4/3] w-[min(31%,270px)] overflow-hidden rounded-control border border-line-strong bg-media';

  const frame = (
    <div
      className={cn(
        'absolute',
        // A camera is framed 4:3 inside the well; the twin fills it.
        mainIsCamera ? 'inset-0 m-auto h-[min(100cqh,75cqw)] w-[min(100cqw,133.333cqh)]' : 'inset-0',
        // TASK-442: with wrist tiles the frame is smaller and the switch longer; it measures itself.
        compactSwitch && '@container/frame',
      )}
      data-testid="live-view-frame"
      data-main={mainIsCamera ? 'camera' : 'twin'}
    >
      {/* The twin: main or PiP, never remounted by a swap. */}
      <div className={box(slot(TWIN) ?? 'main')} data-testid="session-twin" data-slot={slot(TWIN) ?? 'main'}>
        {twin}
        {slot(TWIN) === 'pip' && (
          <PipBar label="Twin" icon={<Box className="h-3.5 w-3.5" strokeWidth={1.75} />} onSwap={() => setMainPick(TWIN)} />
        )}
      </div>
      {cameras.names.map((name) => {
        const role = slot(name);
        if (role === null) return null;
        return (
          <div
            key={name}
            className={box(role)}
            data-testid={name === lead ? 'session-lead-camera' : `session-camera-${name}`}
            data-slot={role}
          >
            {camera(name, role)}
            {role === 'pip' && (
              <PipBar
                label={cameraLabel(name)}
                icon={<Video className="h-3.5 w-3.5" strokeWidth={1.75} />}
                onSwap={() => setMainPick(name)}
              />
            )}
          </div>
        );
      })}
      {cameras.loading && pip === null && (
        <div className={box('pip')}>
          <Skeleton className="h-full w-full rounded-none" />
        </div>
      )}

      <Tick corner="tl" recording={isRecording} />
      <Tick corner="tr" recording={isRecording} />
      <Tick corner="bl" recording={isRecording} />
      <Tick corner="br" recording={isRecording} />

      {/* Top-left: which view leads. */}
      <div className={cn(chip, 'absolute left-[26px] top-[26px] z-20 gap-0.5 p-0.5')} role="group" aria-label="Main view" data-testid="live-view-switch">
        {views.map((v) => {
          const on = v === main;
          const label = v === TWIN ? 'Twin' : wristLabel(v);
          return (
            <button
              key={v}
              type="button"
              aria-pressed={on}
              onClick={() => setMainPick(v)}
              // A narrow frame shows the views that do not lead as icons, a phone's every view; each keeps its name.
              {...(compactSwitch ? { 'aria-label': label, title: label } : {})}
              className={cn(
                'inline-flex h-7 items-center gap-1.5 rounded-[5px] px-2.5 text-[12.5px] transition-colors duration-150 ease-[var(--ease-instrument)]',
                on ? 'bg-raised font-medium text-ink-primary' : 'text-ink-secondary hover:text-ink-primary',
                compactSwitch && (on ? '@max-[379px]/frame:px-2' : '@max-[559px]/frame:px-2'),
              )}
            >
              {v === TWIN ? <Box className="h-3.5 w-3.5" strokeWidth={1.75} /> : <Video className="h-3.5 w-3.5" strokeWidth={1.75} />}
              {compactSwitch ? <span className={on ? '@max-[379px]/frame:hidden' : '@max-[559px]/frame:hidden'}>{label}</span> : label}
            </button>
          );
        })}
      </div>

      {/* Top-right: the live state and expand. */}
      <div className="absolute right-[26px] top-[26px] z-20 flex items-center gap-1.5">
        <span className={cn(chip, 'h-7 gap-1.5 px-2.5 text-[12.5px] text-ink-primary')} data-testid="live-view-state">
          <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', live ? 'bg-signal-measured' : 'bg-signal-unknown')} />
          {live ? 'Live' : 'No live state'}
          {live && fps !== null && <span className="tabular-nums text-ink-tertiary">{fps.toFixed(1)} fps</span>}
        </span>
        {expandAt === 'top' && expand}
      </div>

      {(noCamera || expandAt === 'bottom' || bottomLeft) && (
        <div
          className={cn(
            'absolute bottom-[26px] left-[26px] z-20 flex flex-col items-start gap-1.5',
            // Clear of the PiP in the bottom-right corner.
            pip !== null || cameras.loading ? 'right-[calc(min(31%,270px)+28px)]' : 'right-[26px]',
          )}
        >
          {whyOpen && noCamera && (
            <p className={cn(chip, 'max-w-[62ch] px-2.5 py-1.5 text-[12.5px] text-ink-secondary')} data-testid="live-view-why-text">
              {cameras.detail ? `The robot serves no camera: ${cameras.detail}` : "The robot serves no camera. Start the robot's camera service or plug one in; the list refreshes on its own."}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            {bottomLeft}
            {expandAt === 'bottom' && expand}
            {noCamera && (
              <p className={cn(chip, 'gap-2 px-2.5 py-1.5 text-[12.5px] text-signal-unknown')} data-testid="live-view-no-camera">
                <TriangleAlert className="h-3.5 w-3.5 flex-none" strokeWidth={1.75} aria-hidden />
                No head camera. Takes record without video.
                <button
                  type="button"
                  className="ml-1 font-medium text-ink-secondary underline-offset-2 hover:text-ink-primary hover:underline"
                  aria-expanded={whyOpen}
                  onClick={() => setWhyOpen((v) => !v)}
                  data-testid="live-view-why"
                >
                  Why
                </button>
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );

  // TASK-442: a tile shows its wrist, or the head camera while its wrist leads.
  // A camera already in the main view or the PiP opens no second stream here.
  const wristTile = (wrist: string) => {
    const side = wrist === WRIST_CAMERAS.left ? 'left' : 'right';
    const served = cameras.names.includes(wrist);
    const shows = wrist === main && lead !== null ? lead : wrist;
    const shownAbove = shows === main || shows === pip;
    const label = shows === wrist ? wristLabel(wrist) : cameraLabel(shows);
    const tileTestId = `session-wrist-${side}`;
    return (
      <div
        key={wrist}
        className="relative aspect-[4/3] h-full overflow-hidden rounded-control border border-line-strong bg-media"
        data-testid={tileTestId}
        data-camera={shows}
      >
        {cameras.loading ? (
          <Skeleton className="h-full w-full rounded-none" />
        ) : !served ? (
          <p className="absolute inset-0 m-0 flex items-center justify-center gap-1.5 px-2 text-center text-[11.5px] text-white/70" data-testid={`${tileTestId}-offline`}>
            <VideoOff className="h-3.5 w-3.5 flex-none" strokeWidth={1.75} aria-hidden />
            {wristLabel(wrist)} camera offline
          </p>
        ) : (
          <>
            {/* The whole tile swaps; the picture lets clicks through, its own Retry stays clickable. */}
            <button
              type="button"
              aria-label={`Swap: ${label} as the main view`}
              title="Swap views"
              onClick={() => setMainPick(shows)}
              className="absolute inset-0 z-0 rounded-[inherit] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
              data-testid={`${tileTestId}-swap`}
            />
            {shownAbove ? (
              <p className="pointer-events-none absolute inset-0 m-0 flex items-center justify-center px-2 text-center text-[11.5px] text-white/60">
                In the main view
              </p>
            ) : (
              <div
                className="pointer-events-none absolute inset-0 z-[1] [&_button]:pointer-events-auto"
                data-testid={shows === lead ? 'session-lead-camera' : `session-camera-${shows}`}
                data-slot="tile"
              >
                {camera(shows, 'tile')}
              </div>
            )}
          </>
        )}
        {/* The PiP bar's inset on both sides: a narrow tile (a phone) drops the icon, then truncates. */}
        <div className="@container pointer-events-none absolute inset-x-1.5 top-1.5 z-10 flex">
          <span
            className={cn(chip, 'h-6 min-w-0 gap-1.5 whitespace-nowrap px-1 text-[11px] text-ink-primary @min-[132px]:px-2 @min-[132px]:text-[11.5px]')}
            title={label}
            data-testid={`${tileTestId}-label`}
          >
            <Video className="hidden h-3.5 w-3.5 flex-none @min-[132px]:inline-block" strokeWidth={1.75} aria-hidden />
            <span className="truncate">{label}</span>
          </span>
        </div>
      </div>
    );
  };

  const body = !online ? (
    <div className="flex h-full items-center justify-center">
      <EmptyState size="sm" title="Robot offline" description="Start the robot side in step 1 to see the twin and the cameras." />
    </div>
  ) : suspended ? (
    <div className="flex h-full items-center justify-center px-6 text-center text-[13px] text-white/70">
      The VR window is open on this browser.
    </div>
  ) : wristCameras.length === 0 ? (
    frame
  ) : (
    // The tile row takes its height from the main view, so the well keeps its size.
    <div className="absolute inset-0 flex flex-col" data-testid="live-view-wrist-layout">
      <div className="relative min-h-0 flex-1 [container-type:size]">{frame}</div>
      <div className="flex h-[min(24cqh,34cqw)] flex-none justify-center gap-2 px-3 pb-3" data-testid="live-view-wrists">
        {wristCameras.map(wristTile)}
      </div>
    </div>
  );

  return (
    <div
      ref={wellRef}
      className={cn(
        'relative min-h-0 overflow-hidden [container-type:size]',
        online ? 'bg-media' : 'bg-inset',
        className,
      )}
      data-testid={testId}
      data-recording={isRecording ? 'true' : undefined}
    >
      {body}
      {/* The recording ring, drawn over the picture (an inset ring on the well itself sits under it). */}
      {isRecording && (
        <span aria-hidden className="pointer-events-none absolute inset-0 z-30 rounded-[inherit] ring-1 ring-inset ring-signal-stopped/65" />
      )}
    </div>
  );
}

/** The PiP's own row: its name and the swap button. */
function PipBar({ label, icon, onSwap }: { label: string; icon: ReactNode; onSwap: () => void }) {
  // One line always (TASK-430): a narrow PiP (1280 px) drops the icon, then truncates.
  return (
    <div className="@container absolute inset-x-1.5 top-1.5 z-10 flex items-center justify-between gap-1">
      <span
        className={cn(chip, 'h-6 min-w-0 gap-1.5 whitespace-nowrap px-1 text-[11px] text-ink-primary @min-[132px]:px-2 @min-[132px]:text-[11.5px]')}
        title={label}
        data-testid="live-view-pip-label"
      >
        <span aria-hidden className="hidden flex-none @min-[132px]:inline-flex">{icon}</span>
        <span className="truncate">{label}</span>
      </span>
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        aria-label={`Swap: ${label} as the main view`}
        title="Swap views"
        onClick={onSwap}
        className={cn(chip, 'h-6 w-6 flex-none text-ink-secondary')}
        data-testid="live-view-swap"
      >
        <ArrowLeftRight className="h-3.5 w-3.5" strokeWidth={1.75} />
      </Button>
    </div>
  );
}
