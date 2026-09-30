/**
 * @file buildAudit.ts
 * @description One compliance-log entry per create, delete, archive, cancel or
 * unpublish on the Build pages (update packages, fleet-learning rounds,
 * deployments, model versions, marketplace listings) — TASK-272.
 * @feature compliance
 */

import { complianceLogService } from './ComplianceLogService.js';

/** Correlation key for Build-page audit entries: these acts have no robot. */
export const BUILD_AUDIT_ROBOT = 'platform-build';

export type BuildAuditResourceType =
  | 'update_package'
  | 'federated_round'
  | 'deployment'
  | 'model_version'
  | 'marketplace_listing';

export type BuildAuditAction =
  | 'create'
  | 'delete'
  | 'archive'
  | 'cancel'
  | 'unpublish'
  | 'publish'
  | 'rollback';

export interface BuildAuditEvent {
  resourceType: BuildAuditResourceType;
  resourceId: string;
  action: BuildAuditAction;
  /** The acting user; absent when auth is disabled. */
  actorId?: string;
  /** A snapshot of what was acted on — for a delete, the row that is gone. */
  metadata?: Record<string, unknown>;
}

/**
 * Record one Build-page act in the compliance log. Never throws: a failed
 * audit write is a monitoring problem, not a reason to refuse the act that
 * already happened.
 */
export async function auditBuildAct(event: BuildAuditEvent): Promise<void> {
  try {
    const { sessionId } = complianceLogService.getOrCreateSession(BUILD_AUDIT_ROBOT);
    await complianceLogService.logAccess({
      sessionId,
      robotId: BUILD_AUDIT_ROBOT,
      operatorId: event.actorId,
      payload: {
        description: `${event.resourceType} ${event.action}`,
        resourceType: event.resourceType,
        resourceId: event.resourceId,
        action: event.action,
        result: 'allowed',
        metadata: event.metadata,
      },
    });
  } catch (err) {
    console.error('[buildAudit] compliance log write failed:', err);
  }
}
