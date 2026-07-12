/**
 * @file RobotRepository.ts
 * @description Data access layer for Robot entities
 */

import { prisma } from '../database/index.js';
import {
  dbRobotToDomain,
  domainRobotToDb,
  dbEndpointsToDomain,
  domainAgentCardToDb,
} from '../database/types.js';
import type {
  Robot,
  RobotStatus,
  RobotLocation,
  RegisteredRobot,
  RobotEndpoints,
  RobotTelemetry,
} from '../services/RobotManager.js';
import type { A2AAgentCard } from '../types/index.js';

/** Parse a JSON column, returning `fallback` on null/undefined/corrupt data. */
function parseJsonColumn<T>(value: string | null | undefined, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export class RobotRepository {
  /**
   * Find a robot by ID
   */
  async findById(id: string): Promise<Robot | null> {
    const robot = await prisma.robot.findUnique({
      where: { id },
    });
    return robot ? dbRobotToDomain(robot) : null;
  }

  /**
   * Find all robots
   */
  async findAll(): Promise<Robot[]> {
    const robots = await prisma.robot.findMany({
      orderBy: { updatedAt: 'desc' },
    });
    return robots.map(dbRobotToDomain);
  }

  /**
   * Find robots by status
   */
  async findByStatus(status: RobotStatus): Promise<Robot[]> {
    const robots = await prisma.robot.findMany({
      where: { status },
      orderBy: { updatedAt: 'desc' },
    });
    return robots.map(dbRobotToDomain);
  }

  /**
   * Create a new robot
   */
  async create(robot: Robot): Promise<Robot> {
    const data = domainRobotToDb(robot);
    const created = await prisma.robot.create({ data });
    return dbRobotToDomain(created);
  }

  /**
   * Update a robot
   */
  async update(id: string, data: Partial<Robot>): Promise<Robot | null> {
    try {
      const updateData: Record<string, unknown> = {};

      if (data.name !== undefined) updateData.name = data.name;
      if (data.model !== undefined) updateData.model = data.model;
      if (data.serialNumber !== undefined) updateData.serialNumber = data.serialNumber;
      if (data.status !== undefined) updateData.status = data.status;
      if (data.batteryLevel !== undefined) updateData.batteryLevel = data.batteryLevel;
      if (data.location !== undefined) updateData.location = JSON.stringify(data.location);
      if (data.lastSeen !== undefined) updateData.lastSeen = new Date(data.lastSeen);
      if (data.currentTaskId !== undefined) updateData.currentTaskId = data.currentTaskId;
      if (data.currentTaskName !== undefined) updateData.currentTaskName = data.currentTaskName;
      if (data.capabilities !== undefined)
        updateData.capabilities = JSON.stringify(data.capabilities);
      if (data.firmware !== undefined) updateData.firmware = data.firmware;
      if (data.ipAddress !== undefined) updateData.ipAddress = data.ipAddress;
      if (data.metadata !== undefined) updateData.metadata = JSON.stringify(data.metadata);
      if (data.a2aEnabled !== undefined) updateData.a2aEnabled = data.a2aEnabled;
      if (data.a2aAgentUrl !== undefined) updateData.a2aAgentUrl = data.a2aAgentUrl;

      const robot = await prisma.robot.update({
        where: { id },
        data: updateData,
      });
      return dbRobotToDomain(robot);
    } catch {
      return null;
    }
  }

  /**
   * Delete a robot
   */
  async delete(id: string): Promise<boolean> {
    try {
      await prisma.robot.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Update robot status
   */
  async updateStatus(id: string, status: RobotStatus, batteryLevel?: number): Promise<boolean> {
    try {
      await prisma.robot.update({
        where: { id },
        data: {
          status,
          batteryLevel,
          lastSeen: new Date(),
        },
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get a registered robot with all related data
   */
  async getRegisteredRobot(id: string): Promise<RegisteredRobot | null> {
    const robot = await prisma.robot.findUnique({
      where: { id },
      include: {
        endpoints: true,
        agentCard: true,
      },
    });

    if (!robot || !robot.endpoints || !robot.agentCard) {
      return null;
    }

    return {
      robot: dbRobotToDomain(robot),
      endpoints: dbEndpointsToDomain(robot.endpoints),
      agentCard: {
        name: robot.agentCard.name,
        description: robot.agentCard.description,
        url: robot.agentCard.url,
        version: robot.agentCard.version ?? undefined,
        documentationUrl: robot.agentCard.documentationUrl ?? undefined,
        provider: robot.agentCard.provider
          ? JSON.parse(robot.agentCard.provider)
          : undefined,
        capabilities: robot.agentCard.capabilities
          ? JSON.parse(robot.agentCard.capabilities)
          : undefined,
        authentication: robot.agentCard.authentication
          ? JSON.parse(robot.agentCard.authentication)
          : undefined,
        defaultInputModes: JSON.parse(robot.agentCard.defaultInputModes),
        defaultOutputModes: JSON.parse(robot.agentCard.defaultOutputModes),
        skills: JSON.parse(robot.agentCard.skills),
      },
      baseUrl: robot.baseUrl ?? '',
      lastHealthCheck: robot.lastHealthCheck?.toISOString() ?? new Date().toISOString(),
      isConnected: robot.isConnected,
      registeredAt: robot.registeredAt?.toISOString() ?? new Date().toISOString(),
    };
  }

  /**
   * Get all registered robots
   */
  async getAllRegisteredRobots(): Promise<RegisteredRobot[]> {
    const robots = await prisma.robot.findMany({
      where: {
        registeredAt: { not: null },
      },
      include: {
        endpoints: true,
        agentCard: true,
      },
      orderBy: { updatedAt: 'desc' },
    });

    return robots
      .filter((r) => r.endpoints && r.agentCard)
      .map((robot) => ({
        robot: dbRobotToDomain(robot),
        endpoints: dbEndpointsToDomain(robot.endpoints!),
        agentCard: {
          name: robot.agentCard!.name,
          description: robot.agentCard!.description,
          url: robot.agentCard!.url,
          version: robot.agentCard!.version ?? undefined,
          documentationUrl: robot.agentCard!.documentationUrl ?? undefined,
          provider: robot.agentCard!.provider
            ? JSON.parse(robot.agentCard!.provider)
            : undefined,
          capabilities: robot.agentCard!.capabilities
            ? JSON.parse(robot.agentCard!.capabilities)
            : undefined,
          authentication: robot.agentCard!.authentication
            ? JSON.parse(robot.agentCard!.authentication)
            : undefined,
          defaultInputModes: JSON.parse(robot.agentCard!.defaultInputModes),
          defaultOutputModes: JSON.parse(robot.agentCard!.defaultOutputModes),
          skills: JSON.parse(robot.agentCard!.skills),
        },
        baseUrl: robot.baseUrl ?? '',
        lastHealthCheck: robot.lastHealthCheck?.toISOString() ?? new Date().toISOString(),
        isConnected: robot.isConnected,
        registeredAt: robot.registeredAt?.toISOString() ?? new Date().toISOString(),
      }));
  }

  /**
   * Upsert robot with registration data
   */
  async upsertWithRegistration(
    robot: Robot,
    endpoints: RobotEndpoints,
    agentCard: A2AAgentCard,
    baseUrl: string
  ): Promise<Robot> {
    const robotData = domainRobotToDb(robot);
    const agentCardData = domainAgentCardToDb(agentCard, robot.id);

    const result = await prisma.$transaction(async (tx) => {
      // Upsert robot
      const dbRobot = await tx.robot.upsert({
        where: { id: robot.id },
        create: {
          ...robotData,
          registeredAt: new Date(),
          isConnected: true,
          lastHealthCheck: new Date(),
          baseUrl,
        },
        update: {
          ...robotData,
          isConnected: true,
          lastHealthCheck: new Date(),
          baseUrl,
        },
      });

      // Upsert endpoints
      await tx.robotEndpoints.upsert({
        where: { robotId: robot.id },
        create: {
          robotId: robot.id,
          robot: endpoints.robot,
          command: endpoints.command,
          telemetry: endpoints.telemetry,
          telemetryWs: endpoints.telemetryWs,
        },
        update: {
          robot: endpoints.robot,
          command: endpoints.command,
          telemetry: endpoints.telemetry,
          telemetryWs: endpoints.telemetryWs,
        },
      });

      // Upsert agent card
      await tx.agentCard.upsert({
        where: { name: agentCard.name },
        create: agentCardData,
        update: {
          description: agentCardData.description,
          url: agentCardData.url,
          version: agentCardData.version,
          capabilities: agentCardData.capabilities,
          skills: agentCardData.skills,
          robotId: robot.id,
        },
      });

      return dbRobot;
    });

    return dbRobotToDomain(result);
  }

  /**
   * Update health check status
   */
  async updateHealthCheck(
    id: string,
    isConnected: boolean,
    status?: RobotStatus,
    batteryLevel?: number | null,
    location?: RobotLocation
  ): Promise<boolean> {
    try {
      await prisma.robot.update({
        where: { id },
        data: {
          isConnected,
          lastHealthCheck: new Date(),
          lastSeen: new Date(),
          ...(status && { status }),
          ...(batteryLevel !== undefined && { batteryLevel }),
          ...(location && { location: JSON.stringify(location) }),
        },
      });
      return true;
    } catch {
      return false;
    }
  }

  // ==========================================================================
  // TELEMETRY (TASK-184 real-data flow)
  // ==========================================================================

  /**
   * Persist one telemetry frame. JSON-typed fields are serialized to string
   * columns (same pattern as Robot.location/capabilities). Fields missing from
   * old agents are stored as NULL / defaults — never fabricated.
   */
  async saveTelemetry(telemetry: RobotTelemetry): Promise<void> {
    const timestamp = new Date(telemetry.timestamp);
    await prisma.robotTelemetry.create({
      data: {
        robotId: telemetry.robotId,
        batteryLevel:
          telemetry.batteryLevel === null || telemetry.batteryLevel === undefined
            ? null
            : Math.round(telemetry.batteryLevel),
        batteryVoltage: telemetry.batteryVoltage ?? null,
        batteryTemperature: telemetry.batteryTemperature ?? null,
        cpuUsage: telemetry.cpuUsage ?? 0,
        memoryUsage: telemetry.memoryUsage ?? 0,
        diskUsage: telemetry.diskUsage ?? null,
        temperature: telemetry.temperature ?? 0,
        humidity: telemetry.humidity ?? null,
        speed: telemetry.speed ?? null,
        sensors: JSON.stringify(telemetry.sensors ?? {}),
        errors: JSON.stringify(telemetry.errors ?? []),
        warnings: JSON.stringify(telemetry.warnings ?? []),
        jointStates: telemetry.jointStates ? JSON.stringify(telemetry.jointStates) : null,
        imu: telemetry.imu ? JSON.stringify(telemetry.imu) : null,
        touch: telemetry.touch ? JSON.stringify(telemetry.touch) : null,
        battery: telemetry.battery ? JSON.stringify(telemetry.battery) : null,
        motorTemperatures: telemetry.motorTemperatures
          ? JSON.stringify(telemetry.motorTemperatures)
          : null,
        odometry: telemetry.odometry ? JSON.stringify(telemetry.odometry) : null,
        hardwareConnected: telemetry.hardwareConnected ?? false,
        simulated: JSON.stringify(telemetry.simulated ?? []),
        timestamp: Number.isNaN(timestamp.getTime()) ? new Date() : timestamp,
      },
    });
  }

  /**
   * Query persisted telemetry for a robot, ascending by timestamp, JSON
   * columns parsed back into RobotTelemetry-shaped objects.
   */
  async getTelemetryHistory(
    robotId: string,
    options: { from?: Date; to?: Date; limit: number }
  ): Promise<RobotTelemetry[]> {
    const rows = await prisma.robotTelemetry.findMany({
      where: {
        robotId,
        ...(options.from || options.to
          ? {
              timestamp: {
                ...(options.from && { gte: options.from }),
                ...(options.to && { lte: options.to }),
              },
            }
          : {}),
      },
      orderBy: { timestamp: 'asc' },
      take: options.limit,
    });

    return rows.map((row) => ({
      robotId: row.robotId,
      batteryLevel: row.batteryLevel,
      batteryVoltage: row.batteryVoltage ?? undefined,
      batteryTemperature: row.batteryTemperature ?? undefined,
      cpuUsage: row.cpuUsage,
      memoryUsage: row.memoryUsage,
      diskUsage: row.diskUsage ?? undefined,
      temperature: row.temperature,
      humidity: row.humidity ?? undefined,
      speed: row.speed ?? undefined,
      sensors: parseJsonColumn(row.sensors, {}),
      errors: parseJsonColumn(row.errors, []),
      warnings: parseJsonColumn(row.warnings, []),
      jointStates: row.jointStates ? parseJsonColumn(row.jointStates, undefined) : undefined,
      imu: row.imu ? parseJsonColumn(row.imu, undefined) : undefined,
      touch: row.touch ? parseJsonColumn(row.touch, undefined) : undefined,
      battery: row.battery ? parseJsonColumn(row.battery, undefined) : undefined,
      motorTemperatures: row.motorTemperatures
        ? parseJsonColumn(row.motorTemperatures, undefined)
        : undefined,
      odometry: row.odometry ? parseJsonColumn(row.odometry, undefined) : undefined,
      hardwareConnected: row.hardwareConnected,
      simulated: parseJsonColumn(row.simulated, []),
      timestamp: row.timestamp.toISOString(),
    }));
  }

  /**
   * Delete telemetry rows older than the given cutoff (retention cleanup).
   * Returns the number of deleted rows.
   */
  async deleteTelemetryBefore(cutoff: Date): Promise<number> {
    const result = await prisma.robotTelemetry.deleteMany({
      where: { timestamp: { lt: cutoff } },
    });
    return result.count;
  }
}

export const robotRepository = new RobotRepository();
