/**
 * @file control.ts
 * @description Robot control commands (move, stop, pickup, drop, etc.)
 */

import { Command } from 'commander';
import ora from 'ora';
import { createClient } from '../api/client.js';
import { formatCommand, printError, colors } from '../utils/output.js';
import type { CliOptions, CommandType } from '../api/types.js';

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
    const command = await client.sendCommand(type, payload);

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
  .description('Move robot to coordinates')
  .argument('<x>', 'X coordinate', parseFloat)
  .argument('<y>', 'Y coordinate', parseFloat)
  .option('-z, --zone <zone>', 'Target zone name')
  .option('--floor <floor>', 'Target floor')
  .action(async (x: number, y: number, options: { zone?: string; floor?: string }) => {
    const opts = moveCommand.optsWithGlobals<CliOptions>();

    if (isNaN(x) || isNaN(y)) {
      printError('Invalid coordinates. X and Y must be numbers.');
      process.exit(1);
    }

    // Robot-agent expects destination as a RobotLocation object
    const destination: Record<string, unknown> = { x, y };
    if (options.zone) destination.zone = options.zone;
    if (options.floor) destination.floor = options.floor;

    await executeCommand(opts, 'move', { destination }, `Moving to (${x}, ${y})...`);
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
