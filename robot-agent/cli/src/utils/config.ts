/**
 * @file config.ts
 * @description Persistent CLI configuration
 */

import Conf from 'conf';
import type { OutputFormat } from '../api/types.js';

interface CliConfig {
  defaultUrl: string;
  defaultRobotId?: string;
  outputFormat: OutputFormat;
  colorEnabled: boolean;
}

const config = new Conf<CliConfig>({
  projectName: 'roboctl',
  defaults: {
    defaultUrl: 'http://localhost:41243',
    outputFormat: 'table',
    colorEnabled: true,
  },
});

export function getConfig(): CliConfig {
  return {
    defaultUrl: config.get('defaultUrl'),
    defaultRobotId: config.get('defaultRobotId'),
    outputFormat: config.get('outputFormat'),
    colorEnabled: config.get('colorEnabled'),
  };
}

export function setConfig<K extends keyof CliConfig>(key: K, value: CliConfig[K]): void {
  config.set(key, value);
}

export function getDefaultUrl(): string {
  return config.get('defaultUrl');
}

export function setDefaultUrl(url: string): void {
  config.set('defaultUrl', url);
}

export function getDefaultRobotId(): string | undefined {
  return config.get('defaultRobotId');
}

export function setDefaultRobotId(robotId: string): void {
  config.set('defaultRobotId', robotId);
}
