/**
 * @file control.ts
 * @description Robot control commands (move, stop, pickup, drop, etc.)
 */

import { Command } from 'commander';
import ora from 'ora';
import { createClient } from '../api/client.js';
import { formatCommand, printError, colors } from '../utils/output.js';
import type { CliOptions, CommandType } from '../api/types.js';
import { describeDestination, parseMoveArgs, type MoveDestination } from './move-args.js';
import { isInFlight, waitForCommand } from './wait-command.js';

// Helper to execute a command
async function executeCommand(
  opts: CliOptions,
  type: CommandType,
  payload?: Record<string, unknown>,
  description?: string
): Promise<void> {
  const spinner = ora(description || `Executing ${type}...`).start();

  try {
    const client = createClient(opts.url, opts.robot);
    let command = await client.sendCommand(type, payload);

    // A sidecar-backed robot walks for real and answers `executing` at once
    // (TASK-336); the answer that matters is how the walk ended.
    if (isInFlight(command)) {
      spinner.text = `${command.result?.message ?? 'Executing'}...`;
      command = await waitForCommand(client, command);
    }

    spinner.stop();
    console.log(formatCommand(command, opts.format));
  } catch (error) {
    spinner.stop();
    printError(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// Move command
export const moveCommand = new Command('move')
  .description('Move robot to a place of its site, or to coordinates')
  .argument('<target...>', 'a place (id, name or type, e.g. "CHARGING-A"), or <x> <y> in metres')
  .option('-p, --place <place>', 'Place the coordinates belong to (label only)')
  .option('--floor <floor>', 'Target floor')
  // A negative coordinate (`move 4.5 -1`) is an argument, not an option.
  .allowUnknownOption()
  .action(async (target: string[], options: { place?: string; floor?: string }) => {
    const opts = moveCommand.optsWithGlobals<CliOptions>();

    let destination: MoveDestination;
    try {
      destination = parseMoveArgs(target, options);
    } catch (error) {
      printError(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }

    // The agent resolves a place against its own place graph and refuses keepouts.
    await executeCommand(opts, 'move', { destination }, `Moving to ${describeDestination(destination)}...`);
  });

// Stop command
export const stopCommand = new Command('stop')
  .description('Stop robot movement')
  .action(async () => {
    const opts = stopCommand.optsWithGlobals<CliOptions>();
    await executeCommand(opts, 'stop', undefined, 'Stopping robot...');
  });

// Emergency stop command
export const emergencyStopCommand = new Command('emergency-stop')
  .alias('estop')
  .description('Emergency stop (immediate halt)')
  .option('-r, --reason <reason>', 'Reason for emergency stop')
  .action(async (options: { reason?: string }) => {
    const opts = emergencyStopCommand.optsWithGlobals<CliOptions>();
    const payload = options.reason ? { reason: options.reason } : undefined;

    console.log(colors.error('! EMERGENCY STOP !'));
    await executeCommand(opts, 'emergency_stop', payload, 'Executing emergency stop...');
  });

// Pickup command
export const pickupCommand = new Command('pickup')
  .description('Pick up an object')
  .argument('<objectId>', 'ID of the object to pick up')
  .action(async (objectId: string) => {
    const opts = pickupCommand.optsWithGlobals<CliOptions>();

    // Validate object ID
    if (!/^[\w\s-]+$/.test(objectId)) {
      printError('Invalid object ID. Only alphanumeric, spaces, hyphens, and underscores allowed.');
      process.exit(1);
    }

    await executeCommand(opts, 'pickup', { objectId }, `Picking up ${objectId}...`);
  });

// Drop command
export const dropCommand = new Command('drop')
  .description('Drop held object')
  .action(async () => {
    const opts = dropCommand.optsWithGlobals<CliOptions>();
    await executeCommand(opts, 'drop', undefined, 'Dropping object...');
  });

// Charge command
export const chargeCommand = new Command('charge')
  .description('Go to charging station')
  .action(async () => {
    const opts = chargeCommand.optsWithGlobals<CliOptions>();
    await executeCommand(opts, 'charge', undefined, 'Navigating to charging station...');
  });

// Home command
export const homeCommand = new Command('home')
  .description('Return to home position')
  .action(async () => {
    const opts = homeCommand.optsWithGlobals<CliOptions>();
    await executeCommand(opts, 'return_home', undefined, 'Returning home...');
  });

// Export all control commands
export const controlCommands = [
  moveCommand,
  stopCommand,
  emergencyStopCommand,
  pickupCommand,
  dropCommand,
  chargeCommand,
  homeCommand,
];
