/**
 * @file subprocess.ts
 * @description Spawn lerobot CLI commands with interactive stdio pass-through
 */

import { spawn } from 'node:child_process';

/**
 * Run a lerobot CLI command with inherited stdio.
 * Returns the exit code of the subprocess.
 */
export function runLerobotCommand(
  command: string,
  args: string[],
  options?: { cwd?: string },
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      cwd: options?.cwd,
      shell: false,
    });

    child.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        console.error(
          `\nCommand '${command}' not found.\n` +
          `Install lerobot: pip install lerobot\n`,
        );
        resolve(127);
      } else {
        reject(err);
      }
    });

    child.on('close', (code) => resolve(code ?? 1));
  });
}
