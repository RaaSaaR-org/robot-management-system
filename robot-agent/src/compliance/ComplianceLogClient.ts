/**
 * @file ComplianceLogClient.ts
 * @description HTTP client for sending compliance logs to server
 * @feature compliance
 *
 * Provides client-side logging for regulatory compliance:
 * - EU AI Act Article 12 (Record-keeping)
 * - GDPR Article 30 (Records of processing activities)
 * - Machinery Regulation Annex III
 */

import { config } from '../config/config.js';

// ============================================================================
// TYPES
// ============================================================================

export type ComplianceEventType =
  | 'ai_decision'
  | 'safety_action'
  | 'command_execution'
  | 'system_event'
  | 'access_audit';

export type ComplianceSeverity = 'debug' | 'info' | 'warning' | 'error' | 'critical';

export interface AIDecisionPayload {
  description: string;
  inputText?: string;
  inputContext?: Record<string, unknown>;
  outputText?: string;
  outputAction?: string;
  confidence?: number;
  reasoning?: string[];
  alternatives?: Array<{ action: string; reason: string }>;
  safetyClassification?: 'safe' | 'caution' | 'dangerous';
  metadata?: Record<string, unknown>;
}

export interface SafetyActionPayload {
  description: string;
  actionType: string;
  triggerReason: string;
  robotState?: {
    location?: { x: number; y: number; z: number };
    speed?: number;
    force?: number;
    operatingMode?: string;
  };
  affectedRobots?: string[];
  resolutionRequired?: boolean;
  metadata?: Record<string, unknown>;
}

export interface CommandExecutionPayload {
  description: string;
  commandType: string;
  parameters?: Record<string, unknown>;
  executionStatus: 'success' | 'failure' | 'partial';
  errorMessage?: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

export interface SystemEventPayload {
  description: string;
  eventName: string;
  component?: string;
  version?: string;
  configuration?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

interface QueuedLog {
  eventType: ComplianceEventType;
  payload: AIDecisionPayload | SafetyActionPayload | CommandExecutionPayload | SystemEventPayload;
  severity?: ComplianceSeverity;
  modelVersion?: string;
  modelHash?: string;
  inputHash?: string;
  outputHash?: string;
  decisionId?: string;
  timestamp: Date;
}

interface SessionResponse {
  sessionId: string;
  robotId: string;
  startedAt: string;
}

// ============================================================================
// CLIENT CLASS
// ============================================================================

export class ComplianceLogClient {
  private serverUrl: string;
  private robotId: string;
  private sessionId: string | null = null;
  private logQueue: QueuedLog[] = [];
  private flushInterval: NodeJS.Timeout | null = null;
  private isConnected: boolean = false;
  private readonly batchSize = 10;
  private readonly flushIntervalMs = 5000;

  constructor(serverUrl?: string, robotId?: string) {
    this.serverUrl = serverUrl || process.env.SERVER_URL || 'http://localhost:3000';
    this.robotId = robotId || config.robotId;
    console.log(`[ComplianceLogClient] Initialized for robot ${this.robotId}`);
  }

  // ==========================================================================
  // SESSION MANAGEMENT
  // ==========================================================================

  /**
   * Start a compliance logging session with the server
   */
  async startSession(): Promise<string> {
    try {
      const response = await fetch(`${this.serverUrl}/api/compliance/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ robotId: this.robotId }),
      });

      if (!response.ok) {
        throw new Error(`Failed to start session: ${response.statusText}`);
      }

      const session = await response.json() as SessionResponse;
      this.sessionId = session.sessionId;
      this.isConnected = true;

      // Start automatic flush interval
      this.startFlushInterval();

      console.log(`[ComplianceLogClient] Session started: ${this.sessionId}`);
      return this.sessionId;
    } catch (error) {
      console.error('[ComplianceLogClient] Failed to start session:', error);
      this.isConnected = false;
      // Generate local session ID for offline operation
      this.sessionId = `offline-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      console.warn(`[ComplianceLogClient] Using offline session: ${this.sessionId}`);
      return this.sessionId;
    }
  }

  /**
   * End the current session and flush remaining logs
   */
  async endSession(): Promise<void> {
    // Flush any remaining logs
    await this.flush();

    // Stop flush interval
    this.stopFlushInterval();

    if (!this.sessionId || !this.isConnected) {
      this.sessionId = null;
      return;
    }

    try {
      await fetch(`${this.serverUrl}/api/compliance/sessions/${this.sessionId}`, {
        method: 'DELETE',
      });
      console.log(`[ComplianceLogClient] Session ended: ${this.sessionId}`);
    } catch (error) {
      console.error('[ComplianceLogClient] Failed to end session:', error);
    }

    this.sessionId = null;
    this.isConnected = false;
  }

  /**
   * Get current session ID (starts new one if needed)
   */
  async getSessionId(): Promise<string> {
    if (!this.sessionId) {
      return this.startSession();
    }
    return this.sessionId;
  }

  // ==========================================================================
  // LOGGING METHODS
  // ==========================================================================

  /**
   * Log an AI decision
   */
  async logAIDecision(params: {
    payload: AIDecisionPayload;
    modelVersion?: string;
    modelHash?: string;
    input?: string;
    output?: string;
    decisionId?: string;
    severity?: ComplianceSeverity;
  }): Promise<void> {
    await this.queueLog({
      eventType: 'ai_decision',
      payload: params.payload,
      modelVersion: params.modelVersion,
      modelHash: params.modelHash,
      inputHash: params.input ? this.simpleHash(params.input) : undefined,
      outputHash: params.output ? this.simpleHash(params.output) : undefined,
      decisionId: params.decisionId,
      severity: params.severity,
      timestamp: new Date(),
    });
  }

  /**
   * Log a safety action (sent immediately, not batched)
   */
  async logSafetyAction(params: {
    payload: SafetyActionPayload;
    decisionId?: string;
  }): Promise<void> {
    // Safety actions are always sent immediately
    await this.sendLogImmediately({
      eventType: 'safety_action',
      payload: params.payload,
      decisionId: params.decisionId,
      severity: params.payload.resolutionRequired ? 'critical' : 'warning',
      timestamp: new Date(),
    });
  }

  /**
   * Log a command execution
   */
  async logCommandExecution(params: {
    payload: CommandExecutionPayload;
    decisionId?: string;
    severity?: ComplianceSeverity;
  }): Promise<void> {
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

    await this.queueLog({
      eventType: 'command_execution',
      payload: params.payload,
      decisionId: params.decisionId,
      severity,
      timestamp: new Date(),
    });
  }

  /**
   * Log a system event
   */
  async logSystemEvent(params: {
    payload: SystemEventPayload;
    severity?: ComplianceSeverity;
  }): Promise<void> {
    await this.queueLog({
      eventType: 'system_event',
      payload: params.payload,
      severity: params.severity ?? 'info',
      timestamp: new Date(),
    });
  }

  // ==========================================================================
  // QUEUE MANAGEMENT
  // ==========================================================================

  /**
   * Add a log to the queue
   */
  private async queueLog(log: QueuedLog): Promise<void> {
    this.logQueue.push(log);

    // Flush if batch size reached
    if (this.logQueue.length >= this.batchSize) {
      await this.flush();
    }
  }

  /**
   * Send a log immediately (for high-priority events like safety actions)
   */
  private async sendLogImmediately(log: QueuedLog): Promise<void> {
    const sessionId = await this.getSessionId();

    try {
      const response = await fetch(`${this.serverUrl}/api/compliance/logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          robotId: this.robotId,
          eventType: log.eventType,
          severity: log.severity,
          payload: log.payload,
          modelVersion: log.modelVersion,
          modelHash: log.modelHash,
          inputHash: log.inputHash,
          outputHash: log.outputHash,
          decisionId: log.decisionId,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to send log: ${response.statusText}`);
      }

      console.log(`[ComplianceLogClient] Sent ${log.eventType} log immediately`);
    } catch (error) {
      console.error('[ComplianceLogClient] Failed to send immediate log:', error);
      // Queue for retry
      this.logQueue.push(log);
    }
  }

  /**
   * Flush all queued logs to the server
   */
  async flush(): Promise<void> {
    if (this.logQueue.length === 0) return;

    const logsToSend = [...this.logQueue];
    this.logQueue = [];

    const sessionId = await this.getSessionId();

    // Send logs one by one (server doesn't support batch endpoint yet)
    let successCount = 0;
    const failedLogs: QueuedLog[] = [];

    for (const log of logsToSend) {
      try {
        const response = await fetch(`${this.serverUrl}/api/compliance/logs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            robotId: this.robotId,
            eventType: log.eventType,
            severity: log.severity,
            payload: log.payload,
            modelVersion: log.modelVersion,
            modelHash: log.modelHash,
            inputHash: log.inputHash,
            outputHash: log.outputHash,
            decisionId: log.decisionId,
          }),
        });

        if (response.ok) {
          successCount++;
        } else {
          failedLogs.push(log);
        }
      } catch {
        failedLogs.push(log);
      }
    }

    // Re-queue failed logs
    if (failedLogs.length > 0) {
      this.logQueue = [...failedLogs, ...this.logQueue];
      console.warn(`[ComplianceLogClient] ${failedLogs.length} logs failed, re-queued`);
    }

    if (successCount > 0) {
      console.log(`[ComplianceLogClient] Flushed ${successCount} logs`);
    }
  }

  /**
   * Start automatic flush interval
   */
  private startFlushInterval(): void {
    if (this.flushInterval) return;

    this.flushInterval = setInterval(() => {
      this.flush().catch((error) => {
        console.error('[ComplianceLogClient] Auto-flush failed:', error);
      });
    }, this.flushIntervalMs);
  }

  /**
   * Stop automatic flush interval
   */
  private stopFlushInterval(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
  }

  // ==========================================================================
  // UTILITIES
  // ==========================================================================

  /**
   * Simple hash function for input/output hashing
   * Note: Server uses SHA-256, this is a simplified client-side hash
   */
  private simpleHash(data: string): string {
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      const char = data.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(16).padStart(8, '0');
  }

  /**
   * Get queue size (for debugging/monitoring)
   */
  getQueueSize(): number {
    return this.logQueue.length;
  }

  /**
   * Check if connected to server
   */
  isServerConnected(): boolean {
    return this.isConnected;
  }
}

// Export singleton instance
export const complianceLogClient = new ComplianceLogClient();
