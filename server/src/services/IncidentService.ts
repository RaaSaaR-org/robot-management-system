/**
 * @file IncidentService.ts
 * @description Service for incident detection, management, and evidence preservation
 * @feature incidents
 *
 * Implements incident handling for regulatory compliance:
 * - EU AI Act Article 73 (Serious incident reporting)
 * - GDPR Articles 33-34 (Data breach notification)
 * - NIS2 Directive Article 23 (Incident reporting)
 * - CRA Article 14 (Vulnerability handling)
 */

import {
  incidentRepository,
  incidentNotificationRepository,
} from '../repositories/IncidentRepository.js';
import { safetyService, type EStopEvent } from './SafetyService.js';
import { robotManager } from './RobotManager.js';
import { alertService } from './AlertService.js';
import type {
  Incident,
  IncidentNotification,
  IncidentSeverity,
  IncidentQueryParams,
  IncidentListResponse,
  IncidentDashboardStats,
  CreateIncidentInput,
  UpdateIncidentInput,
  SafetyEventTrigger,
  SystemSnapshot,
  IncidentEvent,
  IncidentEventCallback,
  NotificationTimeline,
} from '../types/incident.types.js';

// ============================================================================
// INCIDENT SERVICE
// ============================================================================

/**
 * IncidentService - Manages incident lifecycle, detection, and reporting
 */
export class IncidentService {
  private eventCallbacks: Set<IncidentEventCallback> = new Set();
  private unsubscribeSafety?: () => void;
  private initialized = false;

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  /**
   * Initialize the incident service and subscribe to safety events
   */
  initialize(): void {
    if (this.initialized) {
      return;
    }

    console.log('[IncidentService] Initializing incident auto-detection...');

    // Subscribe to E-stop events for auto-detection
    this.unsubscribeSafety = safetyService.onEStopEvent((event) => {
      this.handleEStopEvent(event).catch((err) => {
        console.error('[IncidentService] Failed to handle E-stop event:', err);
      });
    });

    this.initialized = true;
    console.log('[IncidentService] Incident auto-detection active');
  }

  /**
   * Cleanup subscriptions
   */
  shutdown(): void {
    if (this.unsubscribeSafety) {
      this.unsubscribeSafety();
      this.unsubscribeSafety = undefined;
    }
    this.initialized = false;
    console.log('[IncidentService] Shutdown complete');
  }

  // ============================================================================
  // AUTO-DETECTION
  // ============================================================================

  /**
   * Handle E-stop events from SafetyService
   */
  private async handleEStopEvent(event: EStopEvent): Promise<void> {
    console.log(`[IncidentService] E-stop event detected: ${event.scope} by ${event.triggeredBy}`);

    // Map E-stop scope to incident severity
    const severity: IncidentSeverity =
      event.scope === 'fleet' ? 'critical' : event.scope === 'zone' ? 'high' : 'high';

    // Create incident from E-stop event
    const trigger: SafetyEventTrigger = {
      type: 'safety',
      eventType: 'emergency_stop',
      robotId: event.affectedRobots[0] || 'unknown',
      reason: event.reason,
      severity,
      timestamp: new Date(event.triggeredAt),
      metadata: {
        scope: event.scope,
        triggeredBy: event.triggeredBy,
        affectedRobots: event.affectedRobots,
        successCount: event.result.successCount,
        failureCount: event.result.failureCount,
      },
    };

    await this.detectIncident(trigger);
  }

  /**
   * Auto-detect and create incident from safety event trigger
   */
  async detectIncident(trigger: SafetyEventTrigger): Promise<Incident> {
    console.log(`[IncidentService] Detecting incident: ${trigger.eventType}`);

    // Build incident title and description
    const title = this.buildIncidentTitle(trigger);
    const description = this.buildIncidentDescription(trigger);

    // Create the incident
    const incident = await this.createIncident({
      type: trigger.type,
      severity: trigger.severity,
      title,
      description,
      robotId: trigger.robotId !== 'unknown' ? trigger.robotId : undefined,
      complianceLogIds: trigger.complianceLogId ? [trigger.complianceLogId] : undefined,
      alertIds: trigger.alertId ? [trigger.alertId] : undefined,
      detectedAt: trigger.timestamp,
      createdBy: 'system',
    });

    // Capture system snapshot
    await this.captureSystemSnapshot(incident.id);

    // Create alert for the incident
    await alertService.createAlert({
      severity: trigger.severity === 'critical' ? 'critical' : 'error',
      title: `Incident Detected: ${incident.incidentNumber}`,
      message: title,
      source: 'system',
      sourceId: incident.id,
    });

    return incident;
  }

  /**
   * Build incident title from trigger
   */
  private buildIncidentTitle(trigger: SafetyEventTrigger): string {
    const eventTypeMap: Record<string, string> = {
      emergency_stop: 'Emergency Stop',
      protective_stop: 'Protective Stop',
      force_limit: 'Force Limit Exceeded',
      speed_limit: 'Speed Limit Exceeded',
      zone_violation: 'Zone Violation',
    };

    const eventName = eventTypeMap[trigger.eventType] || trigger.eventType;
    return `${eventName}: ${trigger.reason}`;
  }

  /**
   * Build incident description from trigger
   */
  private buildIncidentDescription(trigger: SafetyEventTrigger): string {
    const lines: string[] = [
      `A ${trigger.eventType.replace(/_/g, ' ')} event was detected.`,
      ``,
      `**Reason:** ${trigger.reason}`,
      `**Severity:** ${trigger.severity}`,
      `**Detected At:** ${trigger.timestamp.toISOString()}`,
    ];

    if (trigger.robotId && trigger.robotId !== 'unknown') {
      lines.push(`**Robot ID:** ${trigger.robotId}`);
    }

    if (trigger.metadata) {
      if (trigger.metadata.scope) {
        lines.push(`**Scope:** ${trigger.metadata.scope}`);
      }
      if (trigger.metadata.triggeredBy) {
        lines.push(`**Triggered By:** ${trigger.metadata.triggeredBy}`);
      }
      if (trigger.metadata.affectedRobots) {
        const robots = trigger.metadata.affectedRobots as string[];
        lines.push(`**Affected Robots:** ${robots.length}`);
      }
    }

    return lines.join('\n');
  }

  // ============================================================================
  // CRUD OPERATIONS
  // ============================================================================

  /**
   * Create a new incident
   */
  async createIncident(input: CreateIncidentInput): Promise<Incident> {
    const incident = await incidentRepository.create(input);

    // Emit event
    this.emitEvent({
      type: 'incident_created',
      incident,
      timestamp: new Date(),
    });

    console.log(`[IncidentService] Created incident: ${incident.incidentNumber}`);
    return incident;
  }

  /**
   * Get an incident by ID
   */
  async getIncident(id: string): Promise<Incident | null> {
    return incidentRepository.findById(id, true);
  }

  /**
   * Get an incident by incident number
   */
  async getIncidentByNumber(incidentNumber: string): Promise<Incident | null> {
    return incidentRepository.findByNumber(incidentNumber);
  }

  /**
   * List incidents with filters
   */
  async listIncidents(params?: IncidentQueryParams): Promise<IncidentListResponse> {
    return incidentRepository.findAll(params);
  }

  /**
   * Get open (not closed) incidents
   */
  async getOpenIncidents(): Promise<Incident[]> {
    return incidentRepository.findOpen();
  }

  /**
   * Update an incident
   */
  async updateIncident(id: string, input: UpdateIncidentInput): Promise<Incident | null> {
    const incident = await incidentRepository.update(id, input);

    if (incident) {
      this.emitEvent({
        type: 'incident_updated',
        incident,
        timestamp: new Date(),
      });

      console.log(`[IncidentService] Updated incident: ${incident.incidentNumber}`);
    }

    return incident;
  }

  /**
   * Delete an incident
   */
  async deleteIncident(id: string): Promise<boolean> {
    return incidentRepository.delete(id);
  }

  // ============================================================================
  // EVIDENCE & SNAPSHOTS
  // ============================================================================

  /**
   * Capture current system state as evidence
   */
  async captureSystemSnapshot(incidentId: string): Promise<Incident | null> {
    const incident = await incidentRepository.findById(incidentId);
    if (!incident) {
      return null;
    }

    // Get all robots
    const robots = await robotManager.listRobots();

    // Get active alerts
    const activeAlerts = await alertService.getActiveAlerts();

    const snapshot: SystemSnapshot = {
      capturedAt: new Date(),
      robots: robots.map((robot) => ({
        id: robot.id,
        name: robot.name,
        status: robot.status,
        location: robot.location
          ? {
              x: robot.location.x,
              y: robot.location.y,
              z: robot.location.z ?? 0,
            }
          : undefined,
        operatingMode: robot.metadata?.operatingMode as string | undefined,
        batteryLevel: robot.batteryLevel,
        currentTask: robot.currentTaskName ?? undefined,
      })),
      activeAlerts: activeAlerts.slice(0, 20).map((alert) => ({
        id: alert.id,
        severity: alert.severity,
        title: alert.title,
      })),
      systemHealth: {
        serverUptime: process.uptime(),
        connectedRobots: robots.filter((r) => r.status !== 'offline').length,
        activeWebSockets: 0, // Will be populated by WebSocket service
      },
    };

    return incidentRepository.updateSnapshot(incidentId, snapshot);
  }

  /**
   * Link evidence to an incident
   */
  async linkEvidence(
    incidentId: string,
    complianceLogIds?: string[],
    alertIds?: string[]
  ): Promise<Incident | null> {
    const incident = await incidentRepository.linkEvidence(incidentId, complianceLogIds, alertIds);

    if (incident) {
      this.emitEvent({
        type: 'incident_updated',
        incident,
        timestamp: new Date(),
      });
    }

    return incident;
  }

  // ============================================================================
  // DASHBOARD & STATISTICS
  // ============================================================================

  /**
   * Get incident dashboard statistics
   */
  async getDashboardStats(): Promise<IncidentDashboardStats> {
    const stats = await incidentRepository.getStats();
    const notificationCounts = await incidentNotificationRepository.getCountsByStatus();
    const recentIncidents = await incidentRepository.findAll({
      limit: 5,
      sortBy: 'detectedAt',
      sortOrder: 'desc',
    });

    // Calculate average resolution time
    const resolvedIncidents = await incidentRepository.findAll({
      status: ['resolved', 'closed'],
      limit: 100,
    });

    let averageResolutionTimeHours: number | null = null;
    const resolvedWithTime = resolvedIncidents.incidents.filter(
      (i) => i.resolvedAt && i.detectedAt
    );

    if (resolvedWithTime.length > 0) {
      const totalHours = resolvedWithTime.reduce((sum, i) => {
        const resolved = new Date(i.resolvedAt!).getTime();
        const detected = new Date(i.detectedAt).getTime();
        return sum + (resolved - detected) / (1000 * 60 * 60);
      }, 0);
      averageResolutionTimeHours = Math.round((totalHours / resolvedWithTime.length) * 10) / 10;
    }

    return {
      totalIncidents: stats.total,
      openIncidents: stats.open,
      incidentsBySeverity: stats.bySeverity,
      incidentsByType: stats.byType,
      incidentsByStatus: stats.byStatus,
      overdueNotifications: notificationCounts.overdue,
      pendingNotifications: notificationCounts.pending,
      recentIncidents: recentIncidents.incidents,
      averageResolutionTimeHours,
    };
  }

  /**
   * Get notification timeline for an incident
   */
  async getNotificationTimeline(incidentId: string): Promise<NotificationTimeline | null> {
    const incident = await incidentRepository.findById(incidentId, true);
    if (!incident) {
      return null;
    }

    const now = new Date();
    const notifications = (incident.notifications || []).map((n) => {
      const dueAt = new Date(n.dueAt);
      const hoursRemaining = (dueAt.getTime() - now.getTime()) / (1000 * 60 * 60);
      const isOverdue = hoursRemaining < 0 && !['sent', 'acknowledged'].includes(n.status);

      return {
        ...n,
        hoursRemaining: Math.round(hoursRemaining * 10) / 10,
        isOverdue,
      };
    });

    return {
      incidentId: incident.id,
      incidentNumber: incident.incidentNumber,
      detectedAt: incident.detectedAt,
      notifications,
    };
  }

  /**
   * Get all overdue notifications
   */
  async getOverdueNotifications(): Promise<IncidentNotification[]> {
    return incidentNotificationRepository.findOverdue();
  }

  /**
   * Mark overdue notifications
   */
  async markOverdueNotifications(): Promise<number> {
    const count = await incidentNotificationRepository.markOverdue();
    if (count > 0) {
      console.log(`[IncidentService] Marked ${count} notifications as overdue`);
    }
    return count;
  }

  // ============================================================================
  // EVENT HANDLING
  // ============================================================================

  /**
   * Subscribe to incident events
   */
  onIncidentEvent(callback: IncidentEventCallback): () => void {
    this.eventCallbacks.add(callback);
    return () => this.eventCallbacks.delete(callback);
  }

  /**
   * Emit an incident event to all subscribers
   */
  private emitEvent(event: IncidentEvent): void {
    this.eventCallbacks.forEach((cb) => {
      try {
        cb(event);
      } catch (error) {
        console.error('[IncidentService] Event callback error:', error);
      }
    });
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

export const incidentService = new IncidentService();
