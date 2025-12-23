/**
 * @file AlertRepository.ts
 * @description Data access layer for Alert entities
 */

import { prisma } from '../database/index.js';
import type { Alert as PrismaAlert } from '@prisma/client';

// ============================================================================
// TYPES
// ============================================================================

export type AlertSeverity = 'critical' | 'error' | 'warning' | 'info';
export type AlertSource = 'robot' | 'task' | 'system' | 'user';

export interface Alert {
  id: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  source: AlertSource;
  sourceId?: string;
  acknowledged: boolean;
  acknowledgedAt?: string;
  acknowledgedBy?: string;
  dismissable: boolean;
  autoDismissMs?: number;
  timestamp: string;
}

export interface CreateAlertInput {
  severity: AlertSeverity;
  title: string;
  message: string;
  source: AlertSource;
  sourceId?: string;
  dismissable?: boolean;
  autoDismissMs?: number;
}

export interface AlertFilters {
  severity?: AlertSeverity | AlertSeverity[];
  source?: AlertSource | AlertSource[];
  sourceId?: string;
  acknowledged?: boolean;
  startDate?: Date;
  endDate?: Date;
}

export interface PaginationParams {
  page?: number;
  pageSize?: number;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function dbAlertToDomain(dbAlert: PrismaAlert): Alert {
  return {
    id: dbAlert.id,
    severity: dbAlert.severity as AlertSeverity,
    title: dbAlert.title,
    message: dbAlert.message,
    source: dbAlert.source as AlertSource,
    sourceId: dbAlert.sourceId ?? undefined,
    acknowledged: dbAlert.acknowledged,
    acknowledgedAt: dbAlert.acknowledgedAt?.toISOString(),
    acknowledgedBy: dbAlert.acknowledgedBy ?? undefined,
    dismissable: dbAlert.dismissable,
    autoDismissMs: dbAlert.autoDismissMs ?? undefined,
    timestamp: dbAlert.createdAt.toISOString(),
  };
}

// ============================================================================
// REPOSITORY
// ============================================================================

export class AlertRepository {
  /**
   * Find an alert by ID
   */
  async findById(id: string): Promise<Alert | null> {
    const alert = await prisma.alert.findUnique({
      where: { id },
    });
    return alert ? dbAlertToDomain(alert) : null;
  }

  /**
   * Find all alerts with optional filters and pagination
   */
  async findAll(
    filters?: AlertFilters,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<Alert>> {
    const page = pagination?.page ?? 1;
    const pageSize = pagination?.pageSize ?? 50;
    const skip = (page - 1) * pageSize;

    const where = this.buildWhereClause(filters);

    const [alerts, total] = await Promise.all([
      prisma.alert.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      prisma.alert.count({ where }),
    ]);

    return {
      data: alerts.map(dbAlertToDomain),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  /**
   * Find active (unacknowledged) alerts
   */
  async findActive(filters?: Omit<AlertFilters, 'acknowledged'>): Promise<Alert[]> {
    const where = this.buildWhereClause({ ...filters, acknowledged: false });

    const alerts = await prisma.alert.findMany({
      where,
      orderBy: [
        { severity: 'asc' }, // 'critical' comes first alphabetically, but we'll sort in app
        { createdAt: 'desc' },
      ],
    });

    // Sort by severity priority: critical, error, warning, info
    const severityOrder: Record<string, number> = {
      critical: 0,
      error: 1,
      warning: 2,
      info: 3,
    };

    return alerts
      .map(dbAlertToDomain)
      .sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
  }

  /**
   * Create a new alert
   */
  async create(input: CreateAlertInput): Promise<Alert> {
    const alert = await prisma.alert.create({
      data: {
        severity: input.severity,
        title: input.title,
        message: input.message,
        source: input.source,
        sourceId: input.sourceId,
        dismissable: input.dismissable ?? (input.severity !== 'critical'),
        autoDismissMs: input.autoDismissMs,
      },
    });

    return dbAlertToDomain(alert);
  }

  /**
   * Acknowledge an alert
   */
  async acknowledge(id: string, userId?: string): Promise<Alert | null> {
    try {
      const alert = await prisma.alert.update({
        where: { id },
        data: {
          acknowledged: true,
          acknowledgedAt: new Date(),
          acknowledgedBy: userId,
        },
      });
      return dbAlertToDomain(alert);
    } catch {
      return null;
    }
  }

  /**
   * Delete an alert
   */
  async delete(id: string): Promise<boolean> {
    try {
      await prisma.alert.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Delete all acknowledged alerts
   */
  async deleteAcknowledged(): Promise<number> {
    const result = await prisma.alert.deleteMany({
      where: { acknowledged: true },
    });
    return result.count;
  }

  /**
   * Delete all alerts
   */
  async deleteAll(): Promise<number> {
    const result = await prisma.alert.deleteMany({});
    return result.count;
  }

  /**
   * Get alert counts by severity
   */
  async getCountsBySeverity(): Promise<Record<AlertSeverity, number>> {
    const counts = await prisma.alert.groupBy({
      by: ['severity'],
      _count: { id: true },
      where: { acknowledged: false },
    });

    const result: Record<AlertSeverity, number> = {
      critical: 0,
      error: 0,
      warning: 0,
      info: 0,
    };

    for (const count of counts) {
      result[count.severity as AlertSeverity] = count._count.id;
    }

    return result;
  }

  /**
   * Build Prisma where clause from filters
   */
  private buildWhereClause(filters?: AlertFilters): Record<string, unknown> {
    if (!filters) return {};

    const where: Record<string, unknown> = {};

    if (filters.severity) {
      where.severity = Array.isArray(filters.severity)
        ? { in: filters.severity }
        : filters.severity;
    }

    if (filters.source) {
      where.source = Array.isArray(filters.source)
        ? { in: filters.source }
        : filters.source;
    }

    if (filters.sourceId) {
      where.sourceId = filters.sourceId;
    }

    if (filters.acknowledged !== undefined) {
      where.acknowledged = filters.acknowledged;
    }

    if (filters.startDate || filters.endDate) {
      where.createdAt = {};
      if (filters.startDate) {
        (where.createdAt as Record<string, Date>).gte = filters.startDate;
      }
      if (filters.endDate) {
        (where.createdAt as Record<string, Date>).lte = filters.endDate;
      }
    }

    return where;
  }
}

export const alertRepository = new AlertRepository();
