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
  RegisteredRobot,
  RobotEndpoints,
} from '../services/RobotManager.js';
import type { A2AAgentCard } from '../types/index.js';

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
    batteryLevel?: number
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
        },
      });
      return true;
    } catch {
      return false;
    }
  }
}

export const robotRepository = new RobotRepository();
