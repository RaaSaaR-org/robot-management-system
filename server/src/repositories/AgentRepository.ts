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
