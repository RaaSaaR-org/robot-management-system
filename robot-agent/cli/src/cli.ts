/**
 * @file cli.ts
 * @description Commander.js program definition with all commands
 */

import { Command } from 'commander';
import { getDefaultUrl } from './utils/config.js';
import { healthCommand } from './commands/health.js';
import { statusCommand } from './commands/status.js';
import { telemetryCommand } from './commands/telemetry.js';
import { historyCommand } from './commands/history.js';
import {
  moveCommand,
  stopCommand,
  emergencyStopCommand,
  pickupCommand,
  dropCommand,
  chargeCommand,
  homeCommand,
} from './commands/control.js';

export const program = new Command()
  .name('roboctl')
  .description('CLI tool for controlling robot agents')
  .version('1.0.0')
  .option('-u, --url <url>', 'Robot agent URL', getDefaultUrl())
  .option('-r, --robot <id>', 'Robot ID (auto-detected if not specified)')
  .option('-f, --format <format>', 'Output format: table|json|minimal', 'table')
  .option('--no-color', 'Disable colored output');

// Add all commands
program.addCommand(healthCommand);
program.addCommand(statusCommand);
program.addCommand(telemetryCommand);
program.addCommand(historyCommand);

// Control commands
program.addCommand(moveCommand);
program.addCommand(stopCommand);
program.addCommand(emergencyStopCommand);
program.addCommand(pickupCommand);
program.addCommand(dropCommand);
program.addCommand(chargeCommand);
program.addCommand(homeCommand);
