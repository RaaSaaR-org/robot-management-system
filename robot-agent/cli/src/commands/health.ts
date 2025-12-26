/**
 * @file health.ts
 * @description Health check command
 */

import { Command } from 'commander';
import ora from 'ora';
import { createClient } from '../api/client.js';
import { formatHealth, printError } from '../utils/output.js';
import type { CliOptions } from '../api/types.js';

export const healthCommand = new Command('health')
  .description('Check robot agent health')
  .action(async () => {
    const opts = healthCommand.optsWithGlobals<CliOptions>();
    const spinner = ora('Connecting to robot...').start();

    try {
      const client = createClient(opts.url, opts.robot);
      const health = await client.getHealth();

      spinner.stop();
      console.log(formatHealth(health, opts.format));
    } catch (error) {
      spinner.stop();
      printError(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });
