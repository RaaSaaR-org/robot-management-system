/**
 * @file RobotManager.ts
 * @description Service for managing robot registry and A2A connections
 */

import axios from 'axios';
import type { A2AAgentCard } from '../types/index.js';
import { agentCardResolver } from './A2AClient.js';
import { conversationManager } from './ConversationManager.js';
import { robotRepository } from '../repositories/index.js';

// ============================================================================
// TYPES
// ============================================================================

/** Robot operational status */
export type RobotStatus =
  | 'online'
  | 'offline'
  | 'busy'
  | 'error'
  | 'charging'
  | 'maintenance';

/** Command execution status */
export type CommandStatus = 'pending' | 'executing' | 'completed' | 'failed' | 'cancelled';

/** Command types supported by robots */
export type CommandType =
  | 'move'
  | 'stop'
  | 'pickup'
  | 'drop'
  | 'charge'
  | 'return_home'
  | 'emergency_stop'
  | 'custom';

/** Robot type for 3D visualization */
export type RobotType = 'h1' | 'so101' | 'generic';

/** Joint state for 3D animation */
export interface JointState {
  name: string;
  position: number;
  velocity?: number;
  effort?: number;
}

/** Robot location in the facility */
export interface RobotLocation {
  x: number;
  y: number;
  z?: number;
  floor?: string;
  zone?: string;
  heading?: number;
}

/** Core robot entity */
export interface Robot {
  id: string;
  name: string;
  model: string;
  serialNumber?: string;
  status: RobotStatus;
  batteryLevel: number;
  location: RobotLocation;
  lastSeen: string;
  currentTaskId?: string;
  currentTaskName?: string;
  capabilities: string[];
  firmware?: string;
  ipAddress?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  a2aEnabled?: boolean;
  a2aAgentUrl?: string;
}

/** Robot telemetry data */
export interface RobotTelemetry {
  robotId: string;
  robotType?: RobotType;
  batteryLevel: number;
  batteryVoltage?: number;
  batteryTemperature?: number;
  cpuUsage: number;
  memoryUsage: number;
  diskUsage?: number;
  temperature: number;
  humidity?: number;
  speed?: number;
  sensors: Record<string, number | boolean | string>;
  jointStates?: JointState[];
  errors?: string[];
  warnings?: string[];
  timestamp: string;
}

/** Robot command request */
export interface RobotCommandRequest {
  type: CommandType;
  payload?: Record<string, unknown>;
  priority?: 'low' | 'normal' | 'high' | 'critical';
}

/** Robot command entity */
export interface RobotCommand {
  id: string;
  robotId: string;
  type: CommandType;
  payload: Record<string, unknown>;
  status: CommandStatus;
  priority: 'low' | 'normal' | 'high' | 'critical';
  result?: Record<string, unknown>;
  errorMessage?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

/** Robot endpoints for communication */
export interface RobotEndpoints {
  robot: string;
  command: string;
  telemetry: string;
  telemetryWs: string;
}

/** Registration info from robot agent */
export interface RegistrationInfo {
  robot: Robot;
  endpoints: RobotEndpoints;
  a2a: {
    agentCard: string;
  };
}

/** Registered robot with full metadata */
export interface RegisteredRobot {
  robot: Robot;
  endpoints: RobotEndpoints;
  agentCard: A2AAgentCard;
  baseUrl: string;
  lastHealthCheck: string;
  isConnected: boolean;
  registeredAt: string;
}

/** Robot event types */
export type RobotEventType =
  | 'robot_registered'
  | 'robot_unregistered'
  | 'robot_status_changed'
  | 'robot_telemetry'
  | 'robot_health_check';

/** Robot event */
export interface RobotEvent {
  type: RobotEventType;
  robotId: string;
  robot?: Robot;
  telemetry?: RobotTelemetry;
  timestamp: string;
}

type RobotEventCallback = (event: RobotEvent) => void;

// ============================================================================
// ROBOT MANAGER
// ============================================================================

/**
 * RobotManager - manages robot registry and A2A connections with database persistence
 */
export class RobotManager {
  // In-memory cache for active robot connections
  private robotCache: Map<string, RegisteredRobot> = new Map();
  private eventCallbacks: Set<RobotEventCallback> = new Set();
  private healthCheckInterval: NodeJS.Timeout | null = null;

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  /**
   * Load robots from database into cache on startup
   */
  async initialize(): Promise<void> {
    const registeredRobots = await robotRepository.getAllRegisteredRobots();
    for (const robot of registeredRobots) {
      this.robotCache.set(robot.robot.id, robot);
    }
    console.log(`[RobotManager] Loaded ${registeredRobots.length} robots from database`);
  }

  // ============================================================================
  // REGISTRATION
  // ============================================================================

  /**
   * Register a robot from its base URL
   * Fetches registration info and agent card
   */
  async registerRobot(robotUrl: string): Promise<RegisteredRobot> {
    // Normalize URL
    const baseUrl = robotUrl.endsWith('/') ? robotUrl.slice(0, -1) : robotUrl;

    console.log(`[RobotManager] Registering robot from ${baseUrl}`);

    try {
      // Fetch registration info from robot
      const registerUrl = `${baseUrl}/api/v1/register`;
      console.log(`[RobotManager] Fetching registration info from ${registerUrl}`);

      const regResponse = await axios.get<RegistrationInfo>(registerUrl, {
        timeout: 10000,
      });

      const registrationInfo = regResponse.data;

      if (!registrationInfo.robot || !registrationInfo.endpoints) {
        throw new Error('Invalid registration info: missing robot or endpoints');
      }

      // Fetch agent card
      console.log(`[RobotManager] Fetching agent card from ${baseUrl}`);
      const agentCard = await agentCardResolver.fetchAgentCard(baseUrl);

      // Build full endpoint URLs
      const endpoints: RobotEndpoints = {
        robot: `${baseUrl}${registrationInfo.endpoints.robot}`,
        command: `${baseUrl}${registrationInfo.endpoints.command}`,
        telemetry: `${baseUrl}${registrationInfo.endpoints.telemetry}`,
        telemetryWs: registrationInfo.endpoints.telemetryWs,
      };

      // Update robot with A2A info
      const robotWithA2A: Robot = {
        ...registrationInfo.robot,
        a2aEnabled: true,
        a2aAgentUrl: baseUrl,
      };

      // Persist to database
      await robotRepository.upsertWithRegistration(robotWithA2A, endpoints, agentCard, baseUrl);

      // Create registered robot entry
      const now = new Date().toISOString();
      const registeredRobot: RegisteredRobot = {
        robot: robotWithA2A,
        endpoints,
        agentCard,
        baseUrl,
        lastHealthCheck: now,
        isConnected: true,
        registeredAt: now,
      };

      // Cache in memory
      this.robotCache.set(registeredRobot.robot.id, registeredRobot);

      // Also register as A2A agent in ConversationManager
      await conversationManager.registerAgent(agentCard);

      // Emit event
      this.emitEvent({
        type: 'robot_registered',
        robotId: registeredRobot.robot.id,
        robot: registeredRobot.robot,
        timestamp: now,
      });

      console.log(
        `[RobotManager] Successfully registered robot: ${registeredRobot.robot.name} (${registeredRobot.robot.id})`
      );

      return registeredRobot;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[RobotManager] Failed to register robot from ${baseUrl}:`, message);
      throw new Error(`Failed to register robot: ${message}`);
    }
  }

  /**
   * Unregister a robot by ID
   */
  async unregisterRobot(robotId: string): Promise<boolean> {
    const registered = this.robotCache.get(robotId);
    if (!registered) {
      // Check database
      const dbRobot = await robotRepository.getRegisteredRobot(robotId);
      if (!dbRobot) {
        return false;
      }
    }

    // Remove from cache
    this.robotCache.delete(robotId);

    // Delete from database
    await robotRepository.delete(robotId);

    // Also unregister from A2A agents
    if (registered) {
      await conversationManager.unregisterAgent(registered.agentCard.name);
      agentCardResolver.clearCache(registered.baseUrl);
    }

    // Emit event
    this.emitEvent({
      type: 'robot_unregistered',
      robotId,
      timestamp: new Date().toISOString(),
    });

    console.log(`[RobotManager] Unregistered robot: ${robotId}`);

    return true;
  }

  // ============================================================================
  // ROBOT ACCESS
  // ============================================================================

  /**
   * Get all registered robots
   */
  async listRobots(): Promise<Robot[]> {
    return robotRepository.findAll();
  }

  /**
   * Get a single robot by ID
   */
  async getRobot(robotId: string): Promise<Robot | undefined> {
    // Check cache first
    const cached = this.robotCache.get(robotId);
    if (cached) {
      return cached.robot;
    }

    return (await robotRepository.findById(robotId)) ?? undefined;
  }

  /**
   * Get full registered robot data
   */
  async getRegisteredRobot(robotId: string): Promise<RegisteredRobot | undefined> {
    // Check cache first
    if (this.robotCache.has(robotId)) {
      return this.robotCache.get(robotId);
    }

    // Load from database
    const registered = await robotRepository.getRegisteredRobot(robotId);
    if (registered) {
      this.robotCache.set(robotId, registered);
    }
    return registered ?? undefined;
  }

  /**
   * Get agent cards for connected robots only
   * Used by orchestrator to route messages only to online robots
   */
  getConnectedAgents(): A2AAgentCard[] {
    return Array.from(this.robotCache.values())
      .filter((r) => r.isConnected)
      .map((r) => r.agentCard);
  }

  // ============================================================================
  // ROBOT COMMANDS
  // ============================================================================

  /**
   * Send a command to a robot
   */
  async sendCommand(robotId: string, command: RobotCommandRequest): Promise<RobotCommand> {
    const registered = await this.getRegisteredRobot(robotId);
    if (!registered) {
      throw new Error(`Robot ${robotId} not found`);
    }

    if (!registered.isConnected) {
      throw new Error(`Robot ${robotId} is not connected`);
    }

    try {
      console.log(`[RobotManager] Sending command to ${robotId}:`, command);

      const response = await axios.post<RobotCommand>(registered.endpoints.command, command, {
        timeout: 30000,
        headers: { 'Content-Type': 'application/json' },
      });

      return response.data;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to send command: ${message}`);
    }
  }

  // ============================================================================
  // TELEMETRY
  // ============================================================================

  /**
   * Get current telemetry from a robot
   */
  async getTelemetry(robotId: string): Promise<RobotTelemetry> {
    const registered = await this.getRegisteredRobot(robotId);
    if (!registered) {
      throw new Error(`Robot ${robotId} not found`);
    }

    try {
      const response = await axios.get<RobotTelemetry>(registered.endpoints.telemetry, {
        timeout: 10000,
      });

      return response.data;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to get telemetry: ${message}`);
    }
  }

  // ============================================================================
  // HEALTH CHECKS
  // ============================================================================

  /**
   * Start periodic health checks
   */
  startHealthChecks(intervalMs: number = 30000): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    console.log(`[RobotManager] Starting health checks every ${intervalMs}ms`);

    this.healthCheckInterval = setInterval(() => {
      this.performHealthChecks().catch((error) => {
        console.error('[RobotManager] Health check cycle error:', error);
      });
    }, intervalMs);

    // Run immediately with error handling
    this.performHealthChecks().catch((error) => {
      console.error('[RobotManager] Initial health check error:', error);
    });
  }

  /**
   * Stop health checks
   */
  stopHealthChecks(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
      console.log('[RobotManager] Stopped health checks');
    }
  }

  /**
   * Perform health check on all robots
   */
  private async performHealthChecks(): Promise<void> {
    const robots = Array.from(this.robotCache.values());

    for (const registered of robots) {
      try {
        const healthUrl = `${registered.baseUrl}/api/v1/health`;
        const response = await axios.get<{
          status: string;
          robotStatus: RobotStatus;
          batteryLevel: number;
        }>(healthUrl, {
          timeout: 5000,
        });

        const now = new Date().toISOString();
        registered.lastHealthCheck = now;

        // Update connection status
        const wasConnected = registered.isConnected;
        registered.isConnected = true;

        // Always update battery level from health check
        const newBatteryLevel = response.data.batteryLevel ?? registered.robot.batteryLevel;
        const statusChanged = response.data.robotStatus && response.data.robotStatus !== registered.robot.status;
        const batteryChanged = newBatteryLevel !== registered.robot.batteryLevel;

        // Also fetch robot data to sync position
        let locationChanged = false;
        try {
          const robotResponse = await axios.get<Robot>(registered.endpoints.robot, {
            timeout: 5000,
          });
          const robotData = robotResponse.data;
          if (robotData.location) {
            const oldLoc = registered.robot.location;
            const newLoc = robotData.location;
            // Check if position actually changed
            if (oldLoc.x !== newLoc.x || oldLoc.y !== newLoc.y || oldLoc.zone !== newLoc.zone) {
              registered.robot.location = newLoc;
              locationChanged = true;
            }
          }
        } catch (robotError) {
          // Log but don't fail health check - position sync is secondary
          console.warn(`[RobotManager] Failed to sync position for ${registered.robot.id}`);
        }

        // Update in-memory cache
        registered.robot.batteryLevel = newBatteryLevel;
        registered.robot.lastSeen = now;

        if (statusChanged) {
          registered.robot.status = response.data.robotStatus;
          registered.robot.updatedAt = now;
        }

        // Persist battery level and location to database
        await robotRepository.updateHealthCheck(
          registered.robot.id,
          true,
          statusChanged ? response.data.robotStatus : undefined,
          newBatteryLevel,
          locationChanged ? registered.robot.location : undefined
        );

        // Emit event if status, battery, or location changed
        if (statusChanged || batteryChanged || locationChanged) {
          this.emitEvent({
            type: 'robot_status_changed',
            robotId: registered.robot.id,
            robot: registered.robot,
            timestamp: now,
          });
        }

        // Emit reconnection event if was disconnected
        if (!wasConnected) {
          this.emitEvent({
            type: 'robot_status_changed',
            robotId: registered.robot.id,
            robot: registered.robot,
            timestamp: now,
          });
        }
      } catch {
        // Mark as disconnected
        if (registered.isConnected) {
          registered.isConnected = false;
          registered.robot.status = 'offline';
          registered.robot.updatedAt = new Date().toISOString();

          // Persist to database
          await robotRepository.updateHealthCheck(registered.robot.id, false, 'offline');

          this.emitEvent({
            type: 'robot_status_changed',
            robotId: registered.robot.id,
            robot: registered.robot,
            timestamp: new Date().toISOString(),
          });

          console.warn(`[RobotManager] Robot ${registered.robot.id} health check failed`);
        }
      }
    }
  }

  // ============================================================================
  // EVENTS
  // ============================================================================

  /**
   * Subscribe to robot events
   */
  onRobotEvent(callback: RobotEventCallback): () => void {
    this.eventCallbacks.add(callback);
    return () => this.eventCallbacks.delete(callback);
  }

  /**
   * Emit an event to all subscribers
   */
  private emitEvent(event: RobotEvent): void {
    this.eventCallbacks.forEach((cb) => {
      try {
        cb(event);
      } catch (error) {
        console.error('[RobotManager] Event callback error:', error);
      }
    });
  }
}

// Singleton instance
export const robotManager = new RobotManager();
