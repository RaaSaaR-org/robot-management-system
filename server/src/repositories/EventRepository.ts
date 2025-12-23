/**
 * @file EventRepository.ts
 * @description Data access layer for Event entities
 */

import { prisma } from '../database/index.js';
import { dbEventToDomain, domainEventToDb } from '../database/types.js';
import type { A2AEvent } from '../types/index.js';

const MAX_EVENTS = 1000;

export class EventRepository {
  /**
   * Create a new event
   */
  async create(event: A2AEvent): Promise<void> {
    const data = domainEventToDb(event);

    await prisma.event.create({ data });

    // Prune old events asynchronously
    this.pruneOldEvents().catch((err) =>
      console.error('[EventRepository] Error pruning events:', err)
    );
  }

  /**
   * Find all events (up to MAX_EVENTS)
   */
  async findAll(): Promise<A2AEvent[]> {
    const events = await prisma.event.findMany({
      orderBy: { timestamp: 'asc' },
      take: MAX_EVENTS,
    });
    return events.map(dbEventToDomain);
  }

  /**
   * Find events since a given timestamp
   */
  async findSince(timestamp: number): Promise<A2AEvent[]> {
    const events = await prisma.event.findMany({
      where: {
        timestamp: { gt: new Date(timestamp) },
      },
      orderBy: { timestamp: 'asc' },
    });
    return events.map(dbEventToDomain);
  }

  /**
   * Find events by actor
   */
  async findByActor(actor: string): Promise<A2AEvent[]> {
    const events = await prisma.event.findMany({
      where: { actor },
      orderBy: { timestamp: 'asc' },
    });
    return events.map(dbEventToDomain);
  }

  /**
   * Get the count of events
   */
  async count(): Promise<number> {
    return prisma.event.count();
  }

  /**
   * Prune old events to keep only the last MAX_EVENTS
   */
  private async pruneOldEvents(): Promise<void> {
    const count = await prisma.event.count();
    if (count > MAX_EVENTS) {
      const toDelete = count - MAX_EVENTS;
      const oldestEvents = await prisma.event.findMany({
        orderBy: { timestamp: 'asc' },
        take: toDelete,
        select: { id: true },
      });
      await prisma.event.deleteMany({
        where: { id: { in: oldestEvents.map((e) => e.id) } },
      });
    }
  }

  /**
   * Clear all events
   */
  async clear(): Promise<void> {
    await prisma.event.deleteMany();
  }
}

export const eventRepository = new EventRepository();
