/**
 * @file ScenePanel.tsx
 * @description The scene-memory body of the knowledge card: what the robot
 *              believes is around it, rendering a MEASURED distance visibly
 *              differently from a guessed one, plus the measured forward
 *              clearance when there is one.
 * @feature agentmode
 */

import { memo } from 'react';
import { Eye } from 'lucide-react';
import { cn } from '@/shared/utils';
import { formatTimeAgo } from '@/shared/utils/format';
import { EmptyState } from '@/shared/components/ui';
import { Tooltip } from '@/shared/components/ui/Tooltip';
import { useAgentModeStore, selectScene, selectMapSummary } from '../store/agentmodeStore';
import type { SceneEntity } from '../types';
import { formatBearing } from '../utils/blockFormat';

export interface ScenePanelProps {
  /**
   * Data URL / http URL of the latest camera frame. No caller passes one yet:
   * the wire contract keeps no images (scene memory is text-only by design), so
   * the prop is kept as the home the camera-streaming task wires a frame source
   * into. Until then nothing is rendered at all — a 16:9 "no camera frame yet"
   * placeholder spent a third of the rail saying that the feature it is a
   * placeholder for does not exist.
   */
  frameSrc?: string | null;
  className?: string;
}

/**
 * Distance cell for one entity. A measured metre and a guessed one must not
 * look alike here: before there was any range sensing, `goto` "arrived" by
 * walking into things, so the operator has to be able to read off the panel
 * which numbers the robot actually measured.
 *
 * - `'lidar'`      → plain value, cobalt: a real range out of the point cloud.
 * - `'fleet'`      → plain value, cobalt: another robot's own reported pose
 *                    (TASK-207) — a position, not a camera sighting.
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

  const measured = distanceSource === 'lidar' || distanceSource === 'fleet';

  return (
    <Tooltip
      className="shrink-0"
      side="left"
      content={
        distanceSource === 'fleet'
          ? 'Reported by the fleet — the other robot\u2019s own position as the server relays it. Not seen by this robot\u2019s camera.'
          : measured
            ? 'Measured by LiDAR — nearest surface in a cone around this bearing. Returns carry no labels, so this is the closest thing in that direction, not necessarily this object.'
            : 'Estimated by the vision model, not measured. Treat as a rough guess.'
      }
    >
      <span
        data-testid="agent-scene-distance"
        data-distance-source={measured ? distanceSource : (distanceSource ?? 'unknown')}
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
 *
 * Headerless by design: {@link KnowledgePanel} owns the title, the tab and the
 * entity count, so this renders a body only. Where the robot is STANDING is not
 * here either — `PlaceChip` in the status rail is the single renderer of that
 * belief, because three copies of it were three chances to disagree.
 */
export const ScenePanel = memo(function ScenePanel({ frameSrc, className }: ScenePanelProps) {
  const scene = useAgentModeStore(selectScene);
  // The robot's own map (TASK-206). `undefined` = this agent does not report
  // one (older agent) — the row is simply absent. `null` = disabled, also
  // absent: an operator who turned it off does not need to be told so here.
  const mapSummary = useAgentModeStore(selectMapSummary);

  const entities = scene?.entities ?? [];

  // Rendered only when it is a real number. Null (or an older agent that sends
  // no field at all) means "we do not know how far the wall is" — and unknown
  // is not "clear", so the row says nothing rather than showing a dash the eye
  // could read as free space.
  const forwardClearanceM =
    typeof scene?.forwardClearanceM === 'number' && Number.isFinite(scene.forwardClearanceM)
      ? scene.forwardClearanceM
      : null;

  // Nothing seen yet is a real answer, not a loading state: the robot has to be
  // told to look. Only when it has neither a view nor an entity is the panel
  // genuinely empty — one remembered chair still deserves the list.
  const nothingSeen = !scene?.currentView && entities.length === 0;

  return (
    <div
      data-testid="agent-scene-panel"
      className={cn('flex-1 min-h-0 overflow-y-auto p-3 space-y-3', className)}
    >
      {/* Latest camera frame — rendered only when there is one to render. */}
      {frameSrc && (
        <div className="rounded-brand overflow-hidden border border-glass-subtle bg-theme-elevated">
          <img
            src={frameSrc}
            alt="Latest camera frame"
            className="w-full aspect-video object-cover"
          />
        </div>
      )}

      {nothingSeen ? (
        <EmptyState
          size="sm"
          icon={<Eye className="w-8 h-8" />}
          title="Nothing seen yet"
          description={
            <>
              Run a <span className="font-medium">look</span> or{' '}
              <span className="font-medium">scan room</span> block.
            </>
          }
        />
      ) : (
        /* Free-text current view from the VLM */
        scene?.currentView && <p className="card-meta leading-snug">{scene.currentView}</p>
      )}

      {/* A person in view changes what the robot may do next, so it is worth a
          row. "No person in view" is not — it was an always-on line saying
          nothing is happening, and the scene's age rides along with the fact
          it qualifies rather than standing on its own. */}
      {scene?.personVisible && (
        <div className="flex items-center gap-2 text-[11px] text-theme-muted">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-turquoise-500" />
          <span>Person in view</span>
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

      {/* The robot's own map, in one line — absent when the agent reports none. */}
      {mapSummary && (
        <div
          data-testid="agent-scene-map"
          className="flex items-center gap-2 text-[11px] text-theme-muted"
        >
          <Tooltip
            side="top"
            content="Occupancy grid the robot builds itself from its LiDAR, in its odometry frame. Known = cells it has classified free or occupied; the rest is unknown, which is not the same as clear."
          >
            <span>Map</span>
          </Tooltip>
          <span className="ml-auto tabular-nums">
            {mapSummary.knownCells.toLocaleString()} known · {mapSummary.occupiedCells.toLocaleString()}{' '}
            occupied
            {mapSummary.lastIntegratedAt
              ? ` · ${formatTimeAgo(mapSummary.lastIntegratedAt)}`
              : ' · nothing integrated yet'}
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
  );
});
