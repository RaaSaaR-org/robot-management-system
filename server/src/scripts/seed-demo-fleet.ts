/**
 * @file seed-demo-fleet.ts
 * @description Put the three demo robots (TASK-477) on a running instance:
 *              a Unitree G1 with Dex3 hands, an SO-101 and a MicroDuck.
 * @feature robots
 *
 * Run (from server/):
 *   npm run seed:demo-fleet -- --base-url https://neodem.example.org
 *
 * Options:
 *   --base-url <url>      the instance (default http://localhost:3001)
 *   --dry-run             report what would change, write nothing
 *   --remove              take the script's own robots off again
 *   --without-microduck   leave the MicroDuck out (with --remove: leave it in place)
 *   --token <jwt>         bearer token for an instance with auth on (or NEODEM_TOKEN)
 *
 * It talks to the public API only — no database access — and is safe to run
 * repeatedly: fixed ids, so no duplicates; a second run writes nothing; and a
 * robot under one of its ids that it did not create (say, the real G1 once its
 * agent has registered as `demo-g1-dex3`) is skipped, never modified or removed.
 * See `demoFleet.ts` for the rules and `docs/demo-fleet.md` for the walkthrough.
 */

import { pathToFileURL } from 'node:url';
import { DEMO_FLEET, missingRobotTypes, syncDemoFleet, type DemoFleetOptions } from './demoFleet.js';

export interface CliArgs {
  baseUrl: string;
  remove: boolean;
  dryRun: boolean;
  withoutMicroduck: boolean;
  token?: string;
  help: boolean;
}

export function parseArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): CliArgs {
  const args: CliArgs = {
    baseUrl: 'http://localhost:3001',
    remove: false,
    dryRun: false,
    withoutMicroduck: false,
    token: env.NEODEM_TOKEN || undefined,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined || next.startsWith('--')) throw new Error(`${arg} needs a value`);
      return next;
    };
    if (arg === '--base-url') args.baseUrl = value();
    else if (arg.startsWith('--base-url=')) args.baseUrl = arg.slice('--base-url='.length);
    else if (arg === '--token') args.token = value();
    else if (arg === '--remove') args.remove = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--without-microduck') args.withoutMicroduck = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return args;
}

const USAGE = `Usage: npm run seed:demo-fleet -- [--base-url <url>] [--dry-run] [--remove] [--without-microduck] [--token <jwt>]`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return;
  }
  const options: DemoFleetOptions = {
    baseUrl: args.baseUrl,
    remove: args.remove,
    dryRun: args.dryRun,
    token: args.token,
    robots: args.withoutMicroduck ? DEMO_FLEET.filter((r) => r.id !== 'demo-microduck') : DEMO_FLEET,
  };

  console.log(`Demo fleet → ${args.baseUrl}${args.dryRun ? ' (dry run)' : ''}`);
  const results = await syncDemoFleet(options);
  for (const r of results) {
    console.log(`  ${r.outcome.padEnd(12)} ${r.id.padEnd(16)} ${r.name}${r.reason ? ` — ${r.reason}` : ''}`);
  }

  if (!args.remove) {
    const missing = await missingRobotTypes(options);
    if (missing.length > 0) {
      console.warn(
        `  note: robot type(s) not on this instance yet: ${missing.join(', ')}. ` +
          'They are seeded when a server build with TASK-477 starts.',
      );
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
