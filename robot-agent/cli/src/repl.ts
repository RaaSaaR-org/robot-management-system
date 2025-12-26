/**
 * @file repl.ts
 * @description Interactive REPL mode with live telemetry
 */

import * as readline from 'readline';
import { createClient, RobotApiClient } from './api/client.js';
import { createTelemetryStream, TelemetryStream } from './api/websocket.js';
import {
  formatStatus,
  formatTelemetry,
  formatCommand,
  formatCommandList,
  formatHealth,
  formatAlert,
  printError,
  colors,
} from './utils/output.js';
import { getDefaultUrl } from './utils/config.js';
import type { OutputFormat, RobotTelemetry, RobotAlert } from './api/types.js';

interface ReplState {
  client: RobotApiClient;
  stream: TelemetryStream;
  robotId: string;
  format: OutputFormat;
  lastTelemetry: RobotTelemetry | null;
  connected: boolean;
}

const COMMANDS = [
  'status',
  'telemetry',
  'health',
  'history',
  'move',
  'stop',
  'estop',
  'pickup',
  'drop',
  'charge',
  'home',
  'help',
  'exit',
  'quit',
];

function printHelp(): void {
  console.log(`
${colors.bold('Available Commands:')}

  ${colors.highlight('status')}              Show robot status
  ${colors.highlight('telemetry')}           Show current sensor data
  ${colors.highlight('health')}              Check connection health
  ${colors.highlight('history')} [n]         Show last n commands (default: 5)

  ${colors.highlight('move')} <x> <y>        Move robot to coordinates
  ${colors.highlight('stop')}                Stop robot movement
  ${colors.highlight('estop')} [reason]      Emergency stop
  ${colors.highlight('pickup')} <objectId>   Pick up an object
  ${colors.highlight('drop')}                Drop held object
  ${colors.highlight('charge')}              Go to charging station
  ${colors.highlight('home')}                Return to home position

  ${colors.highlight('help')}                Show this help message
  ${colors.highlight('exit')}, ${colors.highlight('quit')}          Exit REPL

${colors.muted('Tip: Use Tab for command completion')}
`);
}

function completer(line: string): [string[], string] {
  const hits = COMMANDS.filter((c) => c.startsWith(line.toLowerCase()));
  return [hits.length ? hits : COMMANDS, line];
}

async function handleCommand(state: ReplState, input: string): Promise<void> {
  const parts = input.trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase();
  const args = parts.slice(1);

  if (!cmd) return;

  try {
    switch (cmd) {
      case 'status': {
        const robot = await state.client.getStatus();
        console.log(formatStatus(robot, state.format));
        break;
      }

      case 'telemetry': {
        const telemetry = await state.client.getTelemetry();
        console.log(formatTelemetry(telemetry, state.format));
        break;
      }

      case 'health': {
        const health = await state.client.getHealth();
        console.log(formatHealth(health, state.format));
        break;
      }

      case 'history': {
        const limit = parseInt(args[0] || '5', 10);
        const response = await state.client.getCommandHistory(1, limit);
        console.log(formatCommandList(response.commands, state.format));
        break;
      }

      case 'move': {
        const x = parseFloat(args[0]);
        const y = parseFloat(args[1]);

        if (isNaN(x) || isNaN(y)) {
          printError('Usage: move <x> <y>');
          break;
        }

        const result = await state.client.sendCommand('move', { destination: { x, y } });
        console.log(formatCommand(result, state.format));
        break;
      }

      case 'stop': {
        const result = await state.client.sendCommand('stop');
        console.log(formatCommand(result, state.format));
        break;
      }

      case 'estop':
      case 'emergency-stop': {
        const reason = args.join(' ') || undefined;
        console.log(colors.error('! EMERGENCY STOP !'));
        const result = await state.client.sendCommand('emergency_stop', reason ? { reason } : undefined);
        console.log(formatCommand(result, state.format));
        break;
      }

      case 'pickup': {
        if (!args[0]) {
          printError('Usage: pickup <objectId>');
          break;
        }
        const result = await state.client.sendCommand('pickup', { objectId: args[0] });
        console.log(formatCommand(result, state.format));
        break;
      }

      case 'drop': {
        const result = await state.client.sendCommand('drop');
        console.log(formatCommand(result, state.format));
        break;
      }

      case 'charge': {
        const result = await state.client.sendCommand('charge');
        console.log(formatCommand(result, state.format));
        break;
      }

      case 'home': {
        const result = await state.client.sendCommand('return_home');
        console.log(formatCommand(result, state.format));
        break;
      }

      case 'help':
      case '?':
        printHelp();
        break;

      case 'exit':
      case 'quit':
      case 'q':
        state.stream.disconnect();
        console.log(colors.muted('Goodbye!'));
        process.exit(0);
        break;

      default:
        printError(`Unknown command: ${cmd}. Type 'help' for available commands.`);
    }
  } catch (error) {
    printError(error instanceof Error ? error.message : String(error));
  }
}

export async function startRepl(): Promise<void> {
  const url = getDefaultUrl();

  console.log(colors.bold('\nRoboCtl Interactive Mode'));
  console.log(colors.muted(`Connecting to ${url}...\n`));

  // Create client and connect
  const client = createClient(url);

  let robotId: string;
  try {
    robotId = await client.discover();
  } catch (error) {
    printError(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  console.log(colors.success(`Connected to robot: ${robotId}`));
  console.log(colors.muted("Type 'help' for available commands.\n"));

  // Set up state
  const state: ReplState = {
    client,
    stream: createTelemetryStream(),
    robotId,
    format: 'table',
    lastTelemetry: null,
    connected: true,
  };

  // Connect to telemetry stream in background for alerts
  const wsUrl = await client.getWebSocketUrl();
  state.stream.connect(wsUrl, {
    onTelemetry: (telemetry: RobotTelemetry) => {
      state.lastTelemetry = telemetry;
    },
    onAlert: (alert: RobotAlert) => {
      // Show alerts inline
      console.log('\n' + formatAlert(alert));
    },
    onError: () => {
      // Silent - we'll reconnect
    },
    onClose: () => {
      state.connected = false;
    },
  });

  // Create readline interface
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    completer,
    prompt: colors.highlight('roboctl> '),
  });

  // Handle Ctrl+C
  rl.on('SIGINT', () => {
    state.stream.disconnect();
    console.log(colors.muted('\nGoodbye!'));
    process.exit(0);
  });

  // Handle input
  rl.on('line', async (line) => {
    await handleCommand(state, line);
    rl.prompt();
  });

  // Handle close
  rl.on('close', () => {
    state.stream.disconnect();
    console.log(colors.muted('\nGoodbye!'));
    process.exit(0);
  });

  // Start prompting
  rl.prompt();
}
