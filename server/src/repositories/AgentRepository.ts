/**
 * @file AgentRepository.ts
 * @description Data access layer for AgentCard entities
 */

import { prisma } from '../database/index.js';
import { dbAgentCardToDomain, domainAgentCardToDb } from '../database/types.js';
import type { A2AAgentCard } from '../types/index.js';

export class AgentRepository {
  /**
   * Find an agent by name
   */
  async findByName(name: string): Promise<A2AAgentCard | null> {
    const agent = await prisma.agentCard.findUnique({
      where: { name },
    });
    return agent ? dbAgentCardToDomain(agent) : null;
  }

  /**
   * Find an agent by robot ID
   */
  async findByRobotId(robotId: string): Promise<A2AAgentCard | null> {
    const agent = await prisma.agentCard.findUnique({
      where: { robotId },
    });
    return agent ? dbAgentCardToDomain(agent) : null;
  }

  /**
   * Find all agents
   */
  async findAll(): Promise<A2AAgentCard[]> {
    const agents = await prisma.agentCard.findMany({
      orderBy: { name: 'asc' },
    });
    return agents.map(dbAgentCardToDomain);
  }

  /**
   * Upsert an agent card
   */
  async upsert(card: A2AAgentCard, robotId?: string): Promise<A2AAgentCard> {
    const data = domainAgentCardToDb(card, robotId);

    const agent = await prisma.agentCard.upsert({
      where: { name: card.name },
      create: data,
      update: {
        description: data.description,
        url: data.url,
        version: data.version,
        documentationUrl: data.documentationUrl,
        provider: data.provider,
        capabilities: data.capabilities,
        authentication: data.authentication,
        defaultInputModes: data.defaultInputModes,
        defaultOutputModes: data.defaultOutputModes,
        skills: data.skills,
        robotId: data.robotId,
      },
    });
    return dbAgentCardToDomain(agent);
  }

  /**
   * Upsert an agent card keyed on the ROBOT, not on the card's name.
   *
   * Use this whenever the agent may have renamed itself: `upsert()` is keyed on
   * `name`, so a renamed agent creates a SECOND row instead of updating its
   * own, and the callers used to paper over that with a delete-then-upsert that
   * destroyed the row (and its uuid) before the write that was supposed to
   * replace it. `robotId` is unique in the schema, so a rename is an in-place
   * UPDATE of the name column here — nothing is deleted, and a failure leaves
   * the old row intact instead of leaving the robot with no card at all.
   */
  async upsertByRobotId(card: A2AAgentCard, robotId: string): Promise<A2AAgentCard> {
    const data = domainAgentCardToDb(card, robotId);

    const agent = await prisma.agentCard.upsert({
      where: { robotId },
      create: data,
      update: {
        name: data.name,
        description: data.description,
        url: data.url,
        version: data.version,
        documentationUrl: data.documentationUrl,
        provider: data.provider,
        capabilities: data.capabilities,
        authentication: data.authentication,
        defaultInputModes: data.defaultInputModes,
        defaultOutputModes: data.defaultOutputModes,
        skills: data.skills,
      },
    });
    return dbAgentCardToDomain(agent);
  }

  /**
   * Delete an agent by name
   */
  async delete(name: string): Promise<boolean> {
    try {
      await prisma.agentCard.delete({ where: { name } });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Delete an agent by robot ID
   */
  async deleteByRobotId(robotId: string): Promise<boolean> {
    try {
      await prisma.agentCard.delete({ where: { robotId } });
      return true;
    } catch {
      return false;
    }
  }
}

export const agentRepository = new AgentRepository();
