/**
 * @file seed-demo-fleet.ts
 * @description Put the three demo robots (TASK-477) on a running instance —
 *              a Unitree G1 with Dex3 hands, an SO-101 and a MicroDuck — and
 *              on its site (TASK-493).
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
 *   --site <name|id>      the site to put the robots on (default: the instance's only site)
 *   --no-site             leave site bindings and planned places alone
 *   --also <robot id>     bind this existing robot to the site as well (repeatable)
 *   --token <jwt>         bearer token for an instance with auth on (or NEODEM_TOKEN)
 *
 * It talks to the public API only — no database access — and is safe to run
 * repeatedly: fixed ids, so no duplicates; a second run writes nothing; and a
 * robot under one of its ids that it did not create (say, the real G1 once its
 * agent has registered as `demo-g1-dex3`) is skipped, never modified or removed.
 * See `demoFleet.ts` and `demoFleetSites.ts` for the rules and
 * `docs/demo-fleet.md` for the walkthrough.
 */

import { pathToFileURL } from 'node:url';
import { DEMO_FLEET, missingRobotTypes, syncDemoFleet, type DemoFleetOptions } from './demoFleet.js';
import {
  assignDemoSites,
  keepPlannedPlaces,
  placeDemoRobots,
  plannedPlaceFor,
  resolveDemoSite,
  type DemoSite,
} from './demoFleetSites.js';

export interface CliArgs {
  baseUrl: string;
  remove: boolean;
  dryRun: boolean;
  withoutMicroduck: boolean;
  /** Name or id of the site to bind the robots to; unset means the instance's only site. */
  site?: string;
  noSite: boolean;
  /** Existing robots to bind to the site as well. */
  also: string[];
  token?: string;
  help: boolean;
}

export function parseArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): CliArgs {
  const args: CliArgs = {
    baseUrl: 'http://localhost:3001',
    remove: false,
    dryRun: false,
    withoutMicroduck: false,
    noSite: false,
    also: [],
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
    else if (arg === '--site') args.site = value();
    else if (arg.startsWith('--site=')) args.site = arg.slice('--site='.length);
    else if (arg === '--also') args.also.push(value());
    else if (arg.startsWith('--also=')) args.also.push(arg.slice('--also='.length));
    else if (arg === '--no-site') args.noSite = true;
    else if (arg === '--remove') args.remove = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--without-microduck') args.withoutMicroduck = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (args.noSite && (args.site || args.also.length > 0)) {
    throw new Error('--no-site cannot be combined with --site or --also');
  }
  if (args.remove && (args.site || args.also.length > 0)) {
    throw new Error('--remove takes the robots off; it cannot be combined with --site or --also');
  }
  return args;
}

const USAGE =
  'Usage: npm run seed:demo-fleet -- [--base-url <url>] [--dry-run] [--remove] [--without-microduck] ' +
  '[--site <name|id>] [--no-site] [--also <robot id>] [--token <jwt>]';

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return;
  }
  const fleet = args.withoutMicroduck ? DEMO_FLEET.filter((r) => r.id !== 'demo-microduck') : DEMO_FLEET;
  const api = { baseUrl: args.baseUrl, token: args.token };

  console.log(`Demo fleet → ${args.baseUrl}${args.dryRun ? ' (dry run)' : ''}`);

  // The site comes first: the planned place is part of each robot's row.
  let site: DemoSite | null = null;
  let noSiteReason: string | null = null;
  const withSites = !args.remove && !args.noSite;
  if (withSites) {
    const resolved = await resolveDemoSite({ ...api, wanted: args.site });
    site = resolved.site;
    if (!resolved.site) noSiteReason = resolved.reason;
  }

  const options: DemoFleetOptions = {
    ...api,
    remove: args.remove,
    dryRun: args.dryRun,
    robots: withSites ? placeDemoRobots(fleet, site) : fleet,
  };
  if (args.noSite && !args.remove) options.robots = await keepPlannedPlaces(fleet, api);
  const results = await syncDemoFleet(options);
  for (const r of results) {
    console.log(`  ${r.outcome.padEnd(12)} ${r.id.padEnd(16)} ${r.name}${r.reason ? ` — ${r.reason}` : ''}`);
  }

  if (withSites) {
    if (site) {
      console.log(`Site → ${site.name}`);
      const placed = await assignDemoSites({
        ...api,
        site,
        robots: fleet,
        siteIsExplicit: Boolean(args.site),
        also: args.also,
        dryRun: args.dryRun,
      });
      for (const r of placed) {
        const place = plannedPlaceFor(r.id, site);
        const detail = r.reason ?? (place ? `planned at ${place}, drawn as not live` : undefined);
        console.log(`  ${r.outcome.padEnd(12)} ${r.id.padEnd(16)} ${r.name}${detail ? ` — ${detail}` : ''}`);
      }
      if (placed.some((r) => r.outcome === 'absent')) process.exitCode = 1;
    } else {
      console.log(`Site → none: ${noSiteReason}. The robots are listed under "No site".`);
      // --also asked for a binding that did not happen: say so with the exit code too.
      if (args.also.length > 0) process.exitCode = 1;
    }
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
