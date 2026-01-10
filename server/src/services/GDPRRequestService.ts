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
  type GDPRMetrics,
  type SLAReport,
} from '../types/gdpr.types.js';
import { legalHoldService } from './LegalHoldService.js';
import { v4 as uuidv4 } from 'uuid';

export class GDPRRequestService {
  constructor() {
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
      retainedDataCategories.push('compliance_logs_under_legal_hold');
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
   * Execute erasure for a user (Art. 17)
   */
  async executeErasure(userId: string): Promise<ErasureResult> {
    const eligibility = await this.checkErasureEligibility(userId);

    let deletedRecords = 0;
    let skippedRecords = 0;
    let pseudonymizedRecords = 0;

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

    skippedRecords = eligibility.estimatedRecordsAffected - deletedRecords - pseudonymizedRecords;

    console.log(
      `[GDPRRequestService] Erasure completed for user ${userId}: ` +
        `deleted=${deletedRecords}, pseudonymized=${pseudonymizedRecords}, skipped=${skippedRecords}`,
    );

    return {
      deletedRecords,
      skippedRecords,
      pseudonymizedRecords,
      blockedReasons: eligibility.blockedReasons,
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
