/**
 * @file output.ts
 * @description Output formatters for CLI (table, JSON, colors)
 */

import chalk from 'chalk';
import Table from 'cli-table3';
import type {
  OutputFormat,
  Robot,
  RobotTelemetry,
  RobotCommand,
  HealthResponse,
  RobotAlert,
} from '../api/types.js';

// Color helpers
export const colors = {
  success: chalk.green,
  error: chalk.red,
  warning: chalk.yellow,
  info: chalk.blue,
  muted: chalk.gray,
  highlight: chalk.cyan,
  bold: chalk.bold,
};

// Status colors
export function statusColor(status: string): string {
  switch (status) {
    case 'online':
    case 'completed':
    case 'healthy':
      return colors.success(status);
    case 'offline':
    case 'failed':
    case 'error':
      return colors.error(status);
    case 'busy':
    case 'executing':
    case 'pending':
      return colors.warning(status);
    case 'charging':
    case 'maintenance':
      return colors.info(status);
    default:
      return status;
  }
}

// Battery color based on level
export function batteryColor(level: number): string {
  const text = `${level}%`;
  if (level > 50) return colors.success(text);
  if (level > 20) return colors.warning(text);
  return colors.error(text);
}

// Format robot status
export function formatStatus(robot: Robot, format: OutputFormat): string {
  if (format === 'json') {
    return JSON.stringify(robot, null, 2);
  }

  if (format === 'minimal') {
    const loc = robot.location;
    return `${robot.id} | ${robot.status} | ${robot.batteryLevel}% | (${loc.x.toFixed(1)}, ${loc.y.toFixed(1)})`;
  }

  // Table format
  const table = new Table({
    chars: {
      top: '─',
      'top-mid': '',
      'top-left': '',
      'top-right': '',
      bottom: '─',
      'bottom-mid': '',
      'bottom-left': '',
      'bottom-right': '',
      left: '',
      'left-mid': '',
      mid: '',
      'mid-mid': '',
      right: '',
      'right-mid': '',
      middle: '  ',
    },
    style: { 'padding-left': 2, 'padding-right': 2 },
  });

  const loc = robot.location;
  const heldObject = robot.metadata?.heldObject as string | undefined;

  table.push(
    [colors.muted('Status'), statusColor(robot.status), colors.muted('Battery'), batteryColor(robot.batteryLevel)],
    [colors.muted('Location'), `(${loc.x.toFixed(1)}, ${loc.y.toFixed(1)})`, colors.muted('Zone'), loc.zone || '-'],
    [colors.muted('Holding'), heldObject || colors.muted('nothing'), colors.muted('Model'), robot.model],
    [colors.muted('Floor'), loc.floor || '1', colors.muted('Firmware'), robot.firmware || '-']
  );

  const header = `${colors.bold('Robot:')} ${robot.id} (${robot.name})`;
  const divider = '─'.repeat(50);

  return `\n${header}\n${divider}\n${table.toString()}\n${divider}\n`;
}

// Format telemetry data
export function formatTelemetry(telemetry: RobotTelemetry, format: OutputFormat): string {
  if (format === 'json') {
    return JSON.stringify(telemetry, null, 2);
  }

  if (format === 'minimal') {
    return `Battery: ${telemetry.batteryLevel}% | CPU: ${telemetry.cpuUsage}% | Temp: ${telemetry.temperature}°C`;
  }

  // Table format
  const table = new Table({
    head: [colors.bold('Metric'), colors.bold('Value'), colors.bold('Metric'), colors.bold('Value')],
    colWidths: [20, 15, 20, 15],
  });

  const sensors = telemetry.sensors;

  table.push(
    ['Battery', batteryColor(telemetry.batteryLevel), 'CPU Usage', `${telemetry.cpuUsage}%`],
    ['Voltage', telemetry.batteryVoltage ? `${telemetry.batteryVoltage.toFixed(1)}V` : '-', 'Memory', `${telemetry.memoryUsage}%`],
    ['Temp', `${telemetry.temperature}°C`, 'Speed', telemetry.speed ? `${telemetry.speed.toFixed(2)} m/s` : '-'],
    ['Humidity', telemetry.humidity ? `${telemetry.humidity}%` : '-', 'Disk', telemetry.diskUsage ? `${telemetry.diskUsage}%` : '-']
  );

  // Add sensor data if available
  if (sensors.frontSonar !== undefined) {
    table.push(['Front Sonar', `${sensors.frontSonar} cm`, 'Rear Sonar', sensors.rearSonar ? `${sensors.rearSonar} cm` : '-']);
  }
  if (sensors.gripperForce !== undefined) {
    table.push(['Gripper Force', `${(sensors.gripperForce as number).toFixed(1)} N`, 'Gripper Open', sensors.gripperOpen ? 'Yes' : 'No']);
  }

  const header = `${colors.bold('Telemetry:')} ${telemetry.robotId}`;
  const timestamp = colors.muted(`Updated: ${new Date(telemetry.timestamp).toLocaleTimeString()}`);

  return `\n${header}  ${timestamp}\n${table.toString()}\n`;
}

// Format command result
export function formatCommand(command: RobotCommand, format: OutputFormat): string {
  if (format === 'json') {
    return JSON.stringify(command, null, 2);
  }

  if (format === 'minimal') {
    return `${command.type} | ${command.status} | ${command.result?.message || ''}`;
  }

  const lines = [
    `${colors.bold(`[${command.robotId}]`)} Command: ${colors.highlight(command.type)}`,
    `  ${colors.muted('Status:')}    ${statusColor(command.status)}`,
  ];

  if (command.result?.message) {
    lines.push(`  ${colors.muted('Message:')}   ${command.result.message}`);
  }
  if (command.result?.estimatedTime) {
    lines.push(`  ${colors.muted('ETA:')}       ${command.result.estimatedTime} seconds`);
  }
  if (command.errorMessage) {
    lines.push(`  ${colors.error('Error:')}     ${command.errorMessage}`);
  }

  return lines.join('\n') + '\n';
}

// Format command history
export function formatCommandList(commands: RobotCommand[], format: OutputFormat): string {
  if (format === 'json') {
    return JSON.stringify(commands, null, 2);
  }

  if (commands.length === 0) {
    return colors.muted('No commands in history\n');
  }

  if (format === 'minimal') {
    return commands
      .map((c) => `${c.type} | ${c.status} | ${new Date(c.createdAt).toLocaleTimeString()}`)
      .join('\n');
  }

  const table = new Table({
    head: [colors.bold('Type'), colors.bold('Status'), colors.bold('Time'), colors.bold('Message')],
    colWidths: [18, 12, 12, 35],
  });

  for (const cmd of commands) {
    table.push([
      cmd.type,
      statusColor(cmd.status),
      new Date(cmd.createdAt).toLocaleTimeString(),
      (cmd.result?.message as string)?.slice(0, 32) || cmd.errorMessage?.slice(0, 32) || '-',
    ]);
  }

  return `\n${colors.bold('Command History')}\n${table.toString()}\n`;
}

// Format health response
export function formatHealth(health: HealthResponse, format: OutputFormat): string {
  if (format === 'json') {
    return JSON.stringify(health, null, 2);
  }

  if (format === 'minimal') {
    return `${health.robotId} | ${health.status} | ${health.batteryLevel}%`;
  }

  return [
    `${colors.success('●')} ${colors.bold('Connected')} to ${health.robotId}`,
    `  ${colors.muted('Status:')}  ${statusColor(health.robotStatus)}`,
    `  ${colors.muted('Battery:')} ${batteryColor(health.batteryLevel)}`,
    '',
  ].join('\n');
}

// Format alert
export function formatAlert(alert: RobotAlert): string {
  const severityColors: Record<string, typeof colors.error> = {
    critical: colors.error,
    error: colors.error,
    warning: colors.warning,
    info: colors.info,
  };

  const color = severityColors[alert.severity] || colors.muted;
  const icon =
    alert.severity === 'critical' || alert.severity === 'error'
      ? '!'
      : alert.severity === 'warning'
        ? '!'
        : 'i';

  return color(`[${icon}] ${alert.title}: ${alert.message}`);
}

// Print error message
export function printError(message: string): void {
  console.error(colors.error(`Error: ${message}`));
}

// Print success message
export function printSuccess(message: string): void {
  console.log(colors.success(message));
}
