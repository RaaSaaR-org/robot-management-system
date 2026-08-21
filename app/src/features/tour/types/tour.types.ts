/**
 * @file tour.types.ts
 * @description Host mode types (TASK-213). The wire contract (routes, stops,
 *              runs, legs, turns, events) is shared verbatim with the server
 *              and the robot-agent and lives in the agentmode types; this file
 *              re-exports it and adds the app-only shapes (API bodies, editor
 *              drafts, store status, labels).
 * @feature tour
 */

import type {
  TourLegStatus,
  TourRoute,
  TourRun,
  TourRunOrigin,
  TourRunStatus,
  TourStartResult,
  TourStop,
  TourTurnAnswer,
} from '@/features/agentmode/types/agentmode.types';
import type { PatrolPlace } from '@/features/patrol/types/patrol.types';

export type {
  AgentModeEvent,
  SpokenLanguage,
  TourDemo,
  TourDemoMode,
  TourDemoStatus,
  TourLeg,
  TourLegDemo,
  TourLegStatus,
  TourQuestionKind,
  TourRoute,
  TourRun,
  TourRunOrigin,
  TourRunStatus,
  TourStartResult,
  TourStatus,
  TourStop,
  TourTurn,
  TourTurnAnswer,
} from '@/features/agentmode/types/agentmode.types';

export {
  SpokenLanguages,
  TourDemoModes,
  TourLegStatuses,
  TourRunOrigins,
  TourRunStatuses,
  TourTurnAnswers,
  TOUR_DWELL_MAX_S,
  TOUR_FACTS_MAX,
  TOUR_FACT_MAX,
  TOUR_HEADLINE_MAX,
  TOUR_SITE_CARD_MAX,
  TOUR_STOPS_MAX,
  TOUR_TALK_TRACK_MAX,
} from '@/features/agentmode/types/agentmode.types';

// ============================================================================
// API SHAPES (server, `/api/tour/*`)
// ============================================================================

/**
 * One place the robot knows — `GET /api/tour/places?robotId=`. The server hands
 * the tour endpoint through the SAME place-graph helper patrol uses, so the
 * shape is patrol's by construction; aliasing it keeps the two features from
 * drifting apart over a field the proxy adds later.
 */
export type TourPlace = PatrolPlace;

/** `GET /api/tour/runs/:runId` — the run with its transcript, as stored. */
export type TourRunDetail = TourRun;

/** Body of `POST /api/tour/routes` / `PUT /api/tour/routes/:id`. */
export interface TourRouteInput {
  name: string;
  robotId?: string | null;
  twinId?: string | null;
  language: TourRoute['language'];
  greetingPlaceId: string;
  greeting: string;
  offer: string;
  farewell: string;
  siteCard: string[];
  stops: TourStop[];
  enabled?: boolean;
  autoGreet?: boolean;
}

/** Filters for `GET /api/tour/runs`. */
export interface TourRunQuery {
  routeId?: string;
  robotId?: string;
  limit?: number;
}

/**
 * A skill the editor may attach to a stop as its demo — the subset of
 * `SkillDefinition` (`GET /api/skills`) the picker needs. Deliberately narrow:
 * the tour REFERENCES a skill by id, it never edits or re-describes one.
 */
export interface TourSkillOption {
  id: string;
  name: string;
  version?: string;
  status?: string;
  /** Seconds, as the skill library records it — seeds the stop's `expectSeconds`. */
  timeout?: number | null;
  linkedModelVersionId?: string | null;
}

// ============================================================================
// LABELS
// ============================================================================

/**
 * `declined` is deliberately worded as an outcome, not a failure: a visitor who
 * says "no thanks" to the offer is the most common end of a good greeting.
 */
export const TOUR_RUN_STATUS_LABELS: Record<TourRunStatus, string> = {
  running: 'Running',
  done: 'Done',
  declined: 'Offer declined',
  abandoned: 'Abandoned',
  aborted: 'Aborted',
  failed: 'Failed',
  skipped: 'Skipped',
};

export const TOUR_LEG_STATUS_LABELS: Record<TourLegStatus, string> = {
  pending: 'Pending',
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
  skipped: 'Skipped',
};

export const TOUR_RUN_ORIGIN_LABELS: Record<TourRunOrigin, string> = {
  visitor: 'Visitor accepted the offer',
  operator: 'Started by an operator',
};

/**
 * How a question was answered, in the operator's words. "Not answered" is not
 * an error message: the robot got no answer out at all (planner failure, abort).
 */
export const TOUR_TURN_ANSWER_LABELS: Record<TourTurnAnswer, string> = {
  grounded: 'Grounded',
  from_camera: 'From camera',
  declined: 'Declined',
  unanswered: 'Not answered',
};

// ============================================================================
// STORE / EDITOR
// ============================================================================

/** How a request is going, for list/detail loading states. */
export type TourLoadStatus = 'idle' | 'loading' | 'ok' | 'error';

/** Convenience: what `TourStartResult` looks like when the robot accepted. */
export type TourStartAccepted = TourStartResult & { accepted: true; runId: string };
