/**
 * @file ScenePanel.tsx
 * @description Collapsible panel: latest camera frame + the scene-memory entities,
 *              rendering a MEASURED distance visibly differently from a guessed
 *              one, plus the measured forward clearance when there is one.
 * @feature agentmode
 */

import { memo, useState } from 'react';
import { cn } from '@/shared/utils';
import { formatTimeAgo } from '@/shared/utils/format';
import { Tooltip } from '@/shared/components/ui/Tooltip';
import { useAgentModeStore, selectScene } from '../store/agentmodeStore';
import type { SceneEntity } from '../types';
import { formatBearing } from '../utils/blockFormat';

export interface ScenePanelProps {
  /**
   * Data URL / http URL of the latest camera frame. No caller passes one yet:
   * the wire contract keeps no images (scene memory is text-only by design),
   * so the placeholder below is honest until the camera-streaming task lands
   * and wires a frame source through here.
   */
  frameSrc?: string | null;
  className?: string;
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={cn('w-4 h-4 transition-transform duration-200', open ? 'rotate-90' : 'rotate-0')}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  );
}

function CameraIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

/**
 * Distance cell for one entity. A measured metre and a guessed one must not
 * look alike here: before there was any range sensing, `goto` "arrived" by
 * walking into things, so the operator has to be able to read off the panel
 * which numbers the robot actually measured.
 *
 * - `'lidar'`      → plain value, cobalt: a real range out of the point cloud.
 * - anything else  → `~` prefix, muted: the vision model's guess (0.94 m MAE
 *                    against known geometry), or an older agent that sent no
 *                    source at all. Unknown provenance is rendered as
 *                    unverified — the safe direction, since the alternative is
 *                    presenting a guess as a measurement.
 * - `null`         → the em-dash this panel has always shown. Never `0`.
 */
function DistanceReadout({ entity }: { entity: SceneEntity }) {
  const { distanceEstM, distanceSource } = entity;

  if (distanceEstM === null || distanceEstM === undefined || !Number.isFinite(distanceEstM)) {
    return (
      <span
        data-testid="agent-scene-distance"
        data-distance-source="none"
        className="card-meta tabular-nums shrink-0"
      >
        — m
      </span>
    );
  }

  const measured = distanceSource === 'lidar';

  return (
    <Tooltip
      className="shrink-0"
      side="left"
      content={
        measured
          ? 'Measured by LiDAR — nearest surface in a cone around this bearing. Returns carry no labels, so this is the closest thing in that direction, not necessarily this object.'
          : 'Estimated by the vision model, not measured. Treat as a rough guess.'
      }
    >
      <span
        data-testid="agent-scene-distance"
        data-distance-source={measured ? 'lidar' : (distanceSource ?? 'unknown')}
        className={cn(
          'text-xs tabular-nums',
          measured ? 'font-medium text-cobalt-600 dark:text-cobalt-400' : 'card-meta'
        )}
      >
        {measured ? '' : '~'}
        {distanceEstM.toFixed(1)} m
      </span>
    </Tooltip>
  );
}

/**
 * What the robot believes is around it. Bearings are world bearings
 * (+x = 0, CCW positive); a missing distance stays blank rather than 0, and a
 * measured distance is set apart from a guessed one — see {@link DistanceReadout}.
 */
export const ScenePanel = memo(function ScenePanel({ frameSrc, className }: ScenePanelProps) {
  const scene = useAgentModeStore(selectScene);
  const [open, setOpen] = useState(true);

  const entities = scene?.entities ?? [];

  // Rendered only when it is a real number. Null (or an older agent that sends
  // no field at all) means "we do not know how far the wall is" — and unknown
  // is not "clear", so the row says nothing rather than showing a dash the eye
  // could read as free space.
  const forwardClearanceM =
    typeof scene?.forwardClearanceM === 'number' && Number.isFinite(scene.forwardClearanceM)
      ? scene.forwardClearanceM
      : null;

  return (
    <div
      data-testid="agent-scene-panel"
      className={cn('glass-card flex flex-col overflow-hidden', className)}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="shrink-0 flex items-center gap-2 px-3 py-2.5 border-b border-glass-subtle text-left hover:bg-theme-hover transition-colors"
      >
        <ChevronIcon open={open} />
        <span className="card-title">Scene memory</span>
        <span className="ml-auto card-meta tabular-nums">
          {entities.length} {entities.length === 1 ? 'entity' : 'entities'}
        </span>
      </button>

      {open && (
        <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
          {/* Latest camera frame */}
          <div className="rounded-brand overflow-hidden border border-glass-subtle bg-theme-elevated">
            {frameSrc ? (
              <img
                src={frameSrc}
                alt="Latest camera frame"
                className="w-full aspect-video object-cover"
              />
            ) : (
              <div className="w-full aspect-video flex flex-col items-center justify-center gap-1.5 text-theme-muted">
                <CameraIcon className="w-7 h-7" />
                <span className="text-[11px]">No camera frame yet</span>
              </div>
            )}
          </div>

          {/* Free-text current view from the VLM */}
          {scene?.currentView ? (
            <p className="card-meta leading-snug">{scene.currentView}</p>
          ) : (
            <p className="card-meta">
              Nothing seen yet — run a <span className="font-medium">look</span> or{' '}
              <span className="font-medium">scan room</span> block.
            </p>
          )}

          {scene && (
            <div className="flex items-center gap-2 text-[11px] text-theme-muted">
              <span
                className={cn(
                  'inline-block w-1.5 h-1.5 rounded-full',
                  scene.personVisible ? 'bg-turquoise-500' : 'bg-theme-tertiary'
                )}
              />
              <span>{scene.personVisible ? 'Person in view' : 'No person in view'}</span>
              <span className="ml-auto tabular-nums">{formatTimeAgo(scene.updatedAt)}</span>
            </div>
          )}

          {/* Measured clearance straight ahead — absent when nothing measured it */}
          {forwardClearanceM !== null && (
            <div
              data-testid="agent-scene-clearance"
              className="flex items-center gap-2 text-[11px] text-theme-muted"
            >
              <Tooltip
                side="top"
                content="Measured by LiDAR — nearest surface straight ahead. The sensor's vertical fan does not see everything, so this is the closest return, not a guarantee that the rest is free."
              >
                <span>Clear ahead</span>
              </Tooltip>
              <span className="ml-auto tabular-nums font-medium text-cobalt-600 dark:text-cobalt-400">
                {forwardClearanceM.toFixed(2)} m
              </span>
            </div>
          )}

          {/* Entity list */}
          <ul className="space-y-1.5">
            {entities.map((entity) => (
              <li
                key={`${entity.label}-${entity.bearingDeg}`}
                data-testid="agent-scene-entity"
                className="glass-subtle px-2.5 py-2"
              >
                <div className="flex items-center gap-2">
                  <span className="card-value truncate">{entity.label}</span>
                  <span className="ml-auto card-meta tabular-nums shrink-0">
                    {formatBearing(entity.bearingDeg)}
                  </span>
                  <DistanceReadout entity={entity} />
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  {entity.note && <span className="card-meta truncate">{entity.note}</span>}
                  <span className="ml-auto card-meta tabular-nums shrink-0">
                    {Math.round(entity.confidence * 100)}% · {formatTimeAgo(entity.lastSeen)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
});
