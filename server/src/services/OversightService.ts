/**
 * @file OversightService.ts
 * @description Service for human oversight management per EU AI Act Article 14
 * @feature oversight
 *
 * Implements human oversight mechanisms for:
 * - Art. 14(4)(a): Understand capabilities & limitations
 * - Art. 14(4)(c): Interpret AI outputs correctly
 * - Art. 14(4)(d): Decide not to use / disregard AI output
 * - Art. 14(4)(e): Intervene or stop the system
 * - Art. 14(3): Automation bias prevention
 */

import {
  manualControlSessionRepository,
  verificationScheduleRepository,
  verificationCompletionRepository,
  oversightLogRepository,
  anomalyRecordRepository,
} from '../repositories/OversightRepository.js';
import { robotManager } from './RobotManager.js';
import { alertService } from './AlertService.js';
import type {
  ManualControlSession,
  VerificationSchedule,
  VerificationCompletion,
  OversightLog,
  AnomalyRecord,
  ActivateManualModeInput,
  CreateVerificationScheduleInput,
  CompleteVerificationInput,
  CreateOversightLogInput,
  CreateAnomalyInput,
  ManualSessionQueryParams,
  AnomalyQueryParams,
  OversightLogQueryParams,
  VerificationScheduleQueryParams,
  AnomalyListResponse,
  OversightLogListResponse,
  ManualModeResponse,
  DueVerification,
  RobotCapabilitiesSummary,
  FleetCapabilitiesOverview,
  OversightDashboardStats,
  OversightEvent,
  OversightEventCallback,
  OperatingMode,
  AnomalySeverity,
  AnomalyType,
} from '../types/oversight.types.js';

// ============================================================================
// OVERSIGHT SERVICE
// ============================================================================

/**
 * OversightService - Manages human oversight mechanisms for AI Act compliance
 */
export class OversightService {
  private eventCallbacks: Set<OversightEventCallback> = new Set();
  private initialized = false;
  private dueVerificationCheckInterval?: NodeJS.Timeout;

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  /**
   * Initialize the oversight service
   */
  initialize(): void {
    if (this.initialized) {
      return;
    }

    console.log('[OversightService] Initializing human oversight mechanisms...');

    // Check for due verifications every 5 minutes
    this.dueVerificationCheckInterval = setInterval(
      () => this.checkDueVerifications(),
      5 * 60 * 1000
    );

    this.initialized = true;
    console.log('[OversightService] Human oversight service active');
  }

  /**
   * Cleanup and shutdown
   */
  shutdown(): void {
    if (this.dueVerificationCheckInterval) {
      clearInterval(this.dueVerificationCheckInterval);
      this.dueVerificationCheckInterval = undefined;
    }
    this.initialized = false;
    console.log('[OversightService] Shutdown complete');
  }

  // ============================================================================
  // MANUAL CONTROL MODE
  // ============================================================================

  /**
   * Activate manual control mode for a robot
   */
  async activateManualMode(input: ActivateManualModeInput): Promise<ManualModeResponse> {
    console.log(`[OversightService] Activating manual mode for robot ${input.robotId}`);

    // Get robot info
    const robot = await robotManager.getRobot(input.robotId);
    if (!robot) {
      throw new Error(`Robot ${input.robotId} not found`);
    }

    const previousMode = (robot.metadata?.operatingMode as OperatingMode) || 'automatic';

    // Create manual control session
    const session = await manualControlSessionRepository.create(input);

    // Update robot operating mode
    const newMode: OperatingMode =
      input.mode === 'full_speed' ? 'manual_full_speed' : 'manual_reduced_speed';

    // Log the oversight action
    await this.logAction({
      actionType: 'manual_mode_activated',
      operatorId: input.operatorId,
      robotId: input.robotId,
      reason: input.reason,
      details: {
        previousMode,
        newMode,
        sessionId: session.id,
        speedLimit: session.speedLimitMmPerSec,
        forceLimit: session.forceLimitN,
      },
    });

    // Emit event
    this.emitEvent({
      type: 'manual_mode_changed',
      robotId: input.robotId,
      session,
      timestamp: new Date(),
    });

    // Create alert
    await alertService.createAlert({
      severity: 'warning',
      title: 'Manual Control Activated',
      message: `Manual control mode activated for ${robot.name} by operator. Reason: ${input.reason}`,
      source: 'system',
      sourceId: input.robotId,
    });

    return {
      session,
      robot: {
        id: robot.id,
        name: robot.name,
        previousMode,
        newMode,
      },
    };
  }

  /**
   * Deactivate manual control mode
   */
  async deactivateManualMode(
    sessionId: string,
    operatorId: string
  ): Promise<ManualControlSession | null> {
    const session = await manualControlSessionRepository.end(sessionId);
    if (!session) {
      return null;
    }

    console.log(`[OversightService] Deactivated manual mode for robot ${session.robotId}`);

    // Log the oversight action
    await this.logAction({
      actionType: 'manual_mode_deactivated',
      operatorId,
      robotId: session.robotId,
      reason: 'Manual control session ended',
      details: {
        sessionId,
        duration: Date.now() - new Date(session.startedAt).getTime(),
      },
    });

    // Emit event
    this.emitEvent({
      type: 'manual_mode_changed',
      robotId: session.robotId,
      session,
      timestamp: new Date(),
    });

    return session;
  }

  /**
   * Get active manual control sessions
   */
  async getActiveManualSessions(): Promise<ManualControlSession[]> {
    return manualControlSessionRepository.findAllActive();
  }

  /**
   * Get active session for a specific robot
   */
  async getRobotManualSession(robotId: string): Promise<ManualControlSession | null> {
    return manualControlSessionRepository.findActiveByRobotId(robotId);
  }

  /**
   * Get manual session history
   */
  async getManualSessionHistory(
    params?: ManualSessionQueryParams
  ): Promise<ManualControlSession[]> {
    return manualControlSessionRepository.findAll(params);
  }

  // ============================================================================
  // VERIFICATION SCHEDULES (Automation Bias Prevention)
  // ============================================================================

  /**
   * Create a new verification schedule
   */
  async createVerificationSchedule(
    input: CreateVerificationScheduleInput
  ): Promise<VerificationSchedule> {
    const schedule = await verificationScheduleRepository.create(input);
    console.log(`[OversightService] Created verification schedule: ${schedule.name}`);
    return schedule;
  }

  /**
   * Get all verification schedules
   */
  async getVerificationSchedules(
    params?: VerificationScheduleQueryParams
  ): Promise<VerificationSchedule[]> {
    return verificationScheduleRepository.findAll(params);
  }

  /**
   * Get due verifications
   */
  async getDueVerifications(): Promise<DueVerification[]> {
    const dueSchedules = await verificationScheduleRepository.findDue();
    const now = new Date();

    return Promise.all(
      dueSchedules.map(async (schedule) => {
        const completions = await verificationCompletionRepository.findByScheduleId(
          schedule.id,
          1
        );
        const lastCompletion = completions[0] || null;

        const dueAt = schedule.nextDueAt ?? now;
        const overdueSinceMinutes = Math.max(
          0,
          Math.floor((now.getTime() - dueAt.getTime()) / (1000 * 60))
        );

        return {
          schedule,
          lastCompletion,
          dueAt,
          overdueSinceMinutes,
        };
      })
    );
  }

  /**
   * Complete a verification
   */
  async completeVerification(input: CompleteVerificationInput): Promise<VerificationCompletion> {
    const completion = await verificationCompletionRepository.create(input);

    // Log the oversight action
    await this.logAction({
      actionType: 'verification_completed',
      operatorId: input.operatorId,
      robotId: input.robotId,
      reason: `Verification ${input.status}: ${input.notes || 'No notes'}`,
      details: {
        scheduleId: input.scheduleId,
        completionId: completion.id,
        status: input.status,
      },
    });

    // Emit event
    const schedule = await verificationScheduleRepository.findById(input.scheduleId);
    if (schedule) {
      this.emitEvent({
        type: 'verification_completed',
        verification: schedule,
        timestamp: new Date(),
      });
    }

    console.log(`[OversightService] Verification completed: ${input.scheduleId}`);
    return completion;
  }

  /**
   * Update a verification schedule
   */
  async updateVerificationSchedule(
    id: string,
    input: Partial<CreateVerificationScheduleInput>
  ): Promise<VerificationSchedule | null> {
    return verificationScheduleRepository.update(id, input);
  }

  /**
   * Deactivate a verification schedule
   */
  async deactivateVerificationSchedule(id: string): Promise<VerificationSchedule | null> {
    return verificationScheduleRepository.deactivate(id);
  }

  /**
   * Check for due verifications and create alerts
   */
  private async checkDueVerifications(): Promise<void> {
    const dueVerifications = await this.getDueVerifications();
    const overdueCount = dueVerifications.filter((v) => v.overdueSinceMinutes > 0).length;

    if (overdueCount > 0) {
      console.log(`[OversightService] ${overdueCount} overdue verifications detected`);

      for (const due of dueVerifications.filter((v) => v.overdueSinceMinutes > 30)) {
        // Alert for significantly overdue verifications
        await alertService.createAlert({
          severity: 'warning',
          title: 'Verification Overdue',
          message: `Verification "${due.schedule.name}" is ${due.overdueSinceMinutes} minutes overdue`,
          source: 'system',
          autoDismissMs: 30 * 60 * 1000, // Auto-dismiss after 30 minutes
        });

        this.emitEvent({
          type: 'verification_due',
          verification: due.schedule,
          timestamp: new Date(),
        });
      }
    }
  }

  // ============================================================================
  // ANOMALY MANAGEMENT
  // ============================================================================

  /**
   * Create an anomaly record
   */
  async createAnomaly(input: CreateAnomalyInput): Promise<AnomalyRecord> {
    const anomaly = await anomalyRecordRepository.create(input);
    console.log(`[OversightService] Anomaly detected: ${input.anomalyType} for robot ${input.robotId}`);

    // Create alert for critical/high severity anomalies
    if (['critical', 'high'].includes(input.severity)) {
      await alertService.createAlert({
        severity: input.severity === 'critical' ? 'critical' : 'error',
        title: `Anomaly Detected: ${input.anomalyType.replace(/_/g, ' ')}`,
        message: input.description,
        source: 'robot',
        sourceId: input.robotId,
      });
    }

    // Emit event
    this.emitEvent({
      type: 'anomaly_detected',
      robotId: input.robotId,
      anomaly,
      timestamp: new Date(),
    });

    return anomaly;
  }

  /**
   * Get active anomalies
   */
  async getActiveAnomalies(robotId?: string): Promise<AnomalyRecord[]> {
    if (robotId) {
      return anomalyRecordRepository.findActiveByRobotId(robotId);
    }
    return anomalyRecordRepository.findAllActive();
  }

  /**
   * Get anomalies with filters
   */
  async getAnomalies(params?: AnomalyQueryParams): Promise<AnomalyListResponse> {
    return anomalyRecordRepository.findAll(params);
  }

  /**
   * Get unacknowledged anomalies
   */
  async getUnacknowledgedAnomalies(): Promise<AnomalyRecord[]> {
    return anomalyRecordRepository.findUnacknowledged();
  }

  /**
   * Acknowledge an anomaly
   */
  async acknowledgeAnomaly(anomalyId: string, operatorId: string): Promise<AnomalyRecord | null> {
    const anomaly = await anomalyRecordRepository.acknowledge(anomalyId, operatorId);
    if (!anomaly) {
      return null;
    }

    // Log the action
    await this.logAction({
      actionType: 'anomaly_acknowledged',
      operatorId,
      robotId: anomaly.robotId,
      reason: `Anomaly acknowledged: ${anomaly.anomalyType}`,
      details: { anomalyId, anomalyType: anomaly.anomalyType },
    });

    // Emit event
    this.emitEvent({
      type: 'anomaly_acknowledged',
      robotId: anomaly.robotId,
      anomaly,
      timestamp: new Date(),
    });

    console.log(`[OversightService] Anomaly ${anomalyId} acknowledged by ${operatorId}`);
    return anomaly;
  }

  /**
   * Resolve an anomaly
   */
  async resolveAnomaly(
    anomalyId: string,
    resolution: string,
    operatorId: string
  ): Promise<AnomalyRecord | null> {
    const anomaly = await anomalyRecordRepository.resolve(anomalyId, resolution);
    if (!anomaly) {
      return null;
    }

    // Log the action
    await this.logAction({
      actionType: 'anomaly_resolved',
      operatorId,
      robotId: anomaly.robotId,
      reason: `Anomaly resolved: ${resolution}`,
      details: { anomalyId, resolution, anomalyType: anomaly.anomalyType },
    });

    // Emit event
    this.emitEvent({
      type: 'anomaly_resolved',
      robotId: anomaly.robotId,
      anomaly,
      timestamp: new Date(),
    });

    console.log(`[OversightService] Anomaly ${anomalyId} resolved`);
    return anomaly;
  }

  // ============================================================================
  // OVERSIGHT LOGGING
  // ============================================================================

  /**
   * Log an oversight action
   */
  async logAction(input: CreateOversightLogInput): Promise<OversightLog> {
    const log = await oversightLogRepository.create(input);

    // Emit event
    this.emitEvent({
      type: 'oversight_action',
      log,
      timestamp: new Date(),
    });

    return log;
  }

  /**
   * Get oversight logs
   */
  async getOversightLogs(params?: OversightLogQueryParams): Promise<OversightLogListResponse> {
    return oversightLogRepository.findAll(params);
  }

  /**
   * Get recent oversight logs
   */
  async getRecentLogs(limit = 10): Promise<OversightLog[]> {
    return oversightLogRepository.findRecent(limit);
  }

  // ============================================================================
  // CAPABILITIES SUMMARY
  // ============================================================================

  /**
   * Get robot capabilities summary for a single robot
   */
  async getRobotCapabilitiesSummary(robotId: string): Promise<RobotCapabilitiesSummary | null> {
    const robot = await robotManager.getRobot(robotId);
    if (!robot) {
      return null;
    }

    // Get active manual session
    const manualSession = await manualControlSessionRepository.findActiveByRobotId(robotId);

    // Get active anomalies
    const activeAnomalies = await anomalyRecordRepository.findActiveByRobotId(robotId);

    // Parse capabilities
    const capabilities = (robot.capabilities || []).map((cap) => ({
      name: cap,
      description: this.getCapabilityDescription(cap),
      isAvailable: robot.status === 'online' || robot.status === 'busy',
      confidenceLevel: 95, // Placeholder - would come from AI metrics
      limitations: [],
    }));

    // Get current limitations based on robot state
    const limitations: string[] = [];
    const warnings: string[] = [];
    const errors: string[] = [];

    if (robot.status === 'offline') {
      limitations.push('Robot is offline');
    }
    if (robot.batteryLevel < 20) {
      limitations.push(`Low battery (${robot.batteryLevel}%)`);
    }
    if (manualSession) {
      limitations.push(`In manual control mode (speed limit: ${manualSession.speedLimitMmPerSec}mm/s)`);
    }

    // Add anomaly-based warnings
    for (const anomaly of activeAnomalies) {
      if (anomaly.severity === 'critical' || anomaly.severity === 'high') {
        errors.push(anomaly.description);
      } else {
        warnings.push(anomaly.description);
      }
    }

    return {
      robotId: robot.id,
      robotName: robot.name,
      model: robot.model,
      firmware: robot.firmware ?? null,
      status: robot.status,
      operatingMode: manualSession
        ? (manualSession.speedLimitMmPerSec > 250 ? 'manual_full_speed' : 'manual_reduced_speed')
        : 'automatic',
      isInManualMode: !!manualSession,
      manualSession,
      capabilities,
      limitations,
      warnings,
      errors,
      batteryLevel: robot.batteryLevel,
      cpuUsage: null, // Would come from telemetry
      memoryUsage: null,
      temperature: null,
      overallConfidence: 90, // Placeholder
      recentDecisionAccuracy: 95, // Placeholder
      activeAnomalies,
    };
  }

  /**
   * Get fleet-wide capabilities overview
   */
  async getFleetCapabilitiesOverview(): Promise<FleetCapabilitiesOverview> {
    const robots = await robotManager.listRobots();
    const activeSessions = await manualControlSessionRepository.findAllActive();
    const activeAnomalies = await anomalyRecordRepository.findAllActive();
    const dueVerifications = await verificationScheduleRepository.findDue();

    // Calculate metrics
    const onlineRobots = robots.filter((r) => r.status !== 'offline').length;
    const robotsWithAnomalies = new Set(activeAnomalies.map((a) => a.robotId)).size;

    // Status breakdown
    const statusBreakdown: Record<string, number> = {};
    for (const robot of robots) {
      statusBreakdown[robot.status] = (statusBreakdown[robot.status] || 0) + 1;
    }

    // Mode breakdown
    const robotsInManual = new Set(activeSessions.map((s) => s.robotId)).size;
    const modeBreakdown: Record<OperatingMode, number> = {
      automatic: robots.length - robotsInManual,
      manual_reduced_speed: activeSessions.filter((s) => s.speedLimitMmPerSec <= 250).length,
      manual_full_speed: activeSessions.filter((s) => s.speedLimitMmPerSec > 250).length,
    };

    // Anomalies by severity
    const anomaliesBySeverity = await anomalyRecordRepository.getCountsBySeverity();

    // Average battery level
    const robotsWithBattery = robots.filter((r) => r.batteryLevel != null);
    const averageBatteryLevel =
      robotsWithBattery.length > 0
        ? Math.round(
            robotsWithBattery.reduce((sum, r) => sum + r.batteryLevel, 0) / robotsWithBattery.length
          )
        : null;

    // Today's date for filtering
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dueToday = dueVerifications.filter((s) => s.nextDueAt && s.nextDueAt >= today);

    return {
      totalRobots: robots.length,
      onlineRobots,
      robotsInManualMode: robotsInManual,
      robotsWithAnomalies,
      averageConfidence: 90, // Placeholder
      averageBatteryLevel,
      statusBreakdown,
      modeBreakdown,
      totalActiveAnomalies: activeAnomalies.length,
      anomaliesBySeverity,
      overdueVerifications: dueVerifications.filter((s) => s.isOverdue).length,
      dueVerificationsToday: dueToday.length,
      robots: robots.map((r) => ({
        id: r.id,
        name: r.name,
        status: r.status,
        operatingMode: activeSessions.find((s) => s.robotId === r.id)
          ? 'manual_reduced_speed' as OperatingMode
          : 'automatic' as OperatingMode,
        hasAnomalies: activeAnomalies.some((a) => a.robotId === r.id),
        batteryLevel: r.batteryLevel,
      })),
    };
  }

  /**
   * Get capability description
   */
  private getCapabilityDescription(capability: string): string {
    const descriptions: Record<string, string> = {
      navigation: 'Autonomous navigation and path planning',
      manipulation: 'Object manipulation and handling',
      gripper: 'Gripper control for picking and placing',
      a2a: 'Agent-to-Agent communication protocol',
      speech: 'Voice recognition and synthesis',
      vision: 'Computer vision and object detection',
    };
    return descriptions[capability] || capability;
  }

  // ============================================================================
  // DASHBOARD STATISTICS
  // ============================================================================

  /**
   * Get oversight dashboard statistics
   */
  async getDashboardStats(): Promise<OversightDashboardStats> {
    const [
      activeManualSessions,
      manualSessionsToday,
      activeAnomalies,
      unacknowledgedAnomalies,
      anomaliesBySeverity,
      anomaliesByType,
      totalSchedules,
      overdueVerifications,
      completedToday,
      complianceRate,
      recentLogs,
      recentAnomalies,
    ] = await Promise.all([
      manualControlSessionRepository.countActive(),
      manualControlSessionRepository.countToday(),
      anomalyRecordRepository.countActive(),
      anomalyRecordRepository.countUnacknowledged(),
      anomalyRecordRepository.getCountsBySeverity(),
      anomalyRecordRepository.getCountsByType(),
      verificationScheduleRepository.countActive(),
      verificationScheduleRepository.findDue().then((d) => d.filter((s) => s.isOverdue).length),
      verificationCompletionRepository.countToday(),
      verificationCompletionRepository.getComplianceRate(),
      oversightLogRepository.findRecent(10),
      anomalyRecordRepository.findAll({ limit: 5, isActive: true }).then((r) => r.anomalies),
    ]);

    return {
      activeManualSessions,
      manualSessionsToday,
      activeAnomalies,
      unacknowledgedAnomalies,
      anomaliesBySeverity,
      anomaliesByType,
      totalVerificationSchedules: totalSchedules,
      overdueVerifications,
      completedVerificationsToday: completedToday,
      verificationComplianceRate: complianceRate,
      recentLogs,
      recentAnomalies,
    };
  }

  // ============================================================================
  // EVENT HANDLING
  // ============================================================================

  /**
   * Subscribe to oversight events
   */
  onOversightEvent(callback: OversightEventCallback): () => void {
    this.eventCallbacks.add(callback);
    return () => this.eventCallbacks.delete(callback);
  }

  /**
   * Emit an oversight event to all subscribers
   */
  private emitEvent(event: OversightEvent): void {
    this.eventCallbacks.forEach((cb) => {
      try {
        cb(event);
      } catch (error) {
        console.error('[OversightService] Event callback error:', error);
      }
    });
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

export const oversightService = new OversightService();
