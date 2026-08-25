/**
 * @file PlaceChip.tsx
 * @description The one renderer of the place belief (TASK-195): where the robot
 *              believes it is standing, with UNKNOWN rendered as unknown.
 * @feature agentmode
 */

import { memo } from 'react';
import { cn } from '@/shared/utils';
import { Tooltip } from '@/shared/components/ui/Tooltip';
import {
  useAgentModeStore,
  selectPlace,
  selectGeofenceNotEnforcing,
} from '../store/agentmodeStore';
import type { ScenePlace } from '../types';

export interface PlaceChipProps {
  /**
   * The place to render. OMITTED reads the store's scene belief — which is what
   * the rail does. An explicit `null` is a caller saying "unknown"; the two are
   * kept apart the same way the wire contract keeps absent apart from null.
   */
  place?: ScenePlace | null;
  /**
   * The testid this instance carries, or `null` to carry none.
   *
   * Exactly ONE instance on the page may own `agent-scene-place` — the rail's.
   * The chip's second, action-time appearance above a plan's block cards passes
   * `null`, so a selector for the place belief keeps resolving to one element
   * instead of failing on a strict-mode ambiguity.
   */
  testId?: string | null;
  className?: string;
}

/**
 * The unknown answer, said in full. One constant because it is rendered twice —
 * once for the pointer (Tooltip) and once for everyone else (sr-only) — and the
 * two must be the same sentence.
 */
const UNKNOWN_PROSE =
  'The robot has no pose, or its pose is not inside any mapped place. This is not the last place it was in — that answer is deliberately not shown.';

/** Why a surveyed place can still be wrong. Same sentence in chip and tooltip. */
const STALE_PROSE =
  'The map is surveyed, but the pose behind this has drifted further than the budget without a re-anchor. Treat the place as approximate.';

/**
 * What "fence off" means, in full (TASK-201). One constant, rendered as the
 * marker's `title` and as its `sr-only` text, so pointer and screen reader get
 * the same sentence.
 */
const FENCE_OFF_PROSE =
  'The keepout geofence is not enforcing: the robot would NOT be stopped from walking into a keepout right now. Re-anchor the pose, or move the robot by hand.';

/**
 * The "fence off" marker (TASK-201).
 *
 * DELIBERATELY SEPARATE from the `· stale` marker below, and not folded into
 * it: a stale place and a fence that has stopped fencing are two different
 * claims that can each be true without the other. A stale place with the fence
 * still holding is a naming problem; a fence that is off is a safety state, and
 * an operator must not have to infer the second from the first.
 *
 * It renders in BOTH of this chip's branches — a robot with no pose at all has
 * an unknown place AND a fence that cannot fence, which is precisely the case
 * where an unknown-place chip alone would look like the milder of the two
 * problems.
 *
 * Words, not colour: same rule as `· stale`, for the same colour-blind operator
 * on the same washed-out projector.
 */
function FenceOffMarker() {
  const notEnforcing = useAgentModeStore(selectGeofenceNotEnforcing);
  if (!notEnforcing) return null;
  return (
    <span
      data-testid="agent-geofence-off"
      className="card-meta shrink-0 text-amber-600 dark:text-amber-400"
      title={FENCE_OFF_PROSE}
    >
      · fence off
      <span className="sr-only"> — {FENCE_OFF_PROSE}</span>
    </span>
  );
}

/**
 * Where the robot believes it is standing (TASK-195).
 *
 * `null` renders as "Place unknown" and must LOOK different from a known place,
 * not merely say something different: the failure this guards against is an
 * operator glancing at the page, seeing the last place the robot was in, and
 * walking to the wrong aisle. An unknown place is therefore muted and dashed, a
 * known one a solid cobalt chip — the same measured-vs-guessed distinction the
 * scene panel's distance readout makes for distances.
 *
 * It renders in BOTH states and never returns null: an absent chip would read
 * as "not applicable", and where the robot is standing is never not applicable.
 *
 * This is the ONLY renderer of the belief. It used to live inside the scene
 * panel, with a second copy in the self header and a third in the memory card;
 * three renderers of one belief is three chances for them to disagree about
 * what the robot knows.
 */
export const PlaceChip = memo(function PlaceChip({
  place,
  testId = 'agent-scene-place',
  className,
}: PlaceChipProps) {
  const believed = useAgentModeStore(selectPlace);
  // `undefined` = "no opinion, use the store"; `null` = "unknown", which is an
  // answer and must not fall back to the store's older, better-looking one.
  const resolved = place === undefined ? believed : place;

  if (!resolved) {
    return (
      <div
        data-testid={testId ?? undefined}
        data-place-known="no"
        className={cn(
          'inline-flex items-center gap-2 px-2.5 py-1.5 rounded-brand',
          'border border-dashed border-glass-subtle',
          className
        )}
      >
        <Tooltip side="bottom" content={UNKNOWN_PROSE}>
          <span className="card-meta">Place unknown</span>
        </Tooltip>
        {/* The same sentence, unconditionally in the DOM. `Tooltip` only mounts
            its panel while the pointer is over the trigger, and the trigger is
            a plain span with no tab stop, so hover is the ONLY way a sighted
            mouse user reaches this — and no way at all for anyone else. The
            sentence is the honesty rule this chip exists for; it does not get
            to depend on a pointing device. */}
        <span className="sr-only">{UNKNOWN_PROSE}</span>
        <FenceOffMarker />
      </div>
    );
  }

  const stale = resolved.confidence === 'stale';

  return (
    <div
      data-testid={testId ?? undefined}
      data-place-known="yes"
      data-place-id={resolved.id}
      data-place-confidence={resolved.confidence}
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-brand glass-subtle',
        'min-w-0',
        className
      )}
    >
      {/* The place type and where the geometry came from are qualifiers, not
          the answer — they live in the tooltip so the rail stays one line. */}
      <Tooltip
        side="bottom"
        content={
          <>
            {`${resolved.placeType.replace('_', ' ')} · ${resolved.id}. `}
            {stale ? STALE_PROSE : `Resolved from the robot's ${resolved.source} place graph and its current pose.`}
          </>
        }
      >
        <span
          className={cn(
            'card-value truncate min-w-0',
            stale ? 'text-theme-muted' : 'text-cobalt-600 dark:text-cobalt-400'
          )}
        >
          {resolved.name}
        </span>
      </Tooltip>
      {stale && (
        // A drifted place used to differ from a current one by TEXT COLOUR
        // ALONE — muted instead of cobalt — with the word "stale" reachable
        // only through a hover tooltip. That is the page's own invariant
        // failing in the direction of over-confidence: a colour-blind operator,
        // a washed-out projector or a screen reader all got a place name
        // presented as if the pose behind it were current. The word is
        // therefore visible text, and it survives both colour and clipping.
        <span className="card-meta shrink-0" title={STALE_PROSE}>
          · stale
        </span>
      )}
      <FenceOffMarker />
    </div>
  );
});
