/**
 * @file CockpitViewport.tsx
 * @description The control center's "View" panel: the posed 3D model, or the live
 *   camera feed when the robot serves one. The source switch lives in the panel
 *   header; a camera that will not produce a picture says why instead of showing
 *   a rendering of the robot. One corner StatusTag reports the link.
 * @feature robots
 */

import { memo, useState } from 'react';
import { Box, CameraOff, RefreshCw } from 'lucide-react';
import { apiClient } from '@/api/client';
import { Button, Panel, SegmentedControl, Spinner, StatusTag } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import { useCameraStreamUrl } from '../../hooks/useCameraStreamUrl';
import { useRobotCameras } from '../../hooks/useRobotCameras';
import { Robot3DViewer } from '../visualization/Robot3DViewer';
import { ViewerUnavailable } from '../common/ViewerUnavailable';
import type { JointState, RobotType } from '../../types/robots.types';

export interface CockpitViewportProps {
  robotId: string;
  robotType: RobotType;
  jointStates?: JointState[];
  /** Telemetry link is live (drives the corner tag + model animation). */
  telemetryConnected: boolean;
  /** Camera channels to expose in the source switch. Omit to ask the robot. */
  cameras?: string[];
  /** Height classes for the viewer body. */
  bodyClassName?: string;
  className?: string;
}

type Source = { kind: 'camera'; name: string } | { kind: 'model' };
const MODEL = '__model__';

/**
 * First-paint camera names per robot type, used only until the live list from
 * `GET /robots/:id/cameras` arrives. Humanoid sidecars serve `head_camera`
 * (never the SO-101 `top`/`wrist`, which 404 on a G1).
 */
const DEFAULT_CAMERAS: Record<RobotType, string[]> = {
  g1_edu: ['head_camera'],
  g1: ['head_camera'],
  h1: ['head_camera'],
  so101: ['top', 'wrist'],
  generic: ['top', 'wrist'],
};

export const CockpitViewport = memo(function CockpitViewport({
  robotId,
  robotType,
  jointStates,
  telemetryConnected,
  cameras,
  bodyClassName,
  className,
}: CockpitViewportProps) {
  const [source, setSource] = useState<Source>({ kind: 'model' });
  const [cameraErrored, setCameraErrored] = useState<Record<string, boolean>>({});

  // Which cameras exist is a live question (a RealSense can appear at runtime).
  const {
    cameras: servedCameras,
    source: cameraSource,
    detail: cameraDetail,
    loading: camerasLoading,
    refresh: refreshCameras,
  } = useRobotCameras(cameras ? null : robotId);
  const cameraNames =
    cameras ?? (camerasLoading ? (DEFAULT_CAMERAS[robotType] ?? ['top', 'wrist']) : servedCameras);

  // A stream needs a ticket in its URL (TASK-214): an <img> cannot send an
  // Authorization header. `denied` is sticky per (robot, camera), so Retry bumps
  // the nonce to re-ticket.
  const cameraName = source.kind === 'camera' ? source.name : null;
  const [ticketNonce, setTicketNonce] = useState(0);
  const { url: streamUrl, denied: ticketDenied } = useCameraStreamUrl(
    robotId,
    cameraName,
    apiClient.defaults.baseURL ?? '',
    ticketNonce,
  );
  // `cameraArmed`: asked for and not refused; `showCamera`: and the URL arrived.
  // Kept apart so a ticket round trip never flashes the 3D viewer.
  const cameraArmed = source.kind === 'camera' && !cameraErrored[source.name] && !ticketDenied;
  const showCamera = cameraArmed && Boolean(streamUrl);
  const cameraPending = cameraArmed && !streamUrl;
  // A selected camera that will not produce a picture: say why, never show the model.
  const cameraFailed = source.kind === 'camera' && !showCamera && !cameraPending;
  const failureReason = (() => {
    if (source.kind !== 'camera') return null;
    if (ticketDenied) return 'The server refused a stream ticket for this camera.';
    if (!camerasLoading && !servedCameras.includes(source.name) && !cameras) {
      return cameraDetail ?? `This robot is not serving a camera called “${source.name}”.`;
    }
    return cameraDetail ?? 'The robot accepted the request but sent no frames.';
  })();

  const retry = () => {
    if (source.kind === 'camera') setCameraErrored((m) => ({ ...m, [source.name]: false }));
    setTicketNonce((n) => n + 1);
    refreshCameras();
  };

  const linkTag =
    source.kind === 'camera' ? (
      showCamera ? (
        <StatusTag tone="live" dot pulse>Streaming</StatusTag>
      ) : cameraPending ? (
        <StatusTag tone="gated" dot>Connecting</StatusTag>
      ) : (
        <StatusTag tone="neutral" dot>No signal</StatusTag>
      )
    ) : telemetryConnected ? (
      <StatusTag tone="live" dot pulse>Live pose</StatusTag>
    ) : (
      <StatusTag tone="neutral" dot>No link</StatusTag>
    );

  const noCameras = !cameras && !camerasLoading && cameraNames.length === 0;
  const description =
    source.kind === 'camera'
      ? cameraSource
        ? `Camera ${source.name} · source ${cameraSource}`
        : `Camera ${source.name}`
      : 'The 3D model, posed from the robot’s joint telemetry.';

  const sourceValue = source.kind === 'camera' ? source.name : MODEL;
  const sourceOptions = [
    { value: MODEL, label: 'Model' },
    ...cameraNames.map((name) => ({ value: name, label: name, title: `Camera ${name}` })),
  ];

  const headerActions = noCameras ? (
    <span className="text-[13px] text-ink-tertiary" title={cameraDetail ?? undefined}>
      No camera
    </span>
  ) : (
    <SegmentedControl
      label="View source"
      size="sm"
      options={sourceOptions}
      value={sourceValue}
      onChange={(v) => setSource(v === MODEL ? { kind: 'model' } : { kind: 'camera', name: String(v) })}
    />
  );

  return (
    <Panel className={cn('flex flex-col', className)}>
      <Panel.Header title="View" description={description} actions={headerActions} />
      <div className={cn('relative p-3', bodyClassName)}>
        <div className="relative h-full overflow-hidden rounded-control bg-inset">
          {showCamera ? (
            <img
              key={streamUrl}
              src={streamUrl ?? undefined}
              alt={`${cameraName ?? ''} camera feed`}
              className="h-full w-full object-contain"
              onError={() =>
                source.kind === 'camera' && setCameraErrored((m) => ({ ...m, [source.name]: true }))
              }
            />
          ) : cameraPending ? (
            <div className="flex h-full w-full items-center justify-center gap-2 text-[13px] text-ink-tertiary">
              <Spinner size="sm" />
              Connecting to the camera…
            </div>
          ) : cameraFailed ? (
            <ViewerUnavailable
              icon={<CameraOff className="h-6 w-6" strokeWidth={1.75} />}
              title="No camera feed"
              description={failureReason ?? undefined}
            >
              <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  leftIcon={<RefreshCw className="h-4 w-4" strokeWidth={1.75} />}
                  onClick={retry}
                >
                  Retry
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  leftIcon={<Box className="h-4 w-4" strokeWidth={1.75} />}
                  onClick={() => setSource({ kind: 'model' })}
                >
                  Show 3D model
                </Button>
              </div>
            </ViewerUnavailable>
          ) : (
            <Robot3DViewer
              robotType={robotType}
              jointStates={jointStates}
              isAnimating={telemetryConnected}
              robotId={robotId}
              className="h-full w-full"
            />
          )}
          <div className="pointer-events-none absolute left-3 top-3 rounded-tag bg-panel">{linkTag}</div>
        </div>
      </div>
    </Panel>
  );
});
