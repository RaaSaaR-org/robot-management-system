/**
 * @file GDPRRequestService.ts
 * @description Service for managing GDPR data subject requests (Articles 15-22)
 * @feature gdpr
 *
 * Handles all GDPR rights:
 * - Art. 15: Right of Access (data export)
 * - Art. 16: Right to Rectification
 * - Art. 17: Right to Erasure
 * - Art. 18: Right to Restriction
 * - Art. 20: Right to Portability
 * - Art. 21: Right to Object
 * - Art. 22: Automated Decision Making
 */

import { prisma } from '../database/index.js';
import {
  SLA_DEADLINES,
  type GDPRRequest,
  type GDPRRequestType,
  type GDPRRequestStatus,
  type GDPRRequestFilters,
  type GDPRRequestListResponse,
  type GDPRRequestStatusHistory,
  type CreateGDPRRequestInput,
  type AccessRequestInput,
  type RectificationRequestInput,
  type ErasureRequestInput,
  type RestrictionRequestInput,
  type PortabilityRequestInput,
  type ObjectionRequestInput,
  type ADMReviewRequestInput,
  type DataExportResult,
  type ErasureResult,
  type ErasureEligibility,
  type ErasureExecutionOptions,
  type GDPRMetrics,
  type SLAReport,
} from '../types/gdpr.types.js';
import type { ComplianceEventType } from '../types/compliance.types.js';
import { legalHoldService } from './LegalHoldService.js';
import {
  robotMemoryErasureService,
  type RobotMemoryErasureService,
} from './RobotMemoryErasureService.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Retained-category marker for "a legal hold pins some of this subject's
 * compliance logs". Machine-readable on purpose: `executeErasure()` branches on
 * it, and a branch must not depend on the wording of a human-facing string.
 */
export const RETAINED_CATEGORY_LEGAL_HOLD = 'compliance_logs_under_legal_hold';

/**
 * Why the robot-side wipe was suppressed by a legal hold.
 *
 * The robot's activity journal is a plaintext SECOND COPY of the same data
 * category the hold pins (`robot-agent/src/agent-mode/journal.ts` says so, and
 * `Journal.prune()` refuses to delete a single day file while any hold is
 * active). Erasing the workspace would destroy exactly the evidence the hold
 * exists to preserve — so the hold suppresses this path the same way.
 */
export const ROBOT_MEMORY_BLOCKED_BY_LEGAL_HOLD =
  'Robot memory workspaces NOT erased: a legal hold is active on compliance logs of this data ' +
  'subject, and the activity journal on the robots is a second copy of that same data category ' +
  '(the robot suppresses its own journal prune under a hold for exactly this reason). ' +
  'Re-run the fleet erasure once the hold is lifted.';

/**
 * Why the robot-side wipe did not run without an explicit opt-in. Erasing robot
 * memory for one subject deletes every operator's place notes on every robot.
 */
/**
 * The compliance event type the robots' activity journal duplicates.
 *
 * `robot-agent/src/agent-mode/journal.ts` exports the same value as
 * `JOURNAL_EVENT_TYPE`: `ServerMirror.logBlock()` writes every finished block
 * as `command_execution`, and the journal is the plaintext second copy of
 * exactly those records. A hold over this category therefore pins data that
 * lives on the robots too — see {@link ROBOT_MEMORY_BLOCKED_BY_FLEET_HOLD}.
 */
export const ROBOT_JOURNAL_EVENT_TYPE = 'command_execution';

/**
 * Every compliance category the fleet-wide robot wipe destroys a second copy of.
 *
 * The gate used to be scoped to {@link ROBOT_JOURNAL_EVENT_TYPE} alone, and the
 * docstring called that deliberate — but `Workspace.erase()` is not scoped to
 * anything. It deletes `MEMORY.md`, every `places/*.md`, `journal/*.jsonl`,
 * `intents.jsonl` and `incarnations.jsonl` in one pass, so a hold that covered
 * a category the wipe destroys while the gate looked at another let the wipe
 * proceed over held evidence. The erase being broader than the gate is the bug;
 * the two are aligned here by widening the gate, which is the safe direction
 * for an Art. 17 path — a blocked wipe is retryable, a destroyed record is not.
 *
 * What each category has on the robots:
 *
 *  - `command_execution` — `journal/*.jsonl`, the plaintext tee of
 *    `ServerMirror.logBlock()` (the robot's own `journal.ts` says so).
 *  - `ai_decision` — the planner's reasoning, carried on every journalled block
 *    and logged server-side by `agent-executor.ts` as this category.
 *  - `safety_action` — E-Stops and protective stops, which reach the journal as
 *    aborted blocks and reach `incarnations.jsonl` as a latch inherited across
 *    a boot.
 *  - `system_event` — `incarnations.jsonl`, up to 200 boots of "this robot was
 *    in THIS place at THIS time"; the agent logs its boots under this category.
 *
 * `access_audit` is deliberately NOT here: it records reads of platform data,
 * and no robot holds a copy. That is also what keeps this gate from degenerating
 * into "any hold anywhere blocks the wipe forever".
 *
 * `MEMORY.md`, the place notes and `intents.jsonl` have no compliance category
 * at all — operator-authored text that exists only on the robot. No category
 * check can be proven sufficient for them, which is the second reason to widen
 * rather than narrow.
 */
export const ROBOT_WIPE_HELD_EVENT_TYPES: readonly ComplianceEventType[] = [
  'command_execution',
  'ai_decision',
  'safety_action',
  'system_event',
];

/**
 * Why the robot-side wipe was suppressed by someone ELSE's legal hold.
 *
 * `RETAINED_CATEGORY_LEGAL_HOLD` is subject-scoped — it only fires when the
 * hold pins a log whose `operatorId` is the requester. The wipe it guards is
 * not: `eraseFleetMemory()` DELETEs `/robots/:id/memory` on every robot in the
 * fleet, destroying the journals of every operator. A hold on another
 * operator's logs — or on the system/robot-authored logs that are the bulk of
 * the compliance table (`operatorId` is null for autonomous operations) —
 * covered exactly the records this wipe would destroy while the subject-scoped
 * gate stayed silent. A fleet-wide effect needs a fleet-wide gate.
 */
export const ROBOT_MEMORY_BLOCKED_BY_FLEET_HOLD =
  'Robot memory workspaces NOT erased: a legal hold is active somewhere in the fleet over ' +
  `compliance logs of a category the robots keep a second copy of (${ROBOT_WIPE_HELD_EVENT_TYPES.join(', ')}). ` +
  'The wipe deletes the whole workspace — journal, boot lineage, standing intents, notes — so it ' +
  'would destroy held evidence regardless of whose logs the hold pins. ' +
  'Re-run the fleet erasure once the hold is lifted.';

/**
 * Why the robot-side wipe was suppressed when the hold check itself failed.
 *
 * Not knowing whether a hold covers the robots' journals is not permission to
 * delete them: the database erasure has still run and is reported, only the
 * unverifiable fleet wipe is held back.
 */
export const ROBOT_MEMORY_HOLD_CHECK_FAILED =
  'Robot memory workspaces NOT erased: the legal-hold check over the compliance categories the ' +
  `robots duplicate (${ROBOT_WIPE_HELD_EVENT_TYPES.join(', ')}) could not be completed, so it is ` +
  'unknown whether a hold covers what the wipe would destroy. Retry the fleet erasure once the ' +
  'compliance database is reachable.';

/**
 * Why the fleet-wide wipe reported nothing: the robot list could not be read.
 *
 * `RobotMemoryErasureService.eraseFleetMemory()` used to return an empty result
 * for this case, byte-identical to "this fleet has no robots with an agent
 * URL" — an Art. 17 response claiming a complete erasure while the code never
 * found out which robots exist.
 */
export const ROBOT_MEMORY_FLEET_UNKNOWN =
  'Robot memory workspaces NOT erased: the fleet could not be enumerated, so it is unknown ' +
  'which robots hold memory workspaces and none was reached. This is NOT an empty fleet. ' +
  'Retry the fleet erasure once the robot inventory is readable.';

export const ROBOT_MEMORY_REQUIRES_OPT_IN =
  'Robot memory workspaces NOT erased: robot files are not keyed by data subject, so the only ' +
  'erasure a robot can perform is a full fleet-wide wipe — which would also delete place notes ' +
  'written by other operators (personal data of other data subjects, erased without their ' +
  'request). Re-run with the explicit fleet-wide opt-in if that is intended.';

export class GDPRRequestService {
  /**
   * Reaches the fleet on erasure (TASK-197). Injectable so a test can drive
   * `executeErasure` without a robot; defaults to the singleton.
   */
  private readonly robotMemoryErasure: RobotMemoryErasureService;

  constructor(deps: { robotMemoryErasure?: RobotMemoryErasureService } = {}) {
    this.robotMemoryErasure = deps.robotMemoryErasure ?? robotMemoryErasureService;
    console.log('[GDPRRequestService] Initialized');
  }

  // ============================================================================
  // REQUEST CREATION
  // ============================================================================

  /**
   * Create an access request (Art. 15)
   */
  async createAccessRequest(
    userId: string,
    input: AccessRequestInput = {},
  ): Promise<GDPRRequest> {
    return this.createRequest({
      userId,
      requestType: 'access',
      requestData: { ...input },
    });
  }

  /**
   * Create a rectification request (Art. 16)
   */
  async createRectificationRequest(
    userId: string,
    input: RectificationRequestInput,
  ): Promise<GDPRRequest> {
    return this.createRequest({
      userId,
      requestType: 'rectification',
      requestData: { ...input },
    });
  }

  /**
   * Create an erasure request (Art. 17)
   */
  async createErasureRequest(
    userId: string,
    input: ErasureRequestInput = {},
  ): Promise<GDPRRequest> {
    // Check eligibility first
    const eligibility = await this.checkErasureEligibility(userId);
    if (!eligibility.eligible) {
      throw new Error(`Erasure not possible: ${eligibility.blockedReasons.join(', ')}`);
    }

    // Erasure requires verification
    const verificationToken = uuidv4();
    const verificationExpires = new Date();
    verificationExpires.setHours(verificationExpires.getHours() + 24);

    const request = await this.createRequest({
      userId,
      requestType: 'erasure',
      requestData: { ...input, eligibility: { ...eligibility } },
    });

    // Add verification requirement
    await prisma.gDPRRequest.update({
      where: { id: request.id },
      data: {
        verificationToken,
        verificationExpires,
        status: 'awaiting_verification',
      },
    });

    return { ...request, status: 'awaiting_verification' as GDPRRequestStatus };
  }

  /**
   * Create a restriction request (Art. 18)
   */
  async createRestrictionRequest(
    userId: string,
    input: RestrictionRequestInput,
  ): Promise<GDPRRequest> {
    return this.createRequest({
      userId,
      requestType: 'restriction',
      requestData: { ...input },
    });
  }

  /**
   * Create a portability request (Art. 20)
   */
  async createPortabilityRequest(
    userId: string,
    input: PortabilityRequestInput,
  ): Promise<GDPRRequest> {
    return this.createRequest({
      userId,
      requestType: 'portability',
      requestData: { ...input },
    });
  }

  /**
   * Create an objection request (Art. 21)
   */
  async createObjectionRequest(
    userId: string,
    input: ObjectionRequestInput,
  ): Promise<GDPRRequest> {
    return this.createRequest({
      userId,
      requestType: 'objection',
      requestData: { ...input },
    });
  }

  /**
   * Create an ADM review request (Art. 22)
   */
  async createADMReviewRequest(
    userId: string,
    input: ADMReviewRequestInput,
  ): Promise<GDPRRequest> {
    // Verify decision exists
    const decision = await prisma.decision.findUnique({
      where: { id: input.decisionId },
    });

    if (!decision) {
      throw new Error('Decision not found');
    }

    const request = await this.createRequest({
      userId,
      requestType: 'adm_review',
      requestData: { ...input },
    });

    // Create ADM review queue entry
    await prisma.aDMReviewQueue.create({
      data: {
        gdprRequestId: request.id,
        decisionId: input.decisionId,
        userId,
        contestReason: input.contestReason,
        userEvidence: input.evidence,
        status: 'queued',
        priority: 'normal',
      },
    });

    return request;
  }

  /**
   * Base request creation
   */
  private async createRequest(input: CreateGDPRRequestInput): Promise<GDPRRequest> {
    // Calculate SLA deadline
    const slaDeadline = new Date();
    slaDeadline.setDate(slaDeadline.getDate() + SLA_DEADLINES.standard);

    const request = await prisma.gDPRRequest.create({
      data: {
        userId: input.userId,
        requestType: input.requestType,
        status: 'pending',
        slaDeadline,
        requestData: JSON.stringify(input.requestData || {}),
      },
    });

    // Create initial status history entry
    await prisma.gDPRRequestStatusHistory.create({
      data: {
        requestId: request.id,
        fromStatus: null,
        toStatus: 'pending',
        reason: 'Request submitted',
      },
    });

    console.log(
      `[GDPRRequestService] Created ${input.requestType} request ${request.id} for user ${input.userId}`,
    );

    return this.mapToGDPRRequest(request);
  }

  // ============================================================================
  // REQUEST PROCESSING
  // ============================================================================

  /**
   * Acknowledge a request (updates status and records acknowledgment time)
   */
  async acknowledgeRequest(requestId: string, adminId: string): Promise<GDPRRequest> {
    const request = await prisma.gDPRRequest.update({
      where: { id: requestId },
      data: {
        status: 'acknowledged',
        acknowledgedAt: new Date(),
        assignedTo: adminId,
      },
    });

    await this.addStatusHistory(requestId, 'pending', 'acknowledged', adminId);

    console.log(`[GDPRRequestService] Request ${requestId} acknowledged by ${adminId}`);

    return this.mapToGDPRRequest(request);
  }

  /**
   * Start processing a request
   */
  async startProcessing(requestId: string, adminId: string): Promise<GDPRRequest> {
    const request = await prisma.gDPRRequest.update({
      where: { id: requestId },
      data: {
        status: 'in_progress',
        assignedTo: adminId,
      },
    });

    await this.addStatusHistory(requestId, 'acknowledged', 'in_progress', adminId);

    return this.mapToGDPRRequest(request);
  }

  /**
   * Complete a request
   */
  async completeRequest(
    requestId: string,
    adminId: string,
    responseData: Record<string, unknown>,
  ): Promise<GDPRRequest> {
    const existing = await prisma.gDPRRequest.findUnique({ where: { id: requestId } });
    if (!existing) throw new Error('Request not found');

    const request = await prisma.gDPRRequest.update({
      where: { id: requestId },
      data: {
        status: 'completed',
        completedAt: new Date(),
        responseData: JSON.stringify(responseData),
      },
    });

    await this.addStatusHistory(requestId, existing.status, 'completed', adminId);

    console.log(`[GDPRRequestService] Request ${requestId} completed by ${adminId}`);

    return this.mapToGDPRRequest(request);
  }

  /**
   * Reject a request
   */
  async rejectRequest(
    requestId: string,
    adminId: string,
    reason: string,
  ): Promise<GDPRRequest> {
    const existing = await prisma.gDPRRequest.findUnique({ where: { id: requestId } });
    if (!existing) throw new Error('Request not found');

    const request = await prisma.gDPRRequest.update({
      where: { id: requestId },
      data: {
        status: 'rejected',
        rejectionReason: reason,
        completedAt: new Date(),
      },
    });

    await this.addStatusHistory(requestId, existing.status, 'rejected', adminId, reason);

    console.log(`[GDPRRequestService] Request ${requestId} rejected by ${adminId}: ${reason}`);

    return this.mapToGDPRRequest(request);
  }

  /**
   * Cancel a request (user action)
   */
  async cancelRequest(requestId: string, userId: string): Promise<GDPRRequest> {
    const existing = await prisma.gDPRRequest.findUnique({ where: { id: requestId } });

    if (!existing) throw new Error('Request not found');
    if (existing.userId !== userId) throw new Error('Not authorized');
    if (existing.status === 'completed' || existing.status === 'rejected') {
      throw new Error('Cannot cancel completed or rejected request');
    }

    const request = await prisma.gDPRRequest.update({
      where: { id: requestId },
      data: { status: 'cancelled' },
    });

    await this.addStatusHistory(requestId, existing.status, 'cancelled', userId, 'Cancelled by user');

    return this.mapToGDPRRequest(request);
  }

  /**
   * Verify a request (for erasure requests)
   */
  async verifyRequest(token: string): Promise<GDPRRequest> {
    const request = await prisma.gDPRRequest.findFirst({
      where: {
        verificationToken: token,
        verificationExpires: { gt: new Date() },
      },
    });

    if (!request) {
      throw new Error('Invalid or expired verification token');
    }

    const updated = await prisma.gDPRRequest.update({
      where: { id: request.id },
      data: {
        status: 'pending',
        verifiedAt: new Date(),
        verificationToken: null,
      },
    });

    await this.addStatusHistory(request.id, 'awaiting_verification', 'pending', null, 'Verified by user');

    return this.mapToGDPRRequest(updated);
  }

  // ============================================================================
  // QUERIES
  // ============================================================================

  /**
   * Get a single request by ID
   */
  async getRequest(requestId: string): Promise<GDPRRequest | null> {
    const request = await prisma.gDPRRequest.findUnique({
      where: { id: requestId },
    });

    return request ? this.mapToGDPRRequest(request) : null;
  }

  /**
   * Get requests for a specific user
   */
  async getUserRequests(userId: string): Promise<GDPRRequest[]> {
    const requests = await prisma.gDPRRequest.findMany({
      where: { userId },
      orderBy: { submittedAt: 'desc' },
    });

    return requests.map(this.mapToGDPRRequest);
  }

  /**
   * Get all requests with filters (admin)
   */
  async getAllRequests(
    filters: GDPRRequestFilters = {},
    page = 1,
    limit = 20,
  ): Promise<GDPRRequestListResponse> {
    const where: Record<string, unknown> = {};

    if (filters.status) {
      where.status = Array.isArray(filters.status) ? { in: filters.status } : filters.status;
    }
    if (filters.requestType) {
      where.requestType = Array.isArray(filters.requestType)
        ? { in: filters.requestType }
        : filters.requestType;
    }
    if (filters.userId) where.userId = filters.userId;
    if (filters.assignedTo) where.assignedTo = filters.assignedTo;
    if (filters.fromDate) where.submittedAt = { gte: filters.fromDate };
    if (filters.toDate) {
      where.submittedAt = { ...((where.submittedAt as object) || {}), lte: filters.toDate };
    }
    if (filters.overdue) {
      where.slaDeadline = { lt: new Date() };
      where.status = { in: ['pending', 'acknowledged', 'in_progress'] };
    }

    const [requests, total] = await Promise.all([
      prisma.gDPRRequest.findMany({
        where,
        orderBy: { submittedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.gDPRRequest.count({ where }),
    ]);

    return {
      requests: requests.map(this.mapToGDPRRequest),
      total,
      page,
      limit,
    };
  }

  /**
   * Get overdue requests
   */
  async getOverdueRequests(): Promise<GDPRRequest[]> {
    const requests = await prisma.gDPRRequest.findMany({
      where: {
        slaDeadline: { lt: new Date() },
        status: { in: ['pending', 'acknowledged', 'in_progress'] },
      },
      orderBy: { slaDeadline: 'asc' },
    });

    return requests.map(this.mapToGDPRRequest);
  }

  /**
   * Get requests nearing SLA deadline
   */
  async getRequestsNearingSLA(withinHours: number): Promise<GDPRRequest[]> {
    const deadline = new Date();
    deadline.setHours(deadline.getHours() + withinHours);

    const requests = await prisma.gDPRRequest.findMany({
      where: {
        slaDeadline: { gt: new Date(), lt: deadline },
        status: { in: ['pending', 'acknowledged', 'in_progress'] },
      },
      orderBy: { slaDeadline: 'asc' },
    });

    return requests.map(this.mapToGDPRRequest);
  }

  /**
   * Get status history for a request
   */
  async getStatusHistory(requestId: string): Promise<GDPRRequestStatusHistory[]> {
    const history = await prisma.gDPRRequestStatusHistory.findMany({
      where: { requestId },
      orderBy: { timestamp: 'asc' },
    });

    return history;
  }

  // ============================================================================
  // DATA OPERATIONS
  // ============================================================================

  /**
   * Generate data export for a user (Art. 15, 20)
   */
  async generateDataExport(
    userId: string,
    format: 'json' | 'csv' = 'json',
  ): Promise<DataExportResult> {
    // Collect all user data
    const [user, logs, commands, alerts, consents, restrictions] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          avatar: true,
          createdAt: true,
          lastLoginAt: true,
        },
      }),
      prisma.complianceLog.findMany({
        where: { operatorId: userId },
        take: 1000,
        orderBy: { timestamp: 'desc' },
      }),
      prisma.robotCommand.findMany({
        where: {},
        take: 100,
      }),
      prisma.alert.findMany({
        where: { acknowledgedBy: userId },
        take: 100,
      }),
      prisma.userConsent.findMany({
        where: { userId },
      }),
      prisma.dataRestriction.findMany({
        where: { userId },
      }),
    ]);

    const exportData = {
      exportedAt: new Date().toISOString(),
      user,
      activityLogs: logs.map((l) => ({
        id: l.id,
        eventType: l.eventType,
        severity: l.severity,
        timestamp: l.timestamp,
        // Note: payload is encrypted, would need decryption for full export
      })),
      acknowledgedAlerts: alerts.length,
      consents,
      restrictions,
      categories: ['profile', 'activity_logs', 'consents', 'restrictions'],
    };

    const dataString =
      format === 'json'
        ? JSON.stringify(exportData, null, 2)
        : this.convertToCSV(exportData);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // Download link expires in 7 days

    return {
      format,
      data: Buffer.from(dataString).toString('base64'),
      generatedAt: new Date(),
      expiresAt,
      recordCount: logs.length + alerts.length + consents.length,
      categories: ['profile', 'activity_logs', 'consents', 'restrictions'],
    };
  }

  /**
   * Check if erasure is possible for a user
   */
  async checkErasureEligibility(userId: string): Promise<ErasureEligibility> {
    const blockedReasons: string[] = [];
    const retainedDataCategories: string[] = [];

    // Check for logs under legal hold
    const logsUnderHold = await legalHoldService.getLogsUnderHold();
    const userLogs = await prisma.complianceLog.findMany({
      where: { operatorId: userId },
      select: { id: true },
    });

    const userLogIds = new Set(userLogs.map((l) => l.id));
    const heldUserLogs = logsUnderHold.filter((id) => userLogIds.has(id));

    if (heldUserLogs.length > 0) {
      blockedReasons.push(`${heldUserLogs.length} logs under legal hold`);
      retainedDataCategories.push(RETAINED_CATEGORY_LEGAL_HOLD);
    }

    // Check for mandatory retention periods
    const activeRetentionLogs = await prisma.complianceLog.count({
      where: {
        operatorId: userId,
        retentionExpiresAt: { gt: new Date() },
      },
    });

    if (activeRetentionLogs > 0) {
      blockedReasons.push(`${activeRetentionLogs} logs within mandatory retention period`);
      retainedDataCategories.push('compliance_logs_mandatory_retention');
    }

    // Count estimated affected records
    const [userCount, logCount, consentCount] = await Promise.all([
      prisma.user.count({ where: { id: userId } }),
      prisma.complianceLog.count({ where: { operatorId: userId } }),
      prisma.userConsent.count({ where: { userId } }),
    ]);

    return {
      eligible: blockedReasons.length === 0,
      blockedReasons,
      retainedDataCategories,
      estimatedRecordsAffected: userCount + logCount + consentCount,
    };
  }

  /**
   * Is ANY active legal hold covering a data category the robots' workspaces
   * duplicate — no matter whose logs it pins?
   *
   * Scoped to {@link ROBOT_WIPE_HELD_EVENT_TYPES}: every category the wipe
   * destroys a second copy of, not just the journal's. A gate narrower than the
   * erase it guards is the asymmetry this method used to have — a hold pinning
   * a `system_event` (the boot lineage the wipe deletes with
   * `incarnations.jsonl`) let the fleet-wide wipe proceed.
   *
   * Deliberately NOT scoped to the data subject, unlike
   * {@link checkErasureEligibility}: that method answers "may these rows be
   * deleted", and rows have an `operatorId`. This one answers "may every robot
   * in the fleet delete everything it remembers", and that wipe has no subject
   * scope at all — the robot's files are not keyed by user. Intersecting the
   * held log ids with the requester's own logs (which is what the
   * subject-scoped gate does) left the wipe unguarded whenever the hold pinned
   * another operator's logs, or the system/robot-authored logs that carry
   * `operatorId: null` and make up the bulk of the compliance table.
   *
   * @returns `'held'` when a hold covers any of those categories, `'clear'`
   *   when none does, `'unknown'` when the check itself failed — the caller
   *   must treat `'unknown'` as blocking, since not knowing is not permission
   *   to delete.
   */
  private async checkFleetWipeHold(): Promise<'held' | 'clear' | 'unknown'> {
    try {
      const heldLogIds = await legalHoldService.getLogsUnderHold();
      if (heldLogIds.length === 0) return 'clear';

      const heldWipedLogs = await prisma.complianceLog.count({
        where: {
          id: { in: heldLogIds },
          eventType: { in: [...ROBOT_WIPE_HELD_EVENT_TYPES] },
        },
      });
      return heldWipedLogs > 0 ? 'held' : 'clear';
    } catch (error) {
      console.error(
        '[GDPRRequestService] Fleet-wide legal-hold check failed; robot memory erasure suppressed:',
        error,
      );
      return 'unknown';
    }
  }

  /**
   * Execute erasure for a user (Art. 17)
   *
   * The database half always runs. The ROBOT half (memory workspaces) is gated
   * three times, and the gates are the point of this method rather than a detail:
   *
   *  1. A legal hold on THIS SUBJECT's compliance logs suppresses it — see
   *     {@link ROBOT_MEMORY_BLOCKED_BY_LEGAL_HOLD}.
   *  2. A legal hold ANYWHERE over any category the robots keep a second copy
   *     of ({@link ROBOT_WIPE_HELD_EVENT_TYPES}) suppresses it too, because the
   *     wipe is fleet-wide AND destroys the whole workspace — see
   *     {@link ROBOT_MEMORY_BLOCKED_BY_FLEET_HOLD}.
   *  3. Otherwise it needs `options.eraseRobotMemory === true`, because the
   *     wipe is fleet-wide and hits other data subjects — see
   *     {@link ROBOT_MEMORY_REQUIRES_OPT_IN}.
   *
   * Whatever did not happen comes back in `blockedReasons`; robot files come
   * back in `robotFilesRemoved`, never folded into `deletedRecords`.
   */
  async executeErasure(
    userId: string,
    options: ErasureExecutionOptions = {},
  ): Promise<ErasureResult> {
    const eligibility = await this.checkErasureEligibility(userId);
    // Asked BEFORE the database half so a failing hold check cannot leave the
    // fleet wiped-but-unverified; the result only gates the robot half.
    const fleetHold = await this.checkFleetWipeHold();

    let deletedRecords = 0;
    let skippedRecords = 0;
    let pseudonymizedRecords = 0;
    // Copied, not aliased: the fleet pass below appends to it, and mutating the
    // eligibility object would make a second call see the first call's failures.
    const blockedReasons = [...eligibility.blockedReasons];

    // Delete consents
    const deletedConsents = await prisma.userConsent.deleteMany({
      where: { userId },
    });
    deletedRecords += deletedConsents.count;

    // Delete GDPR requests (except current one)
    const deletedRequests = await prisma.gDPRRequest.deleteMany({
      where: { userId, status: 'completed' },
    });
    deletedRecords += deletedRequests.count;

    // Pseudonymize compliance logs (can't delete due to regulatory requirements)
    const pseudonymizedLogs = await prisma.complianceLog.updateMany({
      where: {
        operatorId: userId,
        retentionExpiresAt: { gt: new Date() },
      },
      data: { operatorId: 'GDPR_ERASED' },
    });
    pseudonymizedRecords += pseudonymizedLogs.count;

    // Delete deletable logs
    const deletableLogs = await prisma.complianceLog.deleteMany({
      where: {
        operatorId: userId,
        retentionExpiresAt: { lte: new Date() },
        legalHoldId: null,
      },
    });
    deletedRecords += deletableLogs.count;

    // Delete restrictions
    const deletedRestrictions = await prisma.dataRestriction.deleteMany({
      where: { userId },
    });
    deletedRecords += deletedRestrictions.count;

    // Deactivate user account (soft delete)
    await prisma.user.update({
      where: { id: userId },
      data: {
        isActive: false,
        email: `deleted_${userId}@gdpr-erased.local`,
        name: 'GDPR Erased User',
        passwordHash: 'ERASED',
      },
    });

    // Reach the fleet (TASK-197). Robot memory workspaces hold operator-authored
    // free text — a place note in a customer facility is personal data on a
    // device with no Prisma, so a database-only erasure would leave it behind
    // and make this platform's Article 17 answer false for that data.
    //
    // But the robot's files are not keyed by userId (there is no speaker
    // identification — see the robot's AGENTS.md), so the only erasure a robot
    // can perform is a full wipe of everything it remembers. That is a decision
    // about OTHER subjects' data and about held evidence, hence the gates
    // below. Failures inside an authorised wipe are reported as blocked reasons
    // rather than thrown: an unreachable robot must not roll back the database
    // erasure that already succeeded, and must not be claimed as erased either.
    let robotFilesRemoved = 0;
    let robotsAttempted = 0;

    // Both hold gates are evaluated, not short-circuited into one branch: a
    // subject-scoped hold and a fleet-wide one are different facts about the
    // erasure and the response has to name whichever applies.
    const holdReasons: string[] = [];
    if (eligibility.retainedDataCategories.includes(RETAINED_CATEGORY_LEGAL_HOLD)) {
      // The hold wins over the erasure request for this data category. Deleting
      // the robots' journal here would destroy the very records the hold pins,
      // which is what the robot's own prune refuses to do.
      holdReasons.push(ROBOT_MEMORY_BLOCKED_BY_LEGAL_HOLD);
    }
    if (fleetHold === 'held') {
      // A hold on ANY operator's — or on a system/robot-authored — log in a
      // category the robots duplicate. The wipe below does not know how to
      // spare it: it deletes every robot's whole workspace.
      holdReasons.push(ROBOT_MEMORY_BLOCKED_BY_FLEET_HOLD);
    } else if (fleetHold === 'unknown') {
      holdReasons.push(ROBOT_MEMORY_HOLD_CHECK_FAILED);
    }

    if (holdReasons.length > 0) {
      blockedReasons.push(...holdReasons);
    } else if (!options.eraseRobotMemory) {
      blockedReasons.push(ROBOT_MEMORY_REQUIRES_OPT_IN);
    } else {
      const fleet = await this.robotMemoryErasure.eraseFleetMemory();
      robotFilesRemoved = fleet.removed;
      robotsAttempted = fleet.attempted;
      if (fleet.listError) {
        // NOT an empty fleet: nothing was enumerated, so nothing was erased and
        // the count of robots we failed to reach is unknown.
        blockedReasons.push(`${ROBOT_MEMORY_FLEET_UNKNOWN} (${fleet.listError})`);
      }
      for (const outcome of fleet.outcomes) {
        if (!outcome.ok) {
          blockedReasons.push(
            `Robot ${outcome.robotId}: memory workspace not erased (${outcome.error ?? 'unknown error'}) — retry when the robot is reachable`,
          );
        }
      }
    }

    // Clamp at 0: the estimate only covers user+complianceLog+userConsent, while
    // deletedRecords also includes GDPR requests and data restrictions, so the raw
    // subtraction can go negative (a logically impossible "skipped" count).
    skippedRecords = Math.max(
      0,
      eligibility.estimatedRecordsAffected - deletedRecords - pseudonymizedRecords,
    );

    console.log(
      `[GDPRRequestService] Erasure completed for user ${userId}: ` +
        `deleted=${deletedRecords}, pseudonymized=${pseudonymizedRecords}, skipped=${skippedRecords}, ` +
        `robotFiles=${robotFilesRemoved} (from ${robotsAttempted} robot(s))`,
    );

    return {
      deletedRecords,
      skippedRecords,
      pseudonymizedRecords,
      robotFilesRemoved,
      robotsAttempted,
      blockedReasons,
      completedAt: new Date(),
    };
  }

  // ============================================================================
  // METRICS
  // ============================================================================

  /**
   * Get GDPR metrics for admin dashboard
   */
  async getMetrics(): Promise<GDPRMetrics> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [
      totalRequests,
      pendingRequests,
      overdueRequests,
      completedLast30Days,
      requestsByType,
      requestsByStatus,
      completedRequests,
    ] = await Promise.all([
      prisma.gDPRRequest.count(),
      prisma.gDPRRequest.count({
        where: { status: { in: ['pending', 'acknowledged', 'in_progress'] } },
      }),
      prisma.gDPRRequest.count({
        where: {
          slaDeadline: { lt: new Date() },
          status: { in: ['pending', 'acknowledged', 'in_progress'] },
        },
      }),
      prisma.gDPRRequest.count({
        where: { status: 'completed', completedAt: { gte: thirtyDaysAgo } },
      }),
      prisma.gDPRRequest.groupBy({
        by: ['requestType'],
        _count: true,
      }),
      prisma.gDPRRequest.groupBy({
        by: ['status'],
        _count: true,
      }),
      prisma.gDPRRequest.findMany({
        where: { status: 'completed', completedAt: { not: null } },
        select: { submittedAt: true, completedAt: true },
      }),
    ]);

    // Calculate average response time
    let totalHours = 0;
    for (const req of completedRequests) {
      if (req.completedAt) {
        const hours =
          (req.completedAt.getTime() - req.submittedAt.getTime()) / (1000 * 60 * 60);
        totalHours += hours;
      }
    }
    const averageResponseTimeHours =
      completedRequests.length > 0 ? totalHours / completedRequests.length : 0;

    // Calculate SLA compliance rate
    const onTimeRequests = completedRequests.filter((req) => {
      if (!req.completedAt) return false;
      const deadline = new Date(req.submittedAt);
      deadline.setDate(deadline.getDate() + SLA_DEADLINES.standard);
      return req.completedAt <= deadline;
    }).length;

    const slaComplianceRate =
      completedRequests.length > 0 ? (onTimeRequests / completedRequests.length) * 100 : 100;

    return {
      totalRequests,
      pendingRequests,
      overdueRequests,
      completedLast30Days,
      averageResponseTimeHours: Math.round(averageResponseTimeHours * 10) / 10,
      requestsByType: Object.fromEntries(
        requestsByType.map((r) => [r.requestType, r._count]),
      ) as Record<GDPRRequestType, number>,
      requestsByStatus: Object.fromEntries(
        requestsByStatus.map((r) => [r.status, r._count]),
      ) as Record<string, number>,
      slaComplianceRate: Math.round(slaComplianceRate * 10) / 10,
    };
  }

  /**
   * Get SLA compliance report
   */
  async getSLAReport(): Promise<SLAReport> {
    const metrics = await this.getMetrics();
    const nearingDeadline = await this.getRequestsNearingSLA(48);

    // Find longest open request
    const longestOpen = await prisma.gDPRRequest.findFirst({
      where: { status: { in: ['pending', 'acknowledged', 'in_progress'] } },
      orderBy: { submittedAt: 'asc' },
    });

    let longestOpenRequest = null;
    if (longestOpen) {
      const daysOpen = Math.floor(
        (Date.now() - longestOpen.submittedAt.getTime()) / (1000 * 60 * 60 * 24),
      );
      longestOpenRequest = {
        id: longestOpen.id,
        daysOpen,
        requestType: longestOpen.requestType as GDPRRequestType,
      };
    }

    return {
      totalRequests: metrics.totalRequests,
      onTimeRequests: Math.round(
        (metrics.slaComplianceRate / 100) * metrics.completedLast30Days,
      ),
      overdueRequests: metrics.overdueRequests,
      nearingDeadline: nearingDeadline.length,
      complianceRate: metrics.slaComplianceRate,
      averageResponseTime: metrics.averageResponseTimeHours,
      longestOpenRequest,
    };
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  private async addStatusHistory(
    requestId: string,
    fromStatus: string | null,
    toStatus: string,
    changedBy: string | null,
    reason?: string,
  ): Promise<void> {
    await prisma.gDPRRequestStatusHistory.create({
      data: {
        requestId,
        fromStatus,
        toStatus,
        changedBy,
        reason,
      },
    });
  }

  private mapToGDPRRequest(
    request: {
      id: string;
      userId: string;
      requestType: string;
      status: string;
      submittedAt: Date;
      acknowledgedAt: Date | null;
      slaDeadline: Date;
      completedAt: Date | null;
      requestData: string;
      responseData: string | null;
      verificationToken: string | null;
      verificationExpires: Date | null;
      verifiedAt: Date | null;
      assignedTo: string | null;
      internalNotes: string | null;
      rejectionReason: string | null;
      createdAt: Date;
      updatedAt: Date;
    },
  ): GDPRRequest {
    return {
      id: request.id,
      userId: request.userId,
      requestType: request.requestType as GDPRRequestType,
      status: request.status as GDPRRequestStatus,
      submittedAt: request.submittedAt,
      acknowledgedAt: request.acknowledgedAt,
      slaDeadline: request.slaDeadline,
      completedAt: request.completedAt,
      requestData: JSON.parse(request.requestData || '{}'),
      responseData: request.responseData ? JSON.parse(request.responseData) : null,
      verificationToken: request.verificationToken,
      verificationExpires: request.verificationExpires,
      verifiedAt: request.verifiedAt,
      assignedTo: request.assignedTo,
      internalNotes: request.internalNotes,
      rejectionReason: request.rejectionReason,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
    };
  }

  private convertToCSV(data: Record<string, unknown>): string {
    // Simple CSV conversion for user data
    const lines: string[] = [];
    lines.push('Category,Field,Value');

    const flatten = (obj: Record<string, unknown>, prefix = ''): void => {
      for (const [key, value] of Object.entries(obj)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          flatten(value as Record<string, unknown>, fullKey);
        } else {
          lines.push(`"${prefix || 'general'}","${key}","${String(value)}"`);
        }
      }
    };

    flatten(data);
    return lines.join('\n');
  }
}

// Export singleton instance
export const gdprRequestService = new GDPRRequestService();
