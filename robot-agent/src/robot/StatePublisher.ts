/**
 * @file StatePublisher.ts
 * @description Observer pattern implementation for robot state changes
 * @feature robot
 */

import type { SimulatedRobotState } from './types.js';

/**
 * Listener callback type for state changes
 */
export type StateListener = (state: SimulatedRobotState) => void;

/**
 * Manages subscriptions and notifications for robot state changes
 */
export class StatePublisher {
  private listeners: Set<StateListener> = new Set();

  /**
   * Subscribe to state changes
   * @param listener - Callback function to receive state updates
   * @returns Unsubscribe function
   */
  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Notify all listeners of a state change
   * @param state - The current state to broadcast
   */
  notify(state: SimulatedRobotState): void {
    const stateCopy = { ...state };
    for (const listener of this.listeners) {
      try {
        listener(stateCopy);
      } catch (error) {
        console.error('[StatePublisher] Listener error:', error);
      }
    }
  }

  /**
   * Get the number of active subscribers
   */
  get subscriberCount(): number {
    return this.listeners.size;
  }

  /**
   * Remove all listeners
   */
  clear(): void {
    this.listeners.clear();
  }
}
