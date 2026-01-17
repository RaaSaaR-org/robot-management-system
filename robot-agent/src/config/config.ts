/**
 * @file config.ts
 * @description Environment configuration and validation
 */

import type { RobotType } from '../robot/types.js';

export type RobotClass = 'lightweight' | 'heavy-duty' | 'standard';

export interface Config {
  port: number;
  robotId: string;
  robotName: string;
  robotModel: string;
  robotClass: RobotClass;
  robotType: RobotType;
  maxPayloadKg: number;
  robotDescription: string;
  geminiApiKey: string;
  initialLocation: {
    x: number;
    y: number;
    floor: string;
    zone: string;
  };
  /** Zone cache time-to-live in milliseconds */
  zoneCacheTtlMs: number;
  /** Server URL for API calls */
  serverUrl: string;
  /** VLA inference configuration */
  vla: {
    /** VLA inference server hostname */
    host: string;
    /** VLA inference server port */
    port: number;
    /** Connection pool size for parallel requests */
    poolSize: number;
    /** Health check interval in milliseconds */
    healthCheckIntervalMs: number;
    /** Request timeout in milliseconds */
    timeoutMs: number;
    /** Optional REST fallback URL for degraded mode */
    restFallbackUrl: string | undefined;
    /** Whether VLA inference is enabled */
    enabled: boolean;
  };
}

export const config: Config = {
  port: parseInt(process.env.PORT || '41243', 10),
  robotId: process.env.ROBOT_ID || 'sim-robot-001',
  robotName: process.env.ROBOT_NAME || 'SimBot-01',
  robotModel: process.env.ROBOT_MODEL || 'SimBot H1',
  robotClass: (process.env.ROBOT_CLASS as RobotClass) || 'standard',
  robotType: (process.env.ROBOT_TYPE as RobotType) || 'h1',
  maxPayloadKg: parseFloat(process.env.MAX_PAYLOAD_KG || '10'),
  robotDescription: process.env.ROBOT_DESCRIPTION || 'A versatile humanoid robot for general tasks',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  initialLocation: {
    x: parseFloat(process.env.INITIAL_X || '10.0'),
    y: parseFloat(process.env.INITIAL_Y || '10.0'),
    floor: process.env.INITIAL_FLOOR || '1',
    zone: process.env.INITIAL_ZONE || 'Warehouse A',
  },
  zoneCacheTtlMs: parseInt(process.env.ZONE_CACHE_TTL_MS || '60000', 10), // 1 minute default
  serverUrl: process.env.SERVER_URL || 'http://localhost:3001',
  vla: {
    host: process.env.VLA_INFERENCE_HOST || 'localhost',
    port: parseInt(process.env.VLA_INFERENCE_PORT || '50051', 10),
    poolSize: parseInt(process.env.VLA_CONNECTION_POOL_SIZE || '4', 10),
    healthCheckIntervalMs: parseInt(process.env.VLA_HEALTH_CHECK_INTERVAL_MS || '5000', 10),
    timeoutMs: parseInt(process.env.VLA_TIMEOUT_MS || '5000', 10),
    restFallbackUrl: process.env.VLA_REST_FALLBACK_URL || undefined,
    enabled: process.env.VLA_ENABLED === 'true',
  },
};

export function validateConfig(): void {
  if (!config.geminiApiKey) {
    console.warn('[Config] Warning: GEMINI_API_KEY not set. AI features will be limited.');
  }

  if (!config.robotId) {
    throw new Error('[Config] ROBOT_ID is required');
  }

  console.log('[Config] Loaded configuration:');
  console.log(`  - Port: ${config.port}`);
  console.log(`  - Robot ID: ${config.robotId}`);
  console.log(`  - Robot Name: ${config.robotName}`);
  console.log(`  - Robot Class: ${config.robotClass}`);
  console.log(`  - Robot Type: ${config.robotType}`);
  console.log(`  - Max Payload: ${config.maxPayloadKg}kg`);
  console.log(`  - Initial Location: (${config.initialLocation.x}, ${config.initialLocation.y}) in ${config.initialLocation.zone}`);
  console.log(`  - VLA Inference: ${config.vla.enabled ? 'enabled' : 'disabled'}`);
  if (config.vla.enabled) {
    console.log(`    - Host: ${config.vla.host}:${config.vla.port}`);
    console.log(`    - Pool Size: ${config.vla.poolSize}`);
    console.log(`    - Health Check Interval: ${config.vla.healthCheckIntervalMs}ms`);
  }
}
