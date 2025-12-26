/**
 * @file status.ts
 * @description Robot status command
 */

import { Command } from 'commander';
import ora from 'ora';
import { createClient } from '../api/client.js';
import { formatStatus, printError } from '../utils/output.js';
import type { CliOptions } from '../api/types.js';

export const statusCommand = new Command('status')
  .description('Show robot status (battery, location, held object)')
  .action(async () => {
    const opts = statusCommand.optsWithGlobals<CliOptions>();
    const spinner = ora('Fetching robot status...').start();

    try {
      const client = createClient(opts.url, opts.robot);
      const robot = await client.getStatus();

      spinner.stop();
      console.log(formatStatus(robot, opts.format));
    } catch (error) {
      spinner.stop();
      printError(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });
