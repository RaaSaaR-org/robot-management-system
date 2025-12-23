/**
 * @file AlertService.ts
 * @description Service for managing alerts with real-time broadcasting
 */

import {
  alertRepository,
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
export class AlertService {
  private eventCallbacks: Set<AlertEventCallback> = new Set();

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
   * Get active (unacknowledged) alerts
   */
  async getActiveAlerts(filters?: Omit<AlertFilters, 'acknowledged'>): Promise<Alert[]> {
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
   * Get alert counts by severity
   */
  async getAlertCounts(): Promise<Record<AlertSeverity, number>> {
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
    message: string
  ): Promise<Alert> {
    return this.createAlert({
      severity,
      title,
      message,
      source: 'robot',
      sourceId: robotId,
      dismissable: severity !== 'critical',
      autoDismissMs: severity === 'info' ? 10000 : undefined,
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
