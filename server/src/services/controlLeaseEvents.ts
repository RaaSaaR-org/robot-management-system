/**
 * @file controlLeaseEvents.ts
 * @description The in-process bus for control-lease holder transitions
 *              (TASK-318): `ControlLeaseService` publishes, the WebSocket
 *              server fans out to observers of the robot's tenant.
 * @feature robots
 *
 * Kept in its own module, free of Prisma and HTTP, so the WebSocket server can
 * subscribe without loading the lease service.
 */

import { EventEmitter } from 'node:events';
import type { ControlLeaseTransition } from './ControlLeaseService.js';

const bus = new EventEmitter();
// Every WS server instance subscribes once; tests add more.
bus.setMaxListeners(50);

/** Publish one transition. Listener errors never reach the lease service. */
export function publishControlLeaseTransition(transition: ControlLeaseTransition): void {
  bus.emit('transition', transition);
}

/** Subscribe to every transition; returns the unsubscribe function. */
export function onControlLeaseTransition(listener: (transition: ControlLeaseTransition) => void): () => void {
  const safe = (transition: ControlLeaseTransition): void => {
    try {
      listener(transition);
    } catch {
      console.error('[controlLeaseEvents] a listener failed');
    }
  };
  bus.on('transition', safe);
  return () => {
    bus.off('transition', safe);
  };
}
