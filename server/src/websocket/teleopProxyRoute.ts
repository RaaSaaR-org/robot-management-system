/**
 * @file teleopProxyRoute.ts
 * @description The production wiring of the same-origin teleop socket
 *              (TASK-393): the robot registry, the access-token verifier and
 *              the agent service token. Kept apart from `teleopProxy.ts` so the
 *              proxy itself can be tested without a database.
 * @feature robots
 */

import { robotManager } from '../services/RobotManager.js';
import { authService } from '../services/AuthService.js';
import { agentServiceAuthHeaders } from '../services/agentServiceAuth.js';
import { runAsPlatform } from '../middleware/tenantContext.js';
import { teleoperationService } from '../services/TeleoperationService.js';
import { createTeleopProxy, type UpgradeRoute } from './teleopProxy.js';

/** `/api/robots/:id/teleop/ws` → the robot agent's `/ws/keyboard-teleop`. */
export function teleopProxyRoute(): UpgradeRoute {
  return createTeleopProxy({
    // Outside any request scope, so the lookup runs as the platform and the
    // TENANT check is the proxy's own (`mayObserveTenant`), the same rule the
    // lease routes and the event fan-out apply.
    resolveRobot: async (robotId) => {
      const registered = await runAsPlatform(() => robotManager.getRegisteredRobot(robotId));
      if (!registered) return null;
      return { baseUrl: registered.baseUrl, tenantId: registered.tenantId ?? null };
    },
    verifyAccessToken: (token) => authService.verifyAccessToken(token),
    authDisabled: () => process.env.AUTH_DISABLED === 'true',
    agentHeaders: () => agentServiceAuthHeaders(),
    // TASK-416: a take the recorder aborts on this E-stop leaves REC now, not
    // at the next 1 Hz live poll.
    onEStop: (robotId) => teleoperationService.nudgeLiveAfterEStop(robotId),
  });
}
