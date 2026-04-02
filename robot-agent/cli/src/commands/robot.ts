/**
 * @file robot.ts
 * @description Robot profile management commands (add, list, show, remove)
 */

import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import {
  getRobot,
  setRobot,
  listRobots,
  removeRobot,
  type RobotProfile,
} from '../utils/registry.js';
import { colors } from '../utils/output.js';

// ============================================================================
// PARENT COMMAND
// ============================================================================

export const robotCommand = new Command('robot')
  .description('Manage robot profiles for lerobot commands');

// ============================================================================
// ADD
// ============================================================================

robotCommand
  .command('add <name>')
  .description('Add or update a robot profile')
  .requiredOption('--type <type>', 'Robot type (e.g. so101_follower)')
  .requiredOption('--port <port>', 'Serial port (e.g. /dev/ttyACM0)')
  .option('--id <id>', 'Robot ID (defaults to name)')
  .option('--calibration-dir <dir>', 'Calibration directory')
  .option('--teleop-type <type>', 'Teleop leader type (e.g. so101_leader)')
  .option('--teleop-port <port>', 'Teleop leader serial port')
  .option('--teleop-id <id>', 'Teleop leader ID')
  .action((name: string, opts) => {
    const existing = getRobot(name);

    const profile: RobotProfile = {
      name,
      type: opts.type,
      port: opts.port,
      id: opts.id || name,
      calibrationDir: opts.calibrationDir,
      ...(existing?.cameras && { cameras: existing.cameras }),
    };

    if (opts.teleopType && opts.teleopPort) {
      profile.teleop = {
        type: opts.teleopType,
        port: opts.teleopPort,
        id: opts.teleopId,
      };
    } else if (existing?.teleop) {
      profile.teleop = existing.teleop;
    }

    setRobot(name, profile);
    const verb = existing ? 'Updated' : 'Added';
    console.log(colors.success(`${verb} robot profile: ${chalk.bold(name)}`));
    printProfile(profile);
  });

// ============================================================================
// LIST
// ============================================================================

robotCommand
  .command('list')
  .description('List all robot profiles')
  .action(() => {
    const robots = listRobots();
    const names = Object.keys(robots);

    if (names.length === 0) {
      console.log(colors.muted('No robot profiles configured.'));
      console.log(colors.muted('Add one with: roboctl robot add <name> --type <type> --port <port>'));
      return;
    }

    const table = new Table({
      head: ['Name', 'Type', 'Port', 'ID', 'Teleop'],
      style: { head: ['cyan'] },
    });

    for (const name of names) {
      const r = robots[name];
      table.push([
        chalk.bold(r.name),
        r.type,
        r.port,
        r.id,
        r.teleop ? `${r.teleop.type} @ ${r.teleop.port}` : colors.muted('—'),
      ]);
    }

    console.log(table.toString());
  });

// ============================================================================
// SHOW
// ============================================================================

robotCommand
  .command('show <name>')
  .description('Show details of a robot profile')
  .action((name: string) => {
    const profile = getRobot(name);
    if (!profile) {
      printNotFound(name);
      process.exit(1);
    }
    printProfile(profile);
  });

// ============================================================================
// REMOVE
// ============================================================================

robotCommand
  .command('remove <name>')
  .description('Remove a robot profile')
  .action((name: string) => {
    if (removeRobot(name)) {
      console.log(colors.success(`Removed robot profile: ${chalk.bold(name)}`));
    } else {
      printNotFound(name);
      process.exit(1);
    }
  });

// ============================================================================
// HELPERS
// ============================================================================

function printProfile(profile: RobotProfile): void {
  console.log(`  ${colors.muted('Type:')}   ${profile.type}`);
  console.log(`  ${colors.muted('Port:')}   ${profile.port}`);
  console.log(`  ${colors.muted('ID:')}     ${profile.id}`);
  if (profile.calibrationDir) {
    console.log(`  ${colors.muted('CalDir:')} ${profile.calibrationDir}`);
  }
  if (profile.teleop) {
    console.log(`  ${colors.muted('Teleop:')} ${profile.teleop.type} @ ${profile.teleop.port}${profile.teleop.id ? ` (${profile.teleop.id})` : ''}`);
  }
  if (profile.cameras && profile.cameras.length > 0) {
    for (const cam of profile.cameras) {
      console.log(`  ${colors.muted('Camera:')} ${cam.name} (${cam.type}:${cam.index})`);
    }
  }
}

function printNotFound(name: string): void {
  console.error(colors.error(`Robot profile '${name}' not found.`));
  const robots = listRobots();
  const names = Object.keys(robots);
  if (names.length > 0) {
    console.error(colors.muted(`Available: ${names.join(', ')}`));
  } else {
    console.error(colors.muted('No profiles configured. Add one with: roboctl robot add <name> --type <type> --port <port>'));
  }
}
