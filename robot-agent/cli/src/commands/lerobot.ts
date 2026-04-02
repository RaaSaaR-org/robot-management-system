/**
 * @file lerobot.ts
 * @description Wrapper commands for lerobot CLI (calibrate, teleoperate, record, find-port, find-cameras)
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { getRobot, robotArgs, teleopArgs } from '../utils/registry.js';
import { runLerobotCommand } from '../utils/subprocess.js';
import { colors } from '../utils/output.js';

// ============================================================================
// HELPERS
// ============================================================================

function requireProfile(name: string) {
  const profile = getRobot(name);
  if (!profile) {
    console.error(colors.error(`Robot profile '${name}' not found.`));
    console.error(colors.muted('List profiles: roboctl robot list'));
    process.exit(1);
  }
  return profile;
}

function printLaunch(command: string, args: string[]): void {
  console.log(colors.muted(`> ${command} ${args.join(' ')}\n`));
}

// ============================================================================
// CALIBRATE
// ============================================================================

export const calibrateCommand = new Command('calibrate')
  .description('Calibrate a robot via lerobot')
  .argument('<name>', 'Robot profile name')
  .option('--leader', 'Calibrate the teleop leader arm instead of the follower')
  .action(async (name: string, opts) => {
    const profile = requireProfile(name);

    let args: string[];
    if (opts.leader) {
      if (!profile.teleop) {
        console.error(colors.error(`No teleop config for '${name}'. Add with: roboctl robot add ${name} --teleop-type <type> --teleop-port <port>`));
        process.exit(1);
      }
      args = [
        `--teleop.type=${profile.teleop.type}`,
        `--teleop.port=${profile.teleop.port}`,
      ];
      if (profile.teleop.id) args.push(`--teleop.id=${profile.teleop.id}`);
    } else {
      args = robotArgs(profile);
    }

    console.log(chalk.bold(`Calibrating ${opts.leader ? 'leader' : 'robot'}: ${name}`));
    printLaunch('lerobot-calibrate', args);

    const code = await runLerobotCommand('lerobot-calibrate', args);
    process.exit(code);
  });

// ============================================================================
// TELEOPERATE
// ============================================================================

export const teleoperateCommand = new Command('teleoperate')
  .description('Teleoperate a robot via lerobot')
  .argument('<name>', 'Robot profile name')
  .option('--fps <n>', 'Control frequency in Hz', '60')
  .option('--display', 'Display camera feed')
  .action(async (name: string, opts) => {
    const profile = requireProfile(name);

    if (!profile.teleop) {
      console.error(colors.error(`No teleop config for '${name}'. Add with: roboctl robot add ${name} --teleop-type <type> --teleop-port <port>`));
      process.exit(1);
    }

    const args = [
      ...robotArgs(profile),
      ...teleopArgs(profile),
      `--fps=${opts.fps}`,
    ];
    if (opts.display) args.push('--display_data=true');

    console.log(chalk.bold(`Teleoperating: ${name}`));
    printLaunch('lerobot-teleoperate', args);

    const code = await runLerobotCommand('lerobot-teleoperate', args);
    process.exit(code);
  });

// ============================================================================
// RECORD
// ============================================================================

export const recordCommand = new Command('record')
  .description('Record a dataset via lerobot')
  .argument('<name>', 'Robot profile name')
  .requiredOption('--repo-id <repo>', 'HuggingFace dataset repo (user/name)')
  .requiredOption('--task <description>', 'Task description')
  .option('--episodes <n>', 'Number of episodes to record', '10')
  .option('--fps <n>', 'Control frequency in Hz', '60')
  .action(async (name: string, opts) => {
    const profile = requireProfile(name);

    const args = [
      ...robotArgs(profile),
      ...teleopArgs(profile),
      `--dataset.repo_id=${opts.repoId}`,
      `--dataset.single_task=${opts.task}`,
      `--dataset.num_episodes=${opts.episodes}`,
      `--fps=${opts.fps}`,
    ];

    console.log(chalk.bold(`Recording dataset: ${opts.repoId}`));
    console.log(colors.muted(`  Robot: ${name} | Task: "${opts.task}" | Episodes: ${opts.episodes}`));
    printLaunch('lerobot-record', args);

    const code = await runLerobotCommand('lerobot-record', args);
    process.exit(code);
  });

// ============================================================================
// FIND-PORT
// ============================================================================

export const findPortCommand = new Command('find-port')
  .description('Find serial port for a connected robot (interactive)')
  .action(async () => {
    console.log(chalk.bold('Finding serial port...'));
    printLaunch('lerobot-find-port', []);

    const code = await runLerobotCommand('lerobot-find-port', []);
    process.exit(code);
  });

// ============================================================================
// FIND-CAMERAS
// ============================================================================

export const findCamerasCommand = new Command('find-cameras')
  .description('Discover connected cameras')
  .argument('[filter]', 'Filter by type: opencv or realsense')
  .action(async (filter?: string) => {
    const args = filter ? [filter] : [];

    console.log(chalk.bold('Finding cameras...'));
    printLaunch('lerobot-find-cameras', args);

    const code = await runLerobotCommand('lerobot-find-cameras', args);
    process.exit(code);
  });
