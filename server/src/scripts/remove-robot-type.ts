/**
 * @file remove-robot-type.ts
 * @description Take one unused robot type off a running instance (TASK-485) —
 *              e.g. a stale type an import created, which otherwise shows in
 *              every robot-type picker.
 * @feature training
 *
 * Run (from server/):
 *   npm run remove:robot-type -- --base-url https://neodem.example.org --name Unitree_G1
 *
 * Options:
 *   --base-url <url>   the instance (default http://localhost:3001)
 *   --name <name>      the robot type's exact name (or --id <uuid>)
 *   --dry-run          report what would be removed, write nothing
 *   --token <jwt>      bearer token for an instance with auth on (or NEODEM_TOKEN);
 *                      the account needs `owner`
 *
 * It talks to the public API only: `GET /api/datasets/robot-types` to find the
 * type, `DELETE /api/datasets/robot-types/:id` to remove it. The server refuses
 * a type that a dataset, an embodiment or a skill still uses, and the standard
 * types it seeds at start; the script prints the refusal and exits 1. Running
 * it again after a removal reports `absent` and exits 0.
 */

import { pathToFileURL } from 'node:url';
import { apiRoot } from './demoFleet.js';

export interface RemoveRobotTypeArgs {
  baseUrl: string;
  name?: string;
  id?: string;
  dryRun: boolean;
  token?: string;
  help: boolean;
}

export function parseArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): RemoveRobotTypeArgs {
  const args: RemoveRobotTypeArgs = {
    baseUrl: 'http://localhost:3001',
    dryRun: false,
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
    else if (arg === '--name') args.name = value();
    else if (arg.startsWith('--name=')) args.name = arg.slice('--name='.length);
    else if (arg === '--id') args.id = value();
    else if (arg.startsWith('--id=')) args.id = arg.slice('--id='.length);
    else if (arg === '--token') args.token = value();
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!args.help && !args.name && !args.id) throw new Error('Pass --name <robot type name> or --id <robot type id>');
  if (args.name && args.id) throw new Error('Pass --name or --id, not both');
  return args;
}

export type RemoveRobotTypeOutcome = 'removed' | 'would-remove' | 'absent' | 'refused';

export interface RemoveRobotTypeResult {
  outcome: RemoveRobotTypeOutcome;
  /** The type as the instance lists it; absent when there is no such type. */
  robotType?: { id: string; name: string; actionDim?: number; proprioceptionDim?: number };
  /** The server's sentence when it refused. */
  reason?: string;
}

export interface RemoveRobotTypeOptions {
  baseUrl: string;
  name?: string;
  id?: string;
  dryRun?: boolean;
  token?: string;
  fetchImpl?: typeof fetch;
}

async function errorText(res: Response): Promise<string> {
  const body = await res.text().catch(() => '');
  try {
    const parsed = JSON.parse(body) as { error?: unknown; message?: unknown };
    const message = parsed.error ?? parsed.message;
    if (typeof message === 'string') return message;
  } catch {
    /* not JSON */
  }
  return body.slice(0, 200) || res.statusText;
}

/**
 * Remove the named robot type, or say why not. Throws only on an answer that
 * is neither a success nor one of the documented refusals.
 */
export async function removeRobotType(options: RemoveRobotTypeOptions): Promise<RemoveRobotTypeResult> {
  const root = apiRoot(options.baseUrl);
  const doFetch = options.fetchImpl ?? fetch;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
  };

  const listUrl = `${root}/datasets/robot-types`;
  const list = await doFetch(listUrl, { headers });
  if (!list.ok) throw new Error(`GET ${listUrl} answered ${list.status}: ${await errorText(list)}`);
  const body = (await list.json()) as {
    robotTypes?: Array<{ id: string; name: string; actionDim?: number; proprioceptionDim?: number }>;
  };
  // Exact match only: "Unitree_G1" must never take "Unitree G1 EDU (Dex3-1)" with it.
  const found = (body.robotTypes ?? []).find((t) => (options.id ? t.id === options.id : t.name === options.name));
  if (!found) return { outcome: 'absent' };
  const robotType = {
    id: found.id,
    name: found.name,
    actionDim: found.actionDim,
    proprioceptionDim: found.proprioceptionDim,
  };
  if (options.dryRun) return { outcome: 'would-remove', robotType };

  const url = `${listUrl}/${encodeURIComponent(found.id)}`;
  const res = await doFetch(url, { method: 'DELETE', headers });
  if (res.ok) return { outcome: 'removed', robotType };
  if (res.status === 409) return { outcome: 'refused', robotType, reason: await errorText(res) };
  if (res.status === 404) {
    const reason = await errorText(res);
    // The type's own 404 means someone else removed it meanwhile; any other 404 is a server without the route.
    if (/robot type not found/i.test(reason)) return { outcome: 'absent' };
    throw new Error(
      `DELETE ${url} answered 404 — this server has no robot-type delete route. Deploy a build that includes TASK-485 first.`,
    );
  }
  throw new Error(`DELETE ${url} answered ${res.status}: ${await errorText(res)}`);
}

const USAGE =
  'Usage: npm run remove:robot-type -- --name <robot type name> [--base-url <url>] [--dry-run] [--token <jwt>]';

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return;
  }
  const wanted = args.name ?? args.id ?? '';
  console.log(`Robot type "${wanted}" → ${args.baseUrl}${args.dryRun ? ' (dry run)' : ''}`);
  const result = await removeRobotType(args);
  const widths = result.robotType ? ` (${result.robotType.proprioceptionDim} / ${result.robotType.actionDim})` : '';
  console.log(`  ${result.outcome.padEnd(12)} ${result.robotType?.name ?? wanted}${widths}${result.reason ? ` — ${result.reason}` : ''}`);
  if (result.outcome === 'refused') process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
