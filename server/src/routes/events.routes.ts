/**
 * @file events.routes.ts
 * @description Routes for A2A event retrieval (POST /api/a2a/events/get)
 */

import { Router, type Request, type Response } from 'express';
import { conversationManager } from '../services/ConversationManager.js';

export const eventsRoutes = Router();

/**
 * POST /get - Get A2A events
 * Optional body: { since?: number (ms timestamp), actor?: string }
 * Response: { events: A2AEvent[] }
 */
eventsRoutes.post('/get', async (req: Request, res: Response) => {
  try {
    const { since, actor } = (req.body ?? {}) as { since?: number; actor?: string };

    let events =
      typeof since === 'number'
        ? await conversationManager.getEventsSince(since)
        : await conversationManager.getEvents();

    if (actor) {
      events = events.filter((event) => event.actor === actor);
    }

    res.json({ events });
  } catch (error) {
    console.error('Error getting events:', error);
    const message = error instanceof Error ? error.message : 'Failed to get events';
    res.status(500).json({ error: message });
  }
});
