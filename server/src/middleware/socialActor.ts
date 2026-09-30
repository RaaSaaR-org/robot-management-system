/**
 * @file socialActor.ts
 * @description Resolve who is speaking on the social layer (TASK-241) — a
 *   user, an agent or the system — from the authenticated request.
 * @feature social
 *
 * - A human JWT yields a `user` actor. `X-Agent-Name` is ignored: a person
 *   cannot speak as an agent by setting a header.
 * - A service-account token (`ndsa_…`) is a machine credential and must name
 *   the agent it speaks for in `X-Agent-Name`, resolved against
 *   `AgentCard.name`. Without it, or with an unknown name, the request is
 *   refused rather than attributed to a guess.
 * - The AUTH_DISABLED dev bypass yields a `system` actor rather than inventing
 *   a user. It may still name an agent through `X-Agent-Name`, so the agent
 *   path can be exercised locally.
 */

import type { Response, NextFunction } from 'express';
import type { AuthenticatedRequest } from './auth.middleware.js';
import { socialRepository } from '../repositories/SocialRepository.js';
import type { Actor } from '../types/social.types.js';

export const AGENT_NAME_HEADER = 'x-agent-name';

/** The dev-mode actor used when auth is disabled. */
export const DEV_SYSTEM_ACTOR: Actor = {
  actorType: 'system',
  actorId: 'dev',
  displayName: 'Dev (auth disabled)',
};

export interface SocialRequest extends AuthenticatedRequest {
  actor?: Actor;
}

function refuse(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: message, message, code });
}

export async function resolveSocialActor(
  req: SocialRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const user = req.user;
  if (!user) {
    refuse(res, 401, 'SOCIAL_NO_ACTOR', 'Authentication required');
    return;
  }

  const headerValue = req.headers[AGENT_NAME_HEADER];
  const agentName = typeof headerValue === 'string' ? headerValue.trim() : '';
  const devBypass = user.authType === undefined && process.env.AUTH_DISABLED === 'true';
  const mayActAsAgent = user.authType === 'service' || devBypass;

  try {
    if (mayActAsAgent && agentName) {
      const card = await socialRepository.findAgentCard(agentName);
      if (!card) {
        refuse(res, 403, 'SOCIAL_AGENT_UNKNOWN', `No registered agent named '${agentName}'`);
        return;
      }
      req.actor = { actorType: 'agent', actorId: card.name, displayName: card.name };
      return next();
    }
  } catch (error) {
    next(error);
    return;
  }

  if (user.authType === 'service') {
    refuse(
      res,
      400,
      'SOCIAL_AGENT_NAME_REQUIRED',
      'A service credential must name the agent it speaks for in the X-Agent-Name header'
    );
    return;
  }

  if (devBypass) {
    req.actor = DEV_SYSTEM_ACTOR;
    return next();
  }

  req.actor = {
    actorType: 'user',
    actorId: user.id,
    displayName: user.name || user.email || user.id,
  };
  next();
}
