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
import {
  expectedRobotMetadata,
  isExpectedRobotRow,
  metadataWithoutProvisioning,
  type ExpectedRobotInput,
} from '../services/expectedRobot.js';

/** What `putExpected` did: wrote the row, or found it is not an expected robot. */
export type PutExpectedResult =
  | { robot: Robot; created: boolean }
  | { conflict: true };

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
   * Whether a robot row exists for the caller, and whose it is — without
   * requiring the endpoints and agent card a registered robot has.
   */
  async findTenantOf(id: string): Promise<{ tenantId: string | null } | null> {
    const row = await prisma.robot.findUnique({ where: { id }, select: { tenantId: true } });
    return row ? { tenantId: row.tenantId ?? null } : null;
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
   * TASK-327: bind a robot to a site (digital twin), or unbind it with `null`.
   * Tenant-scoped like every read here: a robot of another tenant is invisible,
   * so the result is `null` (not found) rather than a cross-tenant write.
   */
  async setTwin(id: string, twinId: string | null): Promise<Robot | null> {
    const existing = await prisma.robot.findUnique({ where: { id }, select: { id: true, twinId: true } });
    if (!existing) return null;
    const robot = await prisma.robot.update({ where: { id }, data: { twinId } });
    // TASK-341: a frame registration is measured against ONE twin; a new site
    // (or none) leaves it describing a frame the robot is no longer in.
    if (existing.twinId !== twinId) {
      await prisma.robotFrameRegistration.deleteMany({ where: { robotId: id } });
    }
    return dbRobotToDomain(robot);
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
      tenantId: robot.tenantId ?? null,
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
        tenantId: robot.tenantId ?? null,
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
      // A row no agent ever registered (an expected robot, TASK-477, or a
      // seeded one) is being claimed: stamp `registeredAt`, or the next server
      // start — which loads `registeredAt != null` only — would not health-check
      // this robot again. It also stops being "expected": when the agent sends
      // no metadata of its own, the provisioning keys come off what is stored.
      const prior = await tx.robot.findUnique({
        where: { id: robot.id },
        select: { registeredAt: true, metadata: true },
      });
      const claim =
        prior && prior.registeredAt === null
          ? {
              registeredAt: new Date(),
              ...(robotData.metadata === undefined
                ? { metadata: metadataWithoutProvisioning(prior.metadata) }
                : {}),
            }
          : {};

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
          ...claim,
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
   * Create or update an expected robot (TASK-477) — a row with no agent.
   *
   * Idempotent: the same input twice leaves one row. Only a row that is still
   * an expected robot is ever updated; a robot an agent has registered, or any
   * other row under this id, answers `conflict` untouched. The read is
   * tenant-scoped like every read here, so another tenant's robot under the
   * same id is invisible, its create fails on the primary key, and that is a
   * conflict too.
   */
  async putExpected(input: ExpectedRobotInput): Promise<PutExpectedResult> {
    const fields = {
      name: input.name,
      model: input.model,
      serialNumber: input.serialNumber ?? null,
      capabilities: JSON.stringify(input.capabilities),
      metadata: JSON.stringify(expectedRobotMetadata(input)),
    };

    let existing = await prisma.robot.findUnique({ where: { id: input.id } });
    if (!existing) {
      try {
        const created = await prisma.robot.create({
          data: {
            id: input.id,
            ...fields,
            status: 'offline',
            // Unknown, not "AC": nothing has reported a battery yet.
            batteryLevel: null,
            // A parseable pose (the column default `{}` is not one). It is in
            // no place and not site-aligned, so no map draws it.
            location: JSON.stringify({ x: 0, y: 0 }),
            a2aEnabled: false,
            isConnected: false,
          },
        });
        return { robot: dbRobotToDomain(created), created: true };
      } catch (error) {
        if ((error as { code?: unknown } | null)?.code !== 'P2002') throw error;
        // Lost a race with another writer of this id: judge the row that won.
        existing = await prisma.robot.findUnique({ where: { id: input.id } });
        if (!existing) return { conflict: true };
      }
    }

    if (!isExpectedRobotRow(existing)) return { conflict: true };

    // `updateMany` repeats the "still unregistered" test in the WHERE clause,
    // so an agent registering between the read and this write keeps its row.
    const { count } = await prisma.robot.updateMany({
      where: { id: input.id, registeredAt: null, baseUrl: null },
      data: fields,
    });
    if (count === 0) return { conflict: true };
    const updated = await prisma.robot.findUnique({ where: { id: input.id } });
    return updated ? { robot: dbRobotToDomain(updated), created: false } : { conflict: true };
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
   * With `newest: true` the NEWEST `limit` rows in the window are returned
   * (still ascending) instead of the oldest — used when the caller gave no
   * explicit `from`, so naive consumers see recent data, not week-old rows.
   */
  async getTelemetryHistory(
    robotId: string,
    options: { from?: Date; to?: Date; limit: number; newest?: boolean }
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
      orderBy: { timestamp: options.newest ? 'desc' : 'asc' },
      take: options.limit,
    });

    if (options.newest) {
      rows.reverse(); // back to ascending for a consistent response contract
    }

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
