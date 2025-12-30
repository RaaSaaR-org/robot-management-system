/**
 * @file SafetyService.ts
 * @description Safety management service for fleet-wide E-stop and zone-based stops
 * @feature safety
 */

import { robotManager, type Robot, type RobotCommandRequest } from './RobotManager.js';
import { zoneService } from './ZoneService.js';
import { alertService } from './AlertService.js';
import { HttpClient, HTTP_TIMEOUTS } from './HttpClient.js';

// ============================================================================
// TYPES
// ============================================================================

/** E-stop scope */
export type EStopScope = 'robot' | 'zone' | 'fleet';

/** E-stop status from robot */
export interface RobotEStopStatus {
  robotId: string;
  robotName: string;
  status: 'armed' | 'triggered' | 'resetting';
  triggeredAt?: string;
  triggeredBy?: 'local' | 'remote' | 'server' | 'zone' | 'system';
  reason?: string;
  stopCategory: number;
  requiresManualReset: boolean;
}

/** Safety status from robot */
export interface RobotSafetyStatus extends RobotEStopStatus {
  operatingMode: 'automatic' | 'manual_reduced_speed' | 'manual_full_speed';
  serverConnected: boolean;
  lastServerHeartbeat?: string;
  currentSpeed: number;
  activeSpeedLimit: number;
  activeForceLimit: number;
  systemHealthy: boolean;
  warnings: string[];
  lastCheckTimestamp: string;
}

/** Fleet-wide E-stop result */
export interface FleetEStopResult {
  scope: EStopScope;
  triggeredAt: string;
  triggeredBy: string;
  reason: string;
  robotResults: {
    robotId: string;
    robotName: string;
    success: boolean;
    error?: string;
  }[];
  successCount: number;
  failureCount: number;
}

/** Zone E-stop result */
export interface ZoneEStopResult extends FleetEStopResult {
  zoneId: string;
  zoneName: string;
}

/** E-stop event for logging */
export interface EStopEvent {
  id: string;
  scope: EStopScope;
  triggeredAt: string;
  triggeredBy: string;
  reason: string;
  affectedRobots: string[];
  result: FleetEStopResult | ZoneEStopResult;
}

type EStopEventCallback = (event: EStopEvent) => void;

// ============================================================================
// SAFETY SERVICE
// ============================================================================

/**
 * SafetyService - Manages fleet-wide and zone-based E-stop functionality
 */
class SafetyService {
  private eventCallbacks: Set<EStopEventCallback> = new Set();
  private estopLog: EStopEvent[] = [];
  private heartbeatIntervals: Map<string, NodeJS.Timeout> = new Map();

  // ============================================================================
  // INDIVIDUAL ROBOT E-STOP
  // ============================================================================

  /**
   * Trigger E-stop on a single robot
   */
  async triggerRobotEStop(
    robotId: string,
    reason: string,
    triggeredBy = 'server'
  ): Promise<RobotEStopStatus> {
    const registered = await robotManager.getRegisteredRobot(robotId);
    if (!registered) {
      throw new Error(`Robot ${robotId} not found`);
    }

    if (!registered.isConnected) {
      throw new Error(`Robot ${robotId} is not connected`);
    }

    try {
      const httpClient = new HttpClient(registered.baseUrl, HTTP_TIMEOUTS.SHORT);
      const response = await httpClient.post<RobotEStopStatus>(
        `/api/v1/robots/${robotId}/safety/estop`,
        { reason, triggeredBy }
      );

      // Create alert (non-blocking - don't fail E-stop if alert creation fails)
      alertService.createAlert({
        severity: 'critical',
        title: `Emergency Stop - ${registered.robot.name}`,
        message: `E-stop triggered by ${triggeredBy}: ${reason}`,
        source: 'robot',
        sourceId: robotId,
      }).catch((err) => {
        console.error('[SafetyService] Failed to create alert:', err);
      });

      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to trigger E-stop: ${message}`);
    }
  }

  /**
   * Reset E-stop on a single robot
   */
  async resetRobotEStop(robotId: string): Promise<RobotEStopStatus> {
    const registered = await robotManager.getRegisteredRobot(robotId);
    if (!registered) {
      throw new Error(`Robot ${robotId} not found`);
    }

    if (!registered.isConnected) {
      throw new Error(`Robot ${robotId} is not connected`);
    }

    try {
      const httpClient = new HttpClient(registered.baseUrl, HTTP_TIMEOUTS.SHORT);
      const response = await httpClient.post<RobotEStopStatus>(
        `/api/v1/robots/${robotId}/safety/estop/reset`,
        {}
      );

      // Create info alert
      await alertService.createAlert({
        severity: 'info',
        title: `E-Stop Reset - ${registered.robot.name}`,
        message: 'Emergency stop has been reset. Robot is ready for operation.',
        source: 'robot',
        sourceId: robotId,
      });

      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to reset E-stop: ${message}`);
    }
  }

  /**
   * Get safety status from a robot
   */
  async getRobotSafetyStatus(robotId: string): Promise<RobotSafetyStatus> {
    const registered = await robotManager.getRegisteredRobot(robotId);
    if (!registered) {
      throw new Error(`Robot ${robotId} not found`);
    }

    if (!registered.isConnected) {
      throw new Error(`Robot ${robotId} is not connected`);
    }

    try {
      const httpClient = new HttpClient(registered.baseUrl, HTTP_TIMEOUTS.SHORT);
      return await httpClient.get<RobotSafetyStatus>(
        `/api/v1/robots/${robotId}/safety`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to get safety status: ${message}`);
    }
  }

  // ============================================================================
  // FLEET-WIDE E-STOP
  // ============================================================================

  /**
   * Trigger E-stop on all robots in the fleet
   */
  async triggerFleetEStop(
    reason: string,
    triggeredBy = 'server'
  ): Promise<FleetEStopResult> {
    const robots = await robotManager.listRobots();
    const connectedRobots = robots.filter((r) => r.status !== 'offline');

    const results = await Promise.allSettled(
      connectedRobots.map(async (robot) => {
        try {
          await this.triggerRobotEStop(robot.id, reason, triggeredBy);
          return { robotId: robot.id, robotName: robot.name, success: true };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          return {
            robotId: robot.id,
            robotName: robot.name,
            success: false,
            error: errorMessage,
          };
        }
      })
    );

    const robotResults = results.map((result) => {
      if (result.status === 'fulfilled') {
        return result.value;
      }
      return {
        robotId: 'unknown',
        robotName: 'unknown',
        success: false,
        error: 'Promise rejected',
      };
    });

    const successCount = robotResults.filter((r) => r.success).length;
    const failureCount = robotResults.filter((r) => !r.success).length;

    const fleetResult: FleetEStopResult = {
      scope: 'fleet',
      triggeredAt: new Date().toISOString(),
      triggeredBy,
      reason,
      robotResults,
      successCount,
      failureCount,
    };

    // Log the event
    this.logEStopEvent('fleet', triggeredBy, reason, robotResults.map((r) => r.robotId), fleetResult);

    // Create fleet-wide alert (non-blocking)
    alertService.createAlert({
      severity: 'critical',
      title: 'Fleet-Wide Emergency Stop',
      message: `E-stop triggered by ${triggeredBy} for ${successCount} robots. Reason: ${reason}. ${failureCount > 0 ? `${failureCount} failures.` : ''}`,
      source: 'system',
      sourceId: 'fleet',
    }).catch((err) => {
      console.error('[SafetyService] Failed to create fleet alert:', err);
    });

    return fleetResult;
  }

  /**
   * Reset E-stop on all robots in the fleet
   */
  async resetFleetEStop(): Promise<FleetEStopResult> {
    const robots = await robotManager.listRobots();
    const connectedRobots = robots.filter((r) => r.status !== 'offline');

    const results = await Promise.allSettled(
      connectedRobots.map(async (robot) => {
        try {
          await this.resetRobotEStop(robot.id);
          return { robotId: robot.id, robotName: robot.name, success: true };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          return {
            robotId: robot.id,
            robotName: robot.name,
            success: false,
            error: errorMessage,
          };
        }
      })
    );

    const robotResults = results.map((result) => {
      if (result.status === 'fulfilled') {
        return result.value;
      }
      return {
        robotId: 'unknown',
        robotName: 'unknown',
        success: false,
        error: 'Promise rejected',
      };
    });

    const successCount = robotResults.filter((r) => r.success).length;
    const failureCount = robotResults.filter((r) => !r.success).length;

    return {
      scope: 'fleet',
      triggeredAt: new Date().toISOString(),
      triggeredBy: 'server',
      reason: 'Fleet E-stop reset',
      robotResults,
      successCount,
      failureCount,
    };
  }

  // ============================================================================
  // ZONE-BASED E-STOP
  // ============================================================================

  /**
   * Trigger E-stop on all robots in a specific zone
   */
  async triggerZoneEStop(
    zoneId: string,
    reason: string,
    triggeredBy = 'server'
  ): Promise<ZoneEStopResult> {
    // Get zone details
    const zone = await zoneService.getZone(zoneId);
    if (!zone) {
      throw new Error(`Zone ${zoneId} not found`);
    }

    // Find robots in this zone
    const allRobots = await robotManager.listRobots();
    const robotsInZone = allRobots.filter(
      (robot) =>
        robot.location?.zone === zone.name && robot.status !== 'offline'
    );

    if (robotsInZone.length === 0) {
      return {
        scope: 'zone',
        zoneId,
        zoneName: zone.name,
        triggeredAt: new Date().toISOString(),
        triggeredBy,
        reason,
        robotResults: [],
        successCount: 0,
        failureCount: 0,
      };
    }

    const results = await Promise.allSettled(
      robotsInZone.map(async (robot) => {
        try {
          await this.triggerRobotEStop(
            robot.id,
            `Zone E-stop (${zone.name}): ${reason}`,
            'zone'
          );
          return { robotId: robot.id, robotName: robot.name, success: true };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          return {
            robotId: robot.id,
            robotName: robot.name,
            success: false,
            error: errorMessage,
          };
        }
      })
    );

    const robotResults = results.map((result) => {
      if (result.status === 'fulfilled') {
        return result.value;
      }
      return {
        robotId: 'unknown',
        robotName: 'unknown',
        success: false,
        error: 'Promise rejected',
      };
    });

    const successCount = robotResults.filter((r) => r.success).length;
    const failureCount = robotResults.filter((r) => !r.success).length;

    const zoneResult: ZoneEStopResult = {
      scope: 'zone',
      zoneId,
      zoneName: zone.name,
      triggeredAt: new Date().toISOString(),
      triggeredBy,
      reason,
      robotResults,
      successCount,
      failureCount,
    };

    // Log the event
    this.logEStopEvent('zone', triggeredBy, reason, robotResults.map((r) => r.robotId), zoneResult);

    // Create zone alert
    await alertService.createAlert({
      severity: 'critical',
      title: `Zone Emergency Stop - ${zone.name}`,
      message: `E-stop triggered by ${triggeredBy} for ${successCount} robots in zone. Reason: ${reason}. ${failureCount > 0 ? `${failureCount} failures.` : ''}`,
      source: 'system',
      sourceId: zoneId,
    });

    return zoneResult;
  }

  // ============================================================================
  // HEARTBEAT MANAGEMENT
  // ============================================================================

  /**
   * Start sending heartbeats to all connected robots
   */
  startHeartbeats(intervalMs = 500): void {
    this.stopHeartbeats();

    console.log(`[SafetyService] Starting robot heartbeats every ${intervalMs}ms`);

    // Create interval for heartbeat cycle
    const heartbeatInterval = setInterval(async () => {
      await this.sendHeartbeats();
    }, intervalMs);

    this.heartbeatIntervals.set('main', heartbeatInterval);
  }

  /**
   * Stop all heartbeats
   */
  stopHeartbeats(): void {
    for (const [key, interval] of this.heartbeatIntervals) {
      clearInterval(interval);
      this.heartbeatIntervals.delete(key);
    }
    console.log('[SafetyService] Stopped robot heartbeats');
  }

  /**
   * Send heartbeats to all connected robots
   */
  private async sendHeartbeats(): Promise<void> {
    const robots = await robotManager.listRobots();
    const connectedRobots = robots.filter((r) => r.status !== 'offline');

    await Promise.allSettled(
      connectedRobots.map(async (robot) => {
        try {
          const registered = await robotManager.getRegisteredRobot(robot.id);
          if (!registered || !registered.isConnected) return;

          const httpClient = new HttpClient(registered.baseUrl, HTTP_TIMEOUTS.SHORT);
          await httpClient.post(`/api/v1/robots/${robot.id}/safety/heartbeat`, {});
        } catch {
          // Silently ignore heartbeat failures - health check will handle disconnections
        }
      })
    );
  }

  // ============================================================================
  // FLEET SAFETY STATUS
  // ============================================================================

  /**
   * Get safety status for all robots
   */
  async getFleetSafetyStatus(): Promise<{
    robots: (RobotSafetyStatus & { robotId: string; robotName: string })[];
    anyTriggered: boolean;
    triggeredCount: number;
  }> {
    const robots = await robotManager.listRobots();
    const connectedRobots = robots.filter((r) => r.status !== 'offline');

    const results = await Promise.allSettled(
      connectedRobots.map(async (robot) => {
        try {
          const status = await this.getRobotSafetyStatus(robot.id);
          return {
            ...status,
            robotId: robot.id,
            robotName: robot.name,
          };
        } catch {
          return {
            robotId: robot.id,
            robotName: robot.name,
            status: 'unknown' as const,
            stopCategory: 0,
            requiresManualReset: false,
            operatingMode: 'automatic' as const,
            serverConnected: false,
            currentSpeed: 0,
            activeSpeedLimit: 0,
            activeForceLimit: 0,
            systemHealthy: false,
            warnings: ['Unable to fetch safety status'],
            lastCheckTimestamp: new Date().toISOString(),
          };
        }
      })
    );

    const statusList = results.map((result) => {
      if (result.status === 'fulfilled') {
        return result.value;
      }
      return {
        robotId: 'unknown',
        robotName: 'unknown',
        status: 'unknown' as const,
        stopCategory: 0,
        requiresManualReset: false,
        operatingMode: 'automatic' as const,
        serverConnected: false,
        currentSpeed: 0,
        activeSpeedLimit: 0,
        activeForceLimit: 0,
        systemHealthy: false,
        warnings: [],
        lastCheckTimestamp: new Date().toISOString(),
      };
    });

    const triggeredCount = statusList.filter(
      (s) => s.status === 'triggered'
    ).length;

    return {
      robots: statusList as (RobotSafetyStatus & { robotId: string; robotName: string })[],
      anyTriggered: triggeredCount > 0,
      triggeredCount,
    };
  }

  // ============================================================================
  // EVENT LOGGING
  // ============================================================================

  /**
   * Log an E-stop event
   */
  private logEStopEvent(
    scope: EStopScope,
    triggeredBy: string,
    reason: string,
    affectedRobots: string[],
    result: FleetEStopResult | ZoneEStopResult
  ): void {
    const event: EStopEvent = {
      id: `estop-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      scope,
      triggeredAt: new Date().toISOString(),
      triggeredBy,
      reason,
      affectedRobots,
      result,
    };

    this.estopLog.unshift(event);

    // Keep only last 100 events
    if (this.estopLog.length > 100) {
      this.estopLog.pop();
    }

    // Notify callbacks
    this.eventCallbacks.forEach((cb) => {
      try {
        cb(event);
      } catch (error) {
        console.error('[SafetyService] Event callback error:', error);
      }
    });
  }

  /**
   * Get E-stop event log
   */
  getEStopLog(limit = 50): EStopEvent[] {
    return this.estopLog.slice(0, limit);
  }

  /**
   * Subscribe to E-stop events
   */
  onEStopEvent(callback: EStopEventCallback): () => void {
    this.eventCallbacks.add(callback);
    return () => this.eventCallbacks.delete(callback);
  }
}

// Singleton instance
export const safetyService = new SafetyService();
