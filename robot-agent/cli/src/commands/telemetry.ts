/**
 * @file telemetry.ts
 * @description Telemetry command with optional live streaming
 */

import { Command } from 'commander';
import ora from 'ora';
import { createClient } from '../api/client.js';
import { createTelemetryStream } from '../api/websocket.js';
import { formatTelemetry, formatAlert, printError, colors } from '../utils/output.js';
import type { CliOptions } from '../api/types.js';

export const telemetryCommand = new Command('telemetry')
  .description('Show sensor data')
  .option('-w, --watch', 'Stream live telemetry via WebSocket')
  .option('-i, --interval <seconds>', 'Polling interval in seconds (for non-watch mode)', '2')
  .action(async (options: { watch?: boolean; interval: string }) => {
    const opts = telemetryCommand.optsWithGlobals<CliOptions>();

    if (options.watch) {
      await watchTelemetry(opts);
    } else {
      await fetchTelemetry(opts);
    }
  });

async function fetchTelemetry(opts: CliOptions): Promise<void> {
  const spinner = ora('Fetching telemetry...').start();

  try {
    const client = createClient(opts.url, opts.robot);
    const telemetry = await client.getTelemetry();

    spinner.stop();
    console.log(formatTelemetry(telemetry, opts.format));
  } catch (error) {
    spinner.stop();
    printError(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

async function watchTelemetry(opts: CliOptions): Promise<void> {
  const spinner = ora('Connecting to telemetry stream...').start();

  try {
    const client = createClient(opts.url, opts.robot);
    const wsUrl = await client.getWebSocketUrl();

    const stream = createTelemetryStream();

    // Handle Ctrl+C gracefully
    process.on('SIGINT', () => {
      stream.disconnect();
      console.log(colors.muted('\nDisconnected from telemetry stream.'));
      process.exit(0);
    });

    stream.connect(wsUrl, {
      onConnect: () => {
        spinner.stop();
        console.log(colors.success('Connected to telemetry stream. Press Ctrl+C to stop.\n'));
      },
      onTelemetry: (telemetry) => {
        // Clear screen and print telemetry
        process.stdout.write('\x1B[2J\x1B[0f');
        console.log(colors.success('Live Telemetry') + colors.muted(' (Press Ctrl+C to stop)\n'));
        console.log(formatTelemetry(telemetry, opts.format));
      },
      onAlert: (alert) => {
        console.log(formatAlert(alert));
      },
      onError: (error) => {
        spinner.stop();
        printError(error.message);
      },
      onClose: () => {
        console.log(colors.muted('\nConnection closed.'));
        process.exit(0);
      },
    });
  } catch (error) {
    spinner.stop();
    printError(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
