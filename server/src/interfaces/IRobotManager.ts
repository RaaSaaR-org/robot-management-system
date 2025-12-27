/**
 * @file IRobotManager.ts
 * @description Interface for robot management service
 * @feature robots
 */

import type {
  Robot,
  RobotTelemetry,
  RobotCommand,
  RobotCommandRequest,
  RegisteredRobot,
  RobotEvent,
} from '../services/RobotManager.js';
import type { A2AAgentCard } from '../types/index.js';

/**
 * Callback type for robot events
 */
export type RobotEventCallback = (event: RobotEvent) => void;

/**
 * Interface for robot management operations
 * Enables dependency injection and testing
 */
export interface IRobotManager {
  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  /**
   * Initialize the manager and load robots from database
   */
  initialize(): Promise<void>;

  // ============================================================================
  // REGISTRATION
  // ============================================================================

  /**
   * Register a robot from its base URL
   * @param robotUrl - The robot agent's base URL
   * @returns The registered robot with full metadata
   */
  registerRobot(robotUrl: string): Promise<RegisteredRobot>;

  /**
   * Unregister a robot by ID
   * @param robotId - The robot's unique identifier
   * @returns True if successfully unregistered
   */
  unregisterRobot(robotId: string): Promise<boolean>;

  // ============================================================================
  // ROBOT ACCESS
  // ============================================================================

  /**
   * List all registered robots
   */
  listRobots(): Promise<Robot[]>;

  /**
   * Get a single robot by ID
   * @param robotId - The robot's unique identifier
   */
  getRobot(robotId: string): Promise<Robot | undefined>;

  /**
   * Get full registered robot data including endpoints and agent card
   * @param robotId - The robot's unique identifier
   */
  getRegisteredRobot(robotId: string): Promise<RegisteredRobot | undefined>;

  /**
   * Get agent cards for connected robots only
   * Used by orchestrator to route messages only to online robots
   */
  getConnectedAgents(): A2AAgentCard[];

  // ============================================================================
  // ROBOT COMMANDS
  // ============================================================================

  /**
   * Send a command to a robot
   * @param robotId - The robot's unique identifier
   * @param command - The command to send
   */
  sendCommand(robotId: string, command: RobotCommandRequest): Promise<RobotCommand>;

  // ============================================================================
  // TELEMETRY
  // ============================================================================

  /**
   * Get current telemetry from a robot
   * @param robotId - The robot's unique identifier
   */
  getTelemetry(robotId: string): Promise<RobotTelemetry>;

  // ============================================================================
  // HEALTH CHECKS
  // ============================================================================

  /**
   * Start periodic health checks for all robots
   * @param intervalMs - Check interval in milliseconds (default: 30000)
   */
  startHealthChecks(intervalMs?: number): void;

  /**
   * Stop health checks
   */
  stopHealthChecks(): void;

  // ============================================================================
  // EVENTS
  // ============================================================================

  /**
   * Subscribe to robot events
   * @param callback - Event handler function
   * @returns Unsubscribe function
   */
  onRobotEvent(callback: RobotEventCallback): () => void;
}
