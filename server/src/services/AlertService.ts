/**
 * @file AlertService.ts
 * @description Service for managing alerts with real-time broadcasting
 */

import {
  alertRepository,
  robotRepository,
  type Alert,
  type AlertSeverity,
  type AlertSource,
  type CreateAlertInput,
  type AlertFilters,
  type PaginationParams,
  type PaginatedResult,
} from '../repositories/index.js';

// ============================================================================
// TYPES
// ============================================================================

/** Alert event types */
export type AlertEventType = 'alert_created' | 'alert_acknowledged' | 'alert_deleted';

/** Alert event payload */
export interface AlertEvent {
  type: AlertEventType;
  alert: Alert;
  timestamp: string;
}

type AlertEventCallback = (event: AlertEvent) => void;

// Re-export types for convenience
export type { Alert, AlertSeverity, AlertSource, CreateAlertInput, AlertFilters };

// ============================================================================
// ALERT SERVICE
// ============================================================================

/**
 * AlertService - manages alerts with event broadcasting for real-time updates
 */
/** Title prefixes of status alerts RobotManager creates on health-check transitions. */
const ROBOT_STATUS_TITLE_PREFIXES = ['Robot offline:', 'Robot error:'] as const;

/** Robot statuses that count as "recovered" for auto-resolving offline/error alerts. */
const RECOVERED_STATUSES = new Set(['online', 'busy', 'charging']);

export class AlertService {
  private eventCallbacks: Set<AlertEventCallback> = new Set();
  private staleSweepInterval: NodeJS.Timeout | null = null;

  // ============================================================================
  // QUERY OPERATIONS
  // ============================================================================

  /**
   * Get an alert by ID
   */
  async getAlert(id: string): Promise<Alert | null> {
    return alertRepository.findById(id);
  }

  /**
   * Get all alerts with optional filters and pagination
   */
  async getAlerts(
    filters?: AlertFilters,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<Alert>> {
    return alertRepository.findAll(filters, pagination);
  }

  /**
   * Get active (unacknowledged) alerts.
   * Expires elapsed auto-dismiss alerts first so every consumer of "active"
   * (list, counts, badges) sees the same set at the same moment.
   */
  async getActiveAlerts(filters?: Omit<AlertFilters, 'acknowledged'>): Promise<Alert[]> {
    await alertRepository.expireAutoDismissed();
    return alertRepository.findActive(filters);
  }

  /**
   * Get alert history (all alerts including acknowledged)
   */
  async getAlertHistory(
    filters?: AlertFilters,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<Alert>> {
    return alertRepository.findAll(filters, pagination);
  }

  /**
   * Get alert counts by severity.
   * Shares the active-alert definition with getActiveAlerts (expiry included)
   * so the header badge, severity tiles, and Active tab always agree.
   */
  async getAlertCounts(): Promise<Record<AlertSeverity, number>> {
    await alertRepository.expireAutoDismissed();
    return alertRepository.getCountsBySeverity();
  }

  // ============================================================================
  // MUTATION OPERATIONS
  // ============================================================================

  /**
   * Create a new alert and broadcast to subscribers
   */
  async createAlert(input: CreateAlertInput): Promise<Alert> {
    const alert = await alertRepository.create(input);

    this.emitEvent({
      type: 'alert_created',
      alert,
      timestamp: new Date().toISOString(),
    });

    console.log(`[AlertService] Alert created: ${alert.severity} - ${alert.title}`);
    return alert;
  }

  /**
   * Acknowledge an alert
   */
  async acknowledgeAlert(id: string, userId?: string): Promise<Alert | null> {
    const alert = await alertRepository.acknowledge(id, userId);

    if (alert) {
      this.emitEvent({
        type: 'alert_acknowledged',
        alert,
        timestamp: new Date().toISOString(),
      });

      console.log(`[AlertService] Alert acknowledged: ${alert.title}`);
    }

    return alert;
  }

  /**
   * Delete an alert
   */
  async deleteAlert(id: string): Promise<boolean> {
    const alert = await alertRepository.findById(id);
    if (!alert) return false;

    const deleted = await alertRepository.delete(id);

    if (deleted) {
      this.emitEvent({
        type: 'alert_deleted',
        alert,
        timestamp: new Date().toISOString(),
      });
    }

    return deleted;
  }

  // ============================================================================
  // AUTO-RESOLVE (stale-alert lifecycle)
  // ============================================================================

  /**
   * Resolve (acknowledge) the active offline/error status alerts for a robot
   * that has recovered or reconnected. Called by RobotManager on recovery
   * transitions so stale "Robot offline"/"Robot error" rows don't linger.
   */
  async resolveRobotStatusAlerts(
    robotId: string,
    resolvedBy = 'system:auto-resolve'
  ): Promise<number> {
    const active = await alertRepository.findActive({ source: 'robot', sourceId: robotId });
    const toResolve = active.filter((a) =>
      ROBOT_STATUS_TITLE_PREFIXES.some((p) => a.title.startsWith(p))
    );
    return this.acknowledgeAndEmit(toResolve, resolvedBy);
  }

  /**
   * One sweep of stale-alert cleanup:
   *  1. Expire unacknowledged alerts whose autoDismissMs window has elapsed
   *     (keeps /active, /counts, and any badge consistent server-side).
   *  2. Resolve active robot-sourced alerts referencing robots that no longer
   *     exist (matched by sourceId, or by robot name in the title for legacy
   *     rows without sourceId).
   *  3. Resolve active offline/error status alerts for robots that are
   *     currently recovered (online/busy/charging).
   */
  async sweepStaleAlerts(): Promise<void> {
    const expired = await alertRepository.expireAutoDismissed();
    if (expired > 0) {
      console.log(`[AlertService] Auto-dismissed ${expired} expired alert(s)`);
    }

    const active = await alertRepository.findActive({ source: 'robot' });
    if (active.length === 0) return;

    const robots = await robotRepository.findAll();
    const robotById = new Map(robots.map((r) => [r.id, r]));

    const toResolve: Alert[] = [];
    for (const alert of active) {
      const isStatusAlert = ROBOT_STATUS_TITLE_PREFIXES.some((p) => alert.title.startsWith(p));

      // Resolve alert.sourceId, falling back to a robot-name match in the
      // title for legacy rows that were created without a sourceId.
      const robot = alert.sourceId
        ? robotById.get(alert.sourceId)
        : robots.find((r) => alert.title.includes(r.name) || alert.message.includes(r.name));

      if (!robot) {
        // Referenced robot no longer exists in the fleet — alert is orphaned.
        toResolve.push(alert);
        continue;
      }

      if (isStatusAlert && RECOVERED_STATUSES.has(robot.status)) {
        toResolve.push(alert);
      }
    }

    const resolved = await this.acknowledgeAndEmit(toResolve, 'system:auto-resolve');
    if (resolved > 0) {
      console.log(`[AlertService] Auto-resolved ${resolved} stale robot alert(s)`);
    }
  }

  /**
   * Start the periodic stale-alert sweep (also runs once immediately so a
   * server restart cleans up rows left behind by a previous run).
   */
  startStaleAlertSweep(intervalMs = 60000): void {
    this.stopStaleAlertSweep();
    console.log(`[AlertService] Starting stale-alert sweep every ${intervalMs}ms`);

    this.staleSweepInterval = setInterval(() => {
      this.sweepStaleAlerts().catch((err) =>
        console.error('[AlertService] Stale-alert sweep error:', err)
      );
    }, intervalMs);

    this.sweepStaleAlerts().catch((err) =>
      console.error('[AlertService] Initial stale-alert sweep error:', err)
    );
  }

  /** Stop the periodic stale-alert sweep. */
  stopStaleAlertSweep(): void {
    if (this.staleSweepInterval) {
      clearInterval(this.staleSweepInterval);
      this.staleSweepInterval = null;
    }
  }

  /** Acknowledge a batch of alerts and emit alert_acknowledged for each. */
  private async acknowledgeAndEmit(alerts: Alert[], resolvedBy: string): Promise<number> {
    if (alerts.length === 0) return 0;

    const count = await alertRepository.acknowledgeMany(
      alerts.map((a) => a.id),
      resolvedBy
    );

    const timestamp = new Date().toISOString();
    for (const alert of alerts) {
      this.emitEvent({
        type: 'alert_acknowledged',
        alert: { ...alert, acknowledged: true, acknowledgedAt: timestamp, acknowledgedBy: resolvedBy },
        timestamp,
      });
    }

    return count;
  }

  /**
   * Delete all acknowledged alerts
   */
  async clearAcknowledgedAlerts(): Promise<number> {
    return alertRepository.deleteAcknowledged();
  }

  /**
   * Delete all alerts
   */
  async clearAllAlerts(): Promise<number> {
    return alertRepository.deleteAll();
  }

  // ============================================================================
  // CONVENIENCE METHODS
  // ============================================================================

  /**
   * Create an alert from robot telemetry errors/warnings
   */
  async createRobotAlert(
    robotId: string,
    severity: AlertSeverity,
    title: string,
    message: string,
    options: { persistent?: boolean } = {}
  ): Promise<Alert> {
    return this.createAlert({
      severity,
      title,
      message,
      source: 'robot',
      sourceId: robotId,
      dismissable: severity !== 'critical',
      // `persistent`: an info alert that must wait for a human (a patrol
      // finding rated low) instead of auto-dismissing after 10 s.
      autoDismissMs: severity === 'info' && !options.persistent ? 10000 : undefined,
    });
  }

  /**
   * Create a system alert
   */
  async createSystemAlert(
    severity: AlertSeverity,
    title: string,
    message: string
  ): Promise<Alert> {
    return this.createAlert({
      severity,
      title,
      message,
      source: 'system',
      dismissable: severity !== 'critical',
      autoDismissMs: severity === 'info' ? 10000 : undefined,
    });
  }

  /**
   * Create a task alert
   */
  async createTaskAlert(
    taskId: string,
    severity: AlertSeverity,
    title: string,
    message: string
  ): Promise<Alert> {
    return this.createAlert({
      severity,
      title,
      message,
      source: 'task',
      sourceId: taskId,
      dismissable: severity !== 'critical',
      autoDismissMs: severity === 'info' ? 10000 : undefined,
    });
  }

  // ============================================================================
  // EVENTS
  // ============================================================================

  /**
   * Subscribe to alert events
   */
  onAlertEvent(callback: AlertEventCallback): () => void {
    this.eventCallbacks.add(callback);
    return () => this.eventCallbacks.delete(callback);
  }

  /**
   * Emit an event to all subscribers
   */
  private emitEvent(event: AlertEvent): void {
    this.eventCallbacks.forEach((cb) => {
      try {
        cb(event);
      } catch (error) {
        console.error('[AlertService] Event callback error:', error);
      }
    });
  }
}

// Singleton instance
export const alertService = new AlertService();
