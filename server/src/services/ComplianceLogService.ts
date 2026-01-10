/**
 * @file ComplianceLogService.ts
 * @description Service for compliance logging with session management
 * @feature compliance
 *
 * Provides structured logging for regulatory compliance:
 * - EU AI Act Article 12 (Record-keeping)
 * - GDPR Article 30 (Records of processing activities)
 * - Machinery Regulation Annex III
 */

import { complianceLogRepository } from '../repositories/ComplianceLogRepository.js';
import { generateSessionId, hashInput, hashOutput, sha256 } from '../security/encryption.js';
import type {
  ComplianceLog,
  ComplianceLogListResponse,
  ComplianceLogQueryParams,
  HashChainVerificationResult,
  ComplianceMetricsSummary,
  ComplianceSession,
  SessionStartResponse,
  ComplianceEventType,
  ComplianceSeverity,
  AIDecisionPayload,
  SafetyActionPayload,
  CommandExecutionPayload,
  SystemEventPayload,
  AccessAuditPayload,
} from '../types/compliance.types.js';

// ============================================================================
// RE-EXPORT TYPES
// ============================================================================

export type {
  ComplianceLog,
  ComplianceLogListResponse,
  ComplianceLogQueryParams,
  HashChainVerificationResult,
  ComplianceMetricsSummary,
  ComplianceSession,
  SessionStartResponse,
  ComplianceEventType,
  ComplianceSeverity,
  AIDecisionPayload,
  SafetyActionPayload,
  CommandExecutionPayload,
  SystemEventPayload,
  AccessAuditPayload,
};

// ============================================================================
// SESSION MANAGEMENT
// ============================================================================

/** Active sessions mapped by sessionId */
const activeSessions = new Map<string, ComplianceSession>();

/** Sessions mapped by robotId for lookup */
const robotSessions = new Map<string, string>();

// ============================================================================
// SERVICE CLASS
// ============================================================================

export class ComplianceLogService {
  constructor() {
    console.log('[ComplianceLogService] Initialized');
  }

  // ==========================================================================
  // SESSION MANAGEMENT
  // ==========================================================================

  /**
   * Start a new compliance logging session for a robot
   */
  startSession(robotId: string): SessionStartResponse {
    // Check if robot already has an active session
    const existingSessionId = robotSessions.get(robotId);
    if (existingSessionId && activeSessions.has(existingSessionId)) {
      const existing = activeSessions.get(existingSessionId)!;
      console.log(`[ComplianceLogService] Robot ${robotId} already has active session ${existing.sessionId}`);
      return {
        sessionId: existing.sessionId,
        robotId: existing.robotId,
        startedAt: existing.startedAt,
      };
    }

    // Create new session
    const sessionId = generateSessionId();
    const session: ComplianceSession = {
      sessionId,
      robotId,
      startedAt: new Date(),
      logCount: 0,
    };

    activeSessions.set(sessionId, session);
    robotSessions.set(robotId, sessionId);

    console.log(`[ComplianceLogService] Started session ${sessionId} for robot ${robotId}`);

    return {
      sessionId,
      robotId,
      startedAt: session.startedAt,
    };
  }

  /**
   * End a compliance logging session
   */
  endSession(sessionId: string): ComplianceSession | null {
    const session = activeSessions.get(sessionId);
    if (!session) {
      console.warn(`[ComplianceLogService] Session ${sessionId} not found`);
      return null;
    }

    session.endedAt = new Date();
    activeSessions.delete(sessionId);
    robotSessions.delete(session.robotId);

    console.log(`[ComplianceLogService] Ended session ${sessionId} for robot ${session.robotId}`);

    return session;
  }

  /**
   * Get or create session for a robot
   */
  getOrCreateSession(robotId: string): SessionStartResponse {
    const existingSessionId = robotSessions.get(robotId);
    if (existingSessionId && activeSessions.has(existingSessionId)) {
      const existing = activeSessions.get(existingSessionId)!;
      return {
        sessionId: existing.sessionId,
        robotId: existing.robotId,
        startedAt: existing.startedAt,
      };
    }
    return this.startSession(robotId);
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string): ComplianceSession | null {
    return activeSessions.get(sessionId) ?? null;
  }

  /**
   * Get session by robot ID
   */
  getSessionByRobotId(robotId: string): ComplianceSession | null {
    const sessionId = robotSessions.get(robotId);
    if (!sessionId) return null;
    return activeSessions.get(sessionId) ?? null;
  }

  // ==========================================================================
  // LOGGING METHODS
  // ==========================================================================

  /**
   * Log an AI decision
   */
  async logAIDecision(params: {
    sessionId: string;
    robotId: string;
    operatorId?: string;
    payload: AIDecisionPayload;
    modelVersion?: string;
    modelHash?: string;
    input?: unknown;
    output?: unknown;
    decisionId?: string;
    severity?: ComplianceSeverity;
  }): Promise<ComplianceLog> {
    const log = await complianceLogRepository.create({
      sessionId: params.sessionId,
      robotId: params.robotId,
      operatorId: params.operatorId,
      eventType: 'ai_decision',
      severity: params.severity ?? 'info',
      payload: params.payload,
      modelVersion: params.modelVersion,
      modelHash: params.modelHash,
      inputHash: params.input ? hashInput(params.input) : undefined,
      outputHash: params.output ? hashOutput(params.output) : undefined,
      decisionId: params.decisionId,
    });

    this.incrementSessionLogCount(params.sessionId);
    return log;
  }

  /**
   * Log a safety action (high priority, critical for compliance)
   */
  async logSafetyAction(params: {
    sessionId: string;
    robotId: string;
    operatorId?: string;
    payload: SafetyActionPayload;
    decisionId?: string;
  }): Promise<ComplianceLog> {
    // Safety actions are always at least warning severity
    const severity: ComplianceSeverity = params.payload.resolutionRequired ? 'critical' : 'warning';

    const log = await complianceLogRepository.create({
      sessionId: params.sessionId,
      robotId: params.robotId,
      operatorId: params.operatorId,
      eventType: 'safety_action',
      severity,
      payload: params.payload,
      decisionId: params.decisionId,
    });

    this.incrementSessionLogCount(params.sessionId);
    console.log(`[ComplianceLogService] Safety action logged: ${params.payload.actionType}`);
    return log;
  }

  /**
   * Log a command execution
   */
  async logCommandExecution(params: {
    sessionId: string;
    robotId: string;
    operatorId?: string;
    payload: CommandExecutionPayload;
    decisionId?: string;
    severity?: ComplianceSeverity;
  }): Promise<ComplianceLog> {
    // Determine severity based on execution status
    let severity = params.severity;
    if (!severity) {
      switch (params.payload.executionStatus) {
        case 'failure':
          severity = 'error';
          break;
        case 'partial':
          severity = 'warning';
          break;
        default:
          severity = 'info';
      }
    }

    const log = await complianceLogRepository.create({
      sessionId: params.sessionId,
      robotId: params.robotId,
      operatorId: params.operatorId,
      eventType: 'command_execution',
      severity,
      payload: params.payload,
      decisionId: params.decisionId,
    });

    this.incrementSessionLogCount(params.sessionId);
    return log;
  }

  /**
   * Log a system event
   */
  async logSystemEvent(params: {
    sessionId: string;
    robotId: string;
    payload: SystemEventPayload;
    severity?: ComplianceSeverity;
  }): Promise<ComplianceLog> {
    const log = await complianceLogRepository.create({
      sessionId: params.sessionId,
      robotId: params.robotId,
      eventType: 'system_event',
      severity: params.severity ?? 'info',
      payload: params.payload,
    });

    this.incrementSessionLogCount(params.sessionId);
    return log;
  }

  /**
   * Log access to a resource (audit of audits)
   */
  async logAccess(params: {
    sessionId: string;
    robotId: string;
    operatorId?: string;
    payload: AccessAuditPayload;
    severity?: ComplianceSeverity;
  }): Promise<ComplianceLog> {
    const log = await complianceLogRepository.create({
      sessionId: params.sessionId,
      robotId: params.robotId,
      operatorId: params.operatorId,
      eventType: 'access_audit',
      severity: params.severity ?? 'info',
      payload: params.payload,
    });

    this.incrementSessionLogCount(params.sessionId);
    return log;
  }

  // ==========================================================================
  // RETRIEVAL METHODS
  // ==========================================================================

  /**
   * Get a log by ID (records access for audit trail)
   */
  async getLog(
    id: string,
    userId?: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<ComplianceLog | null> {
    return complianceLogRepository.findById(id, userId, ipAddress, userAgent);
  }

  /**
   * List logs with filters and pagination
   */
  async listLogs(params?: ComplianceLogQueryParams): Promise<ComplianceLogListResponse> {
    return complianceLogRepository.findAll(params);
  }

  /**
   * Get logs by session ID
   */
  async getLogsBySession(sessionId: string): Promise<ComplianceLog[]> {
    return complianceLogRepository.findBySessionId(sessionId);
  }

  /**
   * Get logs linked to a Decision (for Explainability integration)
   */
  async getLogsByDecision(decisionId: string): Promise<ComplianceLog[]> {
    return complianceLogRepository.findByDecisionId(decisionId);
  }

  /**
   * Get access history for a log
   */
  async getLogAccessHistory(logId: string) {
    return complianceLogRepository.getAccessHistory(logId);
  }

  // ==========================================================================
  // VERIFICATION METHODS
  // ==========================================================================

  /**
   * Verify hash chain integrity
   */
  async verifyIntegrity(
    startDate?: Date,
    endDate?: Date,
  ): Promise<HashChainVerificationResult> {
    const result = await complianceLogRepository.verifyHashChain(startDate, endDate);

    if (!result.isValid) {
      console.error(
        `[ComplianceLogService] Hash chain verification FAILED: ${result.brokenLinks.length} broken links`,
      );
    } else {
      console.log(
        `[ComplianceLogService] Hash chain verified: ${result.verifiedLogs} logs OK`,
      );
    }

    return result;
  }

  // ==========================================================================
  // METRICS METHODS
  // ==========================================================================

  /**
   * Get event type counts
   */
  async getEventTypeCounts(startDate?: Date, endDate?: Date) {
    return complianceLogRepository.getEventTypeCounts(startDate, endDate);
  }

  /**
   * Get comprehensive metrics summary
   */
  async getMetricsSummary(startDate?: Date, endDate?: Date): Promise<ComplianceMetricsSummary> {
    return complianceLogRepository.getMetricsSummary(startDate, endDate);
  }

  /**
   * Get total log count
   */
  async getLogCount(params?: Pick<ComplianceLogQueryParams, 'sessionId' | 'robotId' | 'eventType'>): Promise<number> {
    return complianceLogRepository.count(params);
  }

  // ==========================================================================
  // HELPER FOR COMMAND INTERPRETER INTEGRATION
  // ==========================================================================

  /**
   * Create a compliance log from a command interpretation
   * Called alongside ExplainabilityService to link audit trail to explanations
   */
  async logFromCommandInterpretation(params: {
    robotId: string;
    operatorId?: string;
    originalText: string;
    commandType: string;
    confidence: number;
    safetyClassification: 'safe' | 'caution' | 'dangerous';
    warnings: string[];
    modelUsed: string;
    decisionId: string;
  }): Promise<ComplianceLog> {
    const session = this.getOrCreateSession(params.robotId);

    const payload: AIDecisionPayload = {
      description: `Command interpretation: ${params.commandType}`,
      inputText: params.originalText,
      outputAction: params.commandType,
      confidence: params.confidence,
      safetyClassification: params.safetyClassification,
      reasoning: [
        `Interpreted as ${params.commandType}`,
        `Safety: ${params.safetyClassification}`,
        `Confidence: ${Math.round(params.confidence * 100)}%`,
      ],
      metadata: {
        warnings: params.warnings,
      },
    };

    return this.logAIDecision({
      sessionId: session.sessionId,
      robotId: params.robotId,
      operatorId: params.operatorId,
      payload,
      modelVersion: params.modelUsed,
      modelHash: sha256(params.modelUsed), // Simple hash of model name
      input: params.originalText,
      output: params.commandType,
      decisionId: params.decisionId,
      severity: params.safetyClassification === 'dangerous' ? 'warning' : 'info',
    });
  }

  // ==========================================================================
  // PRIVATE HELPERS
  // ==========================================================================

  /**
   * Increment log count for a session
   */
  private incrementSessionLogCount(sessionId: string): void {
    const session = activeSessions.get(sessionId);
    if (session) {
      session.logCount++;
    }
  }
}

// Export singleton instance
export const complianceLogService = new ComplianceLogService();
