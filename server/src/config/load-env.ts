/**
 * @file load-env.ts
 * @description Loads `server/.env` into `process.env` before anything else
 *              reads it (TASK-389). The file is found from this module's own
 *              location, not the cwd, and never from wherever `prisma generate`
 *              happened to run. Values already in the environment win; a
 *              missing file is not an error (production injects its env).
 * @feature config
 */

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

/** `server/` — two levels up from `src/config/` and from `dist/config/`. */
export const SERVER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Load `<dir>/.env` without overriding variables already set.
 * Returns the path it loaded, or null when there was no file.
 */
export function loadServerEnv(dir: string = SERVER_ROOT): string | null {
  const path = resolve(dir, '.env');
  if (!existsSync(path)) return null;
  dotenv.config({ path, quiet: true });
  return path;
}
