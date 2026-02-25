/**
 * @file helpers.ts
 * @description Test utilities for server tests
 */

import type { Express } from 'express';
import request from 'supertest';

/**
 * Create an authenticated request builder (AUTH_DISABLED=true in test setup)
 */
export function authRequest(app: Express) {
  return {
    get: (url: string) => request(app).get(url),
    post: (url: string) => request(app).post(url).set('Content-Type', 'application/json'),
    put: (url: string) => request(app).put(url).set('Content-Type', 'application/json'),
    delete: (url: string) => request(app).delete(url),
    patch: (url: string) => request(app).patch(url).set('Content-Type', 'application/json'),
  };
}

/**
 * Mock robot data for testing
 */
export const mockRobot = {
  id: 'test-robot-001',
  name: 'Test Robot',
  model: 'TestBot v1',
  status: 'idle',
  batteryLevel: 85,
  location: JSON.stringify({ x: 10, y: 20, floor: '1' }),
  capabilities: JSON.stringify(['navigation', 'manipulation']),
  lastSeen: new Date(),
  currentTaskId: null,
  metadata: null,
  tenantId: 'test-tenant',
  registeredAt: new Date(),
};
