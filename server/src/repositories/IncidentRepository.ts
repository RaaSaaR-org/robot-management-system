/**
 * @file IncidentRepository.ts
 * @description Data access layer for Incident, IncidentNotification, and NotificationTemplate entities
 * @feature incidents
 */

import { prisma } from '../database/index.js';
import type {
  Incident as PrismaIncident,
  IncidentNotification as PrismaNotification,
  NotificationTemplate as PrismaTemplate,
} from '@prisma/client';
import type {
  Incident,
  IncidentNotification,
  NotificationTemplate,
  IncidentType,
  IncidentSeverity,
  IncidentStatus,
  Authority,
  Regulation,
  NotificationType,
  NotificationStatus,
  IncidentQueryParams,
  IncidentListResponse,
  CreateIncidentInput,
  UpdateIncidentInput,
  CreateNotificationInput,
  UpdateNotificationInput,
  CreateTemplateInput,
  UpdateTemplateInput,
  SystemSnapshot,
} from '../types/incident.types.js';

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function dbIncidentToDomain(
  dbIncident: PrismaIncident & { notifications?: PrismaNotification[] }
): Incident {
  return {
    id: dbIncident.id,
    incidentNumber: dbIncident.incidentNumber,
    type: dbIncident.type as IncidentType,
    severity: dbIncident.severity as IncidentSeverity,
    status: dbIncident.status as IncidentStatus,
    title: dbIncident.title,
    description: dbIncident.description,
    rootCause: dbIncident.rootCause,
    resolution: dbIncident.resolution,
    riskScore: dbIncident.riskScore,
    affectedDataSubjects: dbIncident.affectedDataSubjects,
    dataCategories: dbIncident.dataCategories,
    detectedAt: dbIncident.detectedAt,
    containedAt: dbIncident.containedAt,
    resolvedAt: dbIncident.resolvedAt,
    closedAt: dbIncident.closedAt,
    robotId: dbIncident.robotId,
    complianceLogIds: dbIncident.complianceLogIds,
    alertIds: dbIncident.alertIds,
    systemSnapshot: dbIncident.systemSnapshot
      ? (JSON.parse(dbIncident.systemSnapshot) as SystemSnapshot)
      : null,
    createdAt: dbIncident.createdAt,
    updatedAt: dbIncident.updatedAt,
    createdBy: dbIncident.createdBy,
    notifications: dbIncident.notifications?.map(dbNotificationToDomain),
  };
}

function dbNotificationToDomain(dbNotification: PrismaNotification): IncidentNotification {
  return {
    id: dbNotification.id,
    incidentId: dbNotification.incidentId,
    authority: dbNotification.authority as Authority,
    regulation: dbNotification.regulation as Regulation,
    notificationType: dbNotification.notificationType as NotificationType,
    deadlineHours: dbNotification.deadlineHours,
    dueAt: dbNotification.dueAt,
    status: dbNotification.status as NotificationStatus,
    sentAt: dbNotification.sentAt,
    acknowledgedAt: dbNotification.acknowledgedAt,
    templateId: dbNotification.templateId,
    content: dbNotification.content,
    createdAt: dbNotification.createdAt,
    updatedAt: dbNotification.updatedAt,
    sentBy: dbNotification.sentBy,
  };
}

function dbTemplateToDomain(dbTemplate: PrismaTemplate): NotificationTemplate {
  return {
    id: dbTemplate.id,
    name: dbTemplate.name,
    regulation: dbTemplate.regulation as Regulation,
    authority: dbTemplate.authority as Authority,
    type: dbTemplate.type as NotificationType,
    subject: dbTemplate.subject,
    body: dbTemplate.body,
    isDefault: dbTemplate.isDefault,
    createdAt: dbTemplate.createdAt,
    updatedAt: dbTemplate.updatedAt,
  };
}

// ============================================================================
// INCIDENT REPOSITORY
// ============================================================================

export class IncidentRepository {
  /**
   * Generate next incident number in format INC-YYYY-NNN
   */
  async generateIncidentNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `INC-${year}-`;

    // Find the latest incident number for this year
    const latestIncident = await prisma.incident.findFirst({
      where: {
        incidentNumber: { startsWith: prefix },
      },
      orderBy: { incidentNumber: 'desc' },
    });

    let nextNum = 1;
    if (latestIncident) {
      const currentNum = parseInt(latestIncident.incidentNumber.replace(prefix, ''), 10);
      nextNum = currentNum + 1;
    }

    return `${prefix}${nextNum.toString().padStart(3, '0')}`;
  }

  /**
   * Find an incident by ID
   */
  async findById(id: string, includeNotifications = false): Promise<Incident | null> {
    const incident = await prisma.incident.findUnique({
      where: { id },
      include: includeNotifications ? { notifications: true } : undefined,
    });
    return incident ? dbIncidentToDomain(incident) : null;
  }

  /**
   * Find an incident by incident number
   */
  async findByNumber(incidentNumber: string): Promise<Incident | null> {
    const incident = await prisma.incident.findUnique({
      where: { incidentNumber },
      include: { notifications: true },
    });
    return incident ? dbIncidentToDomain(incident) : null;
  }

  /**
   * Find all incidents with optional filters and pagination
   */
  async findAll(params?: IncidentQueryParams): Promise<IncidentListResponse> {
    const page = params?.page ?? 1;
    const limit = params?.limit ?? 20;
    const skip = (page - 1) * limit;

    const where = this.buildWhereClause(params);
    const orderBy = this.buildOrderBy(params);

    const [incidents, total] = await Promise.all([
      prisma.incident.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        include: { notifications: true },
      }),
      prisma.incident.count({ where }),
    ]);

    return {
      incidents: incidents.map(dbIncidentToDomain),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Find open incidents (not closed)
   */
  async findOpen(): Promise<Incident[]> {
    const incidents = await prisma.incident.findMany({
      where: {
        status: { not: 'closed' },
      },
      orderBy: [{ severity: 'asc' }, { detectedAt: 'desc' }],
      include: { notifications: true },
    });

    // Sort by severity priority: critical, high, medium, low
    const severityOrder: Record<string, number> = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3,
    };

    return incidents
      .map(dbIncidentToDomain)
      .sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
  }

  /**
   * Create a new incident
   */
  async create(input: CreateIncidentInput): Promise<Incident> {
    const incidentNumber = await this.generateIncidentNumber();

    const incident = await prisma.incident.create({
      data: {
        incidentNumber,
        type: input.type,
        severity: input.severity ?? 'medium',
        status: 'detected',
        title: input.title,
        description: input.description,
        detectedAt: input.detectedAt ?? new Date(),
        robotId: input.robotId,
        complianceLogIds: input.complianceLogIds ?? [],
        alertIds: input.alertIds ?? [],
        createdBy: input.createdBy,
        dataCategories: [],
      },
      include: { notifications: true },
    });

    return dbIncidentToDomain(incident);
  }

  /**
   * Update an incident
   */
  async update(id: string, input: UpdateIncidentInput): Promise<Incident | null> {
    try {
      const incident = await prisma.incident.update({
        where: { id },
        data: {
          status: input.status,
          severity: input.severity,
          title: input.title,
          description: input.description,
          rootCause: input.rootCause,
          resolution: input.resolution,
          riskScore: input.riskScore,
          affectedDataSubjects: input.affectedDataSubjects,
          dataCategories: input.dataCategories,
          containedAt: input.containedAt,
          resolvedAt: input.resolvedAt,
          closedAt: input.closedAt,
        },
        include: { notifications: true },
      });
      return dbIncidentToDomain(incident);
    } catch {
      return null;
    }
  }

  /**
   * Update system snapshot for an incident
   */
  async updateSnapshot(id: string, snapshot: SystemSnapshot): Promise<Incident | null> {
    try {
      const incident = await prisma.incident.update({
        where: { id },
        data: {
          systemSnapshot: JSON.stringify(snapshot),
        },
        include: { notifications: true },
      });
      return dbIncidentToDomain(incident);
    } catch {
      return null;
    }
  }

  /**
   * Link evidence to an incident
   */
  async linkEvidence(
    id: string,
    complianceLogIds?: string[],
    alertIds?: string[]
  ): Promise<Incident | null> {
    try {
      const current = await prisma.incident.findUnique({ where: { id } });
      if (!current) return null;

      const updatedComplianceLogIds = complianceLogIds
        ? [...new Set([...current.complianceLogIds, ...complianceLogIds])]
        : current.complianceLogIds;

      const updatedAlertIds = alertIds
        ? [...new Set([...current.alertIds, ...alertIds])]
        : current.alertIds;

      const incident = await prisma.incident.update({
        where: { id },
        data: {
          complianceLogIds: updatedComplianceLogIds,
          alertIds: updatedAlertIds,
        },
        include: { notifications: true },
      });
      return dbIncidentToDomain(incident);
    } catch {
      return null;
    }
  }

  /**
   * Delete an incident
   */
  async delete(id: string): Promise<boolean> {
    try {
      await prisma.incident.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get incident statistics for dashboard
   */
  async getStats(): Promise<{
    total: number;
    open: number;
    bySeverity: Record<IncidentSeverity, number>;
    byType: Record<IncidentType, number>;
    byStatus: Record<IncidentStatus, number>;
  }> {
    const [total, open, severityCounts, typeCounts, statusCounts] = await Promise.all([
      prisma.incident.count(),
      prisma.incident.count({ where: { status: { not: 'closed' } } }),
      prisma.incident.groupBy({ by: ['severity'], _count: { id: true } }),
      prisma.incident.groupBy({ by: ['type'], _count: { id: true } }),
      prisma.incident.groupBy({ by: ['status'], _count: { id: true } }),
    ]);

    const bySeverity: Record<IncidentSeverity, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    };
    for (const c of severityCounts) {
      bySeverity[c.severity as IncidentSeverity] = c._count.id;
    }

    const byType: Record<IncidentType, number> = {
      safety: 0,
      security: 0,
      data_breach: 0,
      ai_malfunction: 0,
      vulnerability: 0,
    };
    for (const c of typeCounts) {
      byType[c.type as IncidentType] = c._count.id;
    }

    const byStatus: Record<IncidentStatus, number> = {
      detected: 0,
      investigating: 0,
      contained: 0,
      resolved: 0,
      closed: 0,
    };
    for (const c of statusCounts) {
      byStatus[c.status as IncidentStatus] = c._count.id;
    }

    return { total, open, bySeverity, byType, byStatus };
  }

  /**
   * Build Prisma where clause from query params
   */
  private buildWhereClause(params?: IncidentQueryParams): Record<string, unknown> {
    if (!params) return {};

    const where: Record<string, unknown> = {};

    if (params.type) {
      where.type = Array.isArray(params.type) ? { in: params.type } : params.type;
    }

    if (params.severity) {
      where.severity = Array.isArray(params.severity) ? { in: params.severity } : params.severity;
    }

    if (params.status) {
      where.status = Array.isArray(params.status) ? { in: params.status } : params.status;
    }

    if (params.robotId) {
      where.robotId = params.robotId;
    }

    if (params.startDate || params.endDate) {
      where.detectedAt = {};
      if (params.startDate) {
        (where.detectedAt as Record<string, Date>).gte = params.startDate;
      }
      if (params.endDate) {
        (where.detectedAt as Record<string, Date>).lte = params.endDate;
      }
    }

    return where;
  }

  /**
   * Build order by clause
   */
  private buildOrderBy(
    params?: IncidentQueryParams
  ): Array<Record<string, 'asc' | 'desc'>> | Record<string, 'asc' | 'desc'> {
    const sortBy = params?.sortBy ?? 'detectedAt';
    const sortOrder = params?.sortOrder ?? 'desc';
    return { [sortBy]: sortOrder };
  }
}

// ============================================================================
// NOTIFICATION REPOSITORY
// ============================================================================

export class IncidentNotificationRepository {
  /**
   * Find a notification by ID
   */
  async findById(id: string): Promise<IncidentNotification | null> {
    const notification = await prisma.incidentNotification.findUnique({
      where: { id },
    });
    return notification ? dbNotificationToDomain(notification) : null;
  }

  /**
   * Find notifications for an incident
   */
  async findByIncidentId(incidentId: string): Promise<IncidentNotification[]> {
    const notifications = await prisma.incidentNotification.findMany({
      where: { incidentId },
      orderBy: { dueAt: 'asc' },
    });
    return notifications.map(dbNotificationToDomain);
  }

  /**
   * Find overdue notifications
   */
  async findOverdue(): Promise<IncidentNotification[]> {
    const now = new Date();
    const notifications = await prisma.incidentNotification.findMany({
      where: {
        status: { in: ['pending', 'draft'] },
        dueAt: { lt: now },
      },
      orderBy: { dueAt: 'asc' },
    });
    return notifications.map(dbNotificationToDomain);
  }

  /**
   * Find pending notifications
   */
  async findPending(): Promise<IncidentNotification[]> {
    const notifications = await prisma.incidentNotification.findMany({
      where: { status: 'pending' },
      orderBy: { dueAt: 'asc' },
    });
    return notifications.map(dbNotificationToDomain);
  }

  /**
   * Create a notification
   */
  async create(input: CreateNotificationInput): Promise<IncidentNotification> {
    const notification = await prisma.incidentNotification.create({
      data: {
        incidentId: input.incidentId,
        authority: input.authority,
        regulation: input.regulation,
        notificationType: input.notificationType,
        deadlineHours: input.deadlineHours,
        dueAt: input.dueAt,
        status: 'pending',
        templateId: input.templateId,
        content: input.content,
      },
    });
    return dbNotificationToDomain(notification);
  }

  /**
   * Create multiple notifications at once
   */
  async createMany(inputs: CreateNotificationInput[]): Promise<number> {
    const result = await prisma.incidentNotification.createMany({
      data: inputs.map((input) => ({
        incidentId: input.incidentId,
        authority: input.authority,
        regulation: input.regulation,
        notificationType: input.notificationType,
        deadlineHours: input.deadlineHours,
        dueAt: input.dueAt,
        status: 'pending',
        templateId: input.templateId,
        content: input.content,
      })),
    });
    return result.count;
  }

  /**
   * Update a notification
   */
  async update(id: string, input: UpdateNotificationInput): Promise<IncidentNotification | null> {
    try {
      const notification = await prisma.incidentNotification.update({
        where: { id },
        data: {
          status: input.status,
          content: input.content,
          sentAt: input.sentAt,
          acknowledgedAt: input.acknowledgedAt,
          sentBy: input.sentBy,
        },
      });
      return dbNotificationToDomain(notification);
    } catch {
      return null;
    }
  }

  /**
   * Mark notification as sent
   */
  async markSent(id: string, sentBy?: string): Promise<IncidentNotification | null> {
    return this.update(id, {
      status: 'sent',
      sentAt: new Date(),
      sentBy,
    });
  }

  /**
   * Mark notifications as overdue
   */
  async markOverdue(): Promise<number> {
    const now = new Date();
    const result = await prisma.incidentNotification.updateMany({
      where: {
        status: { in: ['pending', 'draft'] },
        dueAt: { lt: now },
      },
      data: { status: 'overdue' },
    });
    return result.count;
  }

  /**
   * Delete a notification
   */
  async delete(id: string): Promise<boolean> {
    try {
      await prisma.incidentNotification.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get notification counts by status
   */
  async getCountsByStatus(): Promise<Record<NotificationStatus, number>> {
    const counts = await prisma.incidentNotification.groupBy({
      by: ['status'],
      _count: { id: true },
    });

    const result: Record<NotificationStatus, number> = {
      pending: 0,
      draft: 0,
      sent: 0,
      acknowledged: 0,
      overdue: 0,
    };

    for (const count of counts) {
      result[count.status as NotificationStatus] = count._count.id;
    }

    return result;
  }
}

// ============================================================================
// NOTIFICATION TEMPLATE REPOSITORY
// ============================================================================

export class NotificationTemplateRepository {
  /**
   * Find a template by ID
   */
  async findById(id: string): Promise<NotificationTemplate | null> {
    const template = await prisma.notificationTemplate.findUnique({
      where: { id },
    });
    return template ? dbTemplateToDomain(template) : null;
  }

  /**
   * Find all templates
   */
  async findAll(): Promise<NotificationTemplate[]> {
    const templates = await prisma.notificationTemplate.findMany({
      orderBy: [{ regulation: 'asc' }, { authority: 'asc' }, { type: 'asc' }],
    });
    return templates.map(dbTemplateToDomain);
  }

  /**
   * Find templates by regulation
   */
  async findByRegulation(regulation: Regulation): Promise<NotificationTemplate[]> {
    const templates = await prisma.notificationTemplate.findMany({
      where: { regulation },
      orderBy: [{ authority: 'asc' }, { type: 'asc' }],
    });
    return templates.map(dbTemplateToDomain);
  }

  /**
   * Find default template for a specific notification
   */
  async findDefault(
    regulation: Regulation,
    authority: Authority,
    type: NotificationType
  ): Promise<NotificationTemplate | null> {
    const template = await prisma.notificationTemplate.findFirst({
      where: {
        regulation,
        authority,
        type,
        isDefault: true,
      },
    });
    return template ? dbTemplateToDomain(template) : null;
  }

  /**
   * Create a template
   */
  async create(input: CreateTemplateInput): Promise<NotificationTemplate> {
    const template = await prisma.notificationTemplate.create({
      data: {
        name: input.name,
        regulation: input.regulation,
        authority: input.authority,
        type: input.type,
        subject: input.subject,
        body: input.body,
        isDefault: input.isDefault ?? false,
      },
    });
    return dbTemplateToDomain(template);
  }

  /**
   * Update a template
   */
  async update(id: string, input: UpdateTemplateInput): Promise<NotificationTemplate | null> {
    try {
      const template = await prisma.notificationTemplate.update({
        where: { id },
        data: {
          name: input.name,
          subject: input.subject,
          body: input.body,
          isDefault: input.isDefault,
        },
      });
      return dbTemplateToDomain(template);
    } catch {
      return null;
    }
  }

  /**
   * Delete a template
   */
  async delete(id: string): Promise<boolean> {
    try {
      await prisma.notificationTemplate.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }
}

// ============================================================================
// SINGLETON INSTANCES
// ============================================================================

export const incidentRepository = new IncidentRepository();
export const incidentNotificationRepository = new IncidentNotificationRepository();
export const notificationTemplateRepository = new NotificationTemplateRepository();
