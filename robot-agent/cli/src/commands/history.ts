/**
 * @file history.ts
 * @description Command history
 */

import { Command } from 'commander';
import ora from 'ora';
import { createClient } from '../api/client.js';
import { formatCommandList, printError, colors } from '../utils/output.js';
import type { CliOptions } from '../api/types.js';

export const historyCommand = new Command('history')
  .description('Show command history')
  .option('-n, --limit <number>', 'Number of commands to show', '10')
  .option('-p, --page <number>', 'Page number', '1')
  .action(async (options: { limit: string; page: string }) => {
    const opts = historyCommand.optsWithGlobals<CliOptions>();
    const spinner = ora('Fetching command history...').start();

    const limit = parseInt(options.limit, 10);
    const page = parseInt(options.page, 10);

    if (isNaN(limit) || limit < 1) {
      spinner.stop();
      printError('Invalid limit. Must be a positive number.');
      process.exit(1);
    }

    try {
      const client = createClient(opts.url, opts.robot);
      const response = await client.getCommandHistory(page, limit);

      spinner.stop();

      if (opts.format === 'json') {
        console.log(JSON.stringify(response, null, 2));
      } else {
        console.log(formatCommandList(response.commands, opts.format));

        if (response.pagination.totalPages > 1) {
          console.log(
            colors.muted(
              `Page ${response.pagination.page} of ${response.pagination.totalPages} ` +
                `(${response.pagination.total} total commands)`
            )
          );
        }
      }
    } catch (error) {
      spinner.stop();
      printError(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });
