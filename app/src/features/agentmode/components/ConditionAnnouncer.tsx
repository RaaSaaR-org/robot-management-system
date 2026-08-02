/**
 * @file ConditionAnnouncer.tsx
 * @description The Agent Mode page's live region: the one place a screen reader
 *              is told that something became true — the robot went unreachable,
 *              the base went damped, a stop was not confirmed.
 * @feature agentmode
 */

import { memo } from 'react';
import { useAgentModeStore } from '../store/agentmodeStore';
import {
  CONDITION_ACTIVE_HEADLINE,
  CONDITION_LABELS,
  conditionLevel,
  selectConditions,
} from '../utils/conditions';

/**
 * Why this exists as a component of its own rather than as an attribute on the
 * condition stack.
 *
 * `EstopBanner` returns null while the robot is calm — that is the whole point
 * of the redesign, a page with 0px of chrome when nothing is wrong. But it means
 * every `role="status"` region inside it is INSERTED INTO THE DOM ALREADY
 * CONTAINING ITS TEXT the moment a condition becomes true, and NVDA and JAWS
 * only announce changes to a live region that was already in the accessible
 * tree. A region injected together with its content is silent. So the
 * `aria-live="polite"` on the unreachable notice never fired once, for anybody.
 *
 * These two regions are mounted for the lifetime of the page and start empty, so
 * a condition turning true is a CHANGE to an existing region, which is the thing
 * screen readers actually announce.
 *
 * Two regions and not one: swapping `role`/`aria-live` on a live element is not
 * reliably picked up, and the two politenesses are a real distinction here. An
 * E-Stop the hardware never confirmed ("it may still be moving") must interrupt;
 * an offline robot must not. Which of the two is decided by `conditionLevel` —
 * the MAX over everything true right now, never the first match, so a level-3
 * alarm cannot be swallowed by a level-2 condition that merely sorts above it.
 */
export const ConditionAnnouncer = memo(function ConditionAnnouncer() {
  const conditions = useAgentModeStore(selectConditions);

  const active = conditions.filter((condition) => condition.active);
  // Each condition says what it is ABOUT and which of its two values it has —
  // the same words the details drawer's checklist uses, from the same constants,
  // because the two answering differently about one robot is the failure.
  const sentence = active
    .map((c) => `${CONDITION_LABELS[c.key]}: ${CONDITION_ACTIVE_HEADLINE[c.key]}`)
    .join('. ');

  const alarm = conditionLevel(conditions) >= 3;

  return (
    <>
      <div role="status" aria-live="polite" className="sr-only">
        {alarm ? '' : sentence}
      </div>
      <div role="alert" aria-live="assertive" className="sr-only">
        {alarm ? sentence : ''}
      </div>
    </>
  );
});
