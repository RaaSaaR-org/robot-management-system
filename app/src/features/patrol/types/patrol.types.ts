/**
 * @file patrol.types.ts
 * @description Patrol feature types (TASK-212). The wire contract (routes,
 *              runs, findings, events) is shared verbatim with the server and
 *              the robot-agent and lives in the agentmode types; this file
 *              re-exports it and adds the app-only shapes (API responses,
 *              editor drafts, store status).
 * @feature patrol
 */

import type {
  PatrolCheckpoint,
  PatrolFinding,
  PatrolFindingSeverity,
  PatrolFindingStatus,
  PatrolFindingType,
  PatrolRun,
  PatrolRunMode,
  PatrolRunStatus,
  PatrolStartResult,
  PatrolTimeWindow,
} from '@/features/agentmode/types/agentmode.types';

export type {
  PatrolCheckpoint,
  PatrolCheckpointAction,
  PatrolFinding,
  PatrolFindingEvidence,
  PatrolFindingSeverity,
  PatrolFindingSource,
  PatrolFindingStatus,
  PatrolFindingType,
  PatrolInspection,
  PatrolLeg,
  PatrolLegStatus,
  PatrolRoute,
  PatrolRun,
  PatrolRunMode,
  PatrolRunOrigin,
  PatrolRunStatus,
  PatrolStartResult,
  PatrolTimeWindow,
  AgentModeEvent,
} from '@/features/agentmode/types/agentmode.types';

export {
  PatrolCheckpointActions,
  PatrolFindingSeverities,
  PatrolFindingStatuses,
  PatrolFindingTypes,
  PatrolRunModes,
  PatrolRunStatuses,
} from '@/features/agentmode/types/agentmode.types';

// ============================================================================
// API SHAPES (server, `/api/patrol/*`)
// ============================================================================

/** One place the robot knows — `GET /api/patrol/places?robotId=`. */
export interface PatrolPlace {
  id: string;
  name: string;
  placeType?: string | null;
  keepout?: boolean;
  /** Optional centroid (odom frame) when the server/robot provides one. */
  centroid?: { x: number; y: number } | null;
}

/** `POST /api/patrol/cron/validate`. */
export interface CronValidation {
  valid: boolean;
  nextRuns: string[];
  error?: string;
}

/** `GET /api/patrol/routes/:id/baseline?window=`. */
export interface PatrolBaselineInfo {
  runId: string | null;
  /** Robot that walked the baseline run — may differ from the current run's robot on unbound routes. */
  robotId?: string | null;
  window: string | null;
  /** checkpointId → photo key on the baseline run. */
  photos: Record<string, string>;
}

/** `GET /api/patrol/runs/:runId`. */
export type PatrolRunWithFindings = PatrolRun & { findings: PatrolFinding[] };

/** Body of `POST /api/patrol/routes` / `PUT /api/patrol/routes/:id`. */
export interface PatrolRouteInput {
  name: string;
  robotId?: string | null;
  twinId?: string | null;
  checkpoints: PatrolCheckpoint[];
  cronExpression?: string | null;
  enabled?: boolean;
  timeWindows?: PatrolTimeWindow[];
  homePlaceId?: string | null;
}

/** Filters for `GET /api/patrol/runs`. */
export interface PatrolRunQuery {
  routeId?: string;
  robotId?: string;
  limit?: number;
}

/** Filters for `GET /api/patrol/findings`. */
export interface PatrolFindingQuery {
  status?: PatrolFindingStatus;
  routeId?: string;
  robotId?: string;
  limit?: number;
}

/** Answer of `POST /api/patrol/findings/:id/normal`. */
export interface PatrolFindingNormalResult {
  finding: PatrolFinding;
  robotNotified?: boolean;
}

// ============================================================================
// EDITOR
// ============================================================================

/** The default windows the editor seeds a new route with. */
export const DEFAULT_TIME_WINDOWS: PatrolTimeWindow[] = [
  { id: 'day', name: 'Day', startHour: 7, endHour: 19 },
  { id: 'night', name: 'Night', startHour: 19, endHour: 7 },
];

/** Human labels for the run modes / statuses / severities. */
export const PATROL_RUN_MODE_LABELS: Record<PatrolRunMode, string> = {
  baseline: 'Baseline',
  patrol: 'Patrol',
};

export const PATROL_RUN_STATUS_LABELS: Record<PatrolRunStatus, string> = {
  running: 'Running',
  done: 'Done',
  aborted: 'Aborted',
  failed: 'Failed',
  skipped: 'Skipped',
};

export const PATROL_FINDING_TYPE_LABELS: Record<PatrolFindingType, string> = {
  person: 'Person',
  unexpected_object: 'Unexpected object',
  missing_object: 'Missing object',
  object_on_floor: 'Object on floor',
  door_open: 'Door open',
  lights_on: 'Lights on',
  out_of_place: 'Out of place',
  expectation_failed: 'Expectation failed',
  other: 'Other',
};

export const PATROL_FINDING_SEVERITY_LABELS: Record<PatrolFindingSeverity, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

export const PATROL_FINDING_STATUS_LABELS: Record<PatrolFindingStatus, string> = {
  candidate: 'Candidate',
  open: 'Open',
  acknowledged: 'Acknowledged',
  dismissed_normal: 'Normal',
  escalated: 'Escalated',
};

/** How a request is going, for list/detail loading states. */
export type PatrolLoadStatus = 'idle' | 'loading' | 'ok' | 'error';

/** Convenience: what `PatrolStartResult` looks like when the robot accepted. */
export type PatrolStartAccepted = PatrolStartResult & { accepted: true; runId: string };
