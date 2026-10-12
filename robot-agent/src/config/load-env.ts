/**
 * @file load-env.ts
 * @description Loads the agent's env file (TASK-389). A profile script names its
 * file with `DOTENV_CONFIG_PATH` (`dev:g1` → `.env.g1`). `dotenv/config` loads
 * nothing at all when that file is missing — not even `.env` — so the agent used
 * to boot silently on its defaults. This loader warns, naming the file, and
 * falls back to `.env`. Values already in the environment always win.
 * @feature config
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import dotenv from 'dotenv';

export interface LoadedEnv {
  /** The file that was loaded, or null when none existed. */
  loaded: string | null;
  /** The profile file that was asked for but missing, if any. */
  missing: string | null;
}

export function loadAgentEnv(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
  warn: (message: string) => void = console.warn,
): LoadedEnv {
  const requested = env.DOTENV_CONFIG_PATH;
  const fallback = resolve(cwd, '.env');
  let missing: string | null = null;
  let path = fallback;

  if (requested) {
    const profile = resolve(cwd, requested);
    if (existsSync(profile)) {
      path = profile;
    } else {
      missing = profile;
      warn(
        `[Config] ${requested} not found — falling back to .env. ` +
          `Create it from .env.example to configure this profile.`,
      );
    }
  }

  if (!existsSync(path)) return { loaded: null, missing };
  dotenv.config({ path, processEnv: env as Record<string, string>, quiet: true });
  return { loaded: path, missing };
}
