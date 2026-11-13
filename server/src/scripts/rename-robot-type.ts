/**
 * @file rename-robot-type.ts
 * @description Give one robot type on a running instance another display name
 *              (TASK-493) — e.g. the `unitree_g1_dex3 (action 31, state 31)`
 *              an import created, which reads as a raw identifier in every
 *              table and picker.
 * @feature training
 *
 * Run (from server/):
 *   npm run rename:robot-type -- --base-url https://neodem.example.org \
 *     --name "unitree_g1_dex3 (action 31, state 31)" --to "Unitree G1 upper body + Dex3-1 hands"
 *
 * Options:
 *   --base-url <url>   the instance (default http://localhost:3001)
 *   --name <name>      the robot type's exact current name (or --id <uuid>)
 *   --to <name>        the name it should have
 *   --dry-run          report what would be renamed, write nothing
 *   --token <jwt>      bearer token for an instance with auth on (or NEODEM_TOKEN);
 *                      the account needs `owner`
 *
 * It talks to the public API only: `GET /api/datasets/robot-types` to find the
 * type, `PATCH /api/datasets/robot-types/:id` to rename it. Only the name
 * changes: `model` and the widths stay, so datasets on the type stay valid and
 * a later import of the same robot still finds this row. The server refuses a
 * name another type has and the standard types it seeds at start; the script
 * prints the refusal and exits 1. Running it again after a rename reports
 * `unchanged` and exits 0.
 */

import { pathToFileURL } from 'node:url';
import { apiRoot } from './demoFleet.js';
import { STANDARD_ROBOT_TYPES } from '../database/standardRobotTypes.js';

export interface RenameRobotTypeArgs {
  baseUrl: string;
  name?: string;
  id?: string;
  to?: string;
  dryRun: boolean;
  token?: string;
  help: boolean;
}

export function parseArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): RenameRobotTypeArgs {
  const args: RenameRobotTypeArgs = {
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
    else if (arg === '--to') args.to = value();
    else if (arg.startsWith('--to=')) args.to = arg.slice('--to='.length);
    else if (arg === '--token') args.token = value();
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (args.help) return args;
  if (!args.name && !args.id) throw new Error('Pass --name <current robot type name> or --id <robot type id>');
  if (args.name && args.id) throw new Error('Pass --name or --id, not both');
  if (!args.to?.trim()) throw new Error('Pass --to <new name>');
  return args;
}

export type RenameRobotTypeOutcome = 'renamed' | 'would-rename' | 'unchanged' | 'absent' | 'refused';

interface ListedRobotType {
  id: string;
  name: string;
  actionDim?: number;
  proprioceptionDim?: number;
}

export interface RenameRobotTypeResult {
  outcome: RenameRobotTypeOutcome;
  /** The type as the instance listed it before the rename; absent when there is no such type. */
  robotType?: ListedRobotType;
  /** The name it has, or would have, afterwards. */
  to?: string;
  /** The server's sentence when it refused. */
  reason?: string;
}

export interface RenameRobotTypeOptions {
  baseUrl: string;
  name?: string;
  id?: string;
  to: string;
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

function pick(t: ListedRobotType): ListedRobotType {
  return { id: t.id, name: t.name, actionDim: t.actionDim, proprioceptionDim: t.proprioceptionDim };
}

/**
 * Rename the named robot type, or say why not. Throws only on an answer that
 * is neither a success nor one of the documented refusals.
 */
export async function renameRobotType(options: RenameRobotTypeOptions): Promise<RenameRobotTypeResult> {
  const root = apiRoot(options.baseUrl);
  const doFetch = options.fetchImpl ?? fetch;
  const to = options.to.trim().replace(/\s+/g, ' ');
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
  };

  const listUrl = `${root}/datasets/robot-types`;
  const list = await doFetch(listUrl, { headers });
  if (!list.ok) throw new Error(`GET ${listUrl} answered ${list.status}: ${await errorText(list)}`);
  const all = ((await list.json()) as { robotTypes?: ListedRobotType[] }).robotTypes ?? [];
  // Exact match only: a near miss must never rename the wrong type.
  const found = all.find((t) => (options.id ? t.id === options.id : t.name === options.name));
  if (!found) {
    // A second run: the old name is gone and the new one is there.
    const already = options.name ? all.find((t) => t.name === to) : undefined;
    return already ? { outcome: 'unchanged', robotType: pick(already), to } : { outcome: 'absent' };
  }
  const robotType = pick(found);
  if (found.name === to) return { outcome: 'unchanged', robotType, to };
  if (options.dryRun) {
    // The refusals a dry run can foresee, so that it does not promise a rename
    // the server then refuses: a name another type has (read off the list), and
    // a standard type — the list does not mark those, so this build's own set
    // of names stands in for the server's.
    if (STANDARD_ROBOT_TYPES.some((t) => t.name === found.name)) {
      return { outcome: 'refused', robotType, to, reason: `"${found.name}" is a standard robot type and cannot be renamed` };
    }
    const clash = all.find((t) => t.id !== found.id && t.name.trim().toLowerCase() === to.toLowerCase());
    return clash
      ? { outcome: 'refused', robotType, to, reason: `A robot type named "${clash.name}" already exists; pick another name` }
      : { outcome: 'would-rename', robotType, to };
  }

  const url = `${listUrl}/${encodeURIComponent(found.id)}`;
  const res = await doFetch(url, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: to }),
  });
  if (res.ok) return { outcome: 'renamed', robotType, to };
  if (res.status === 409 || res.status === 400) {
    return { outcome: 'refused', robotType, to, reason: await errorText(res) };
  }
  if (res.status === 404) {
    const reason = await errorText(res);
    // The type's own 404 means someone removed it meanwhile; any other 404 is a server without the route.
    if (/robot type not found/i.test(reason)) return { outcome: 'absent' };
    throw new Error(
      `PATCH ${url} answered 404 — this server has no robot-type rename route. Deploy a build that includes TASK-493 first.`,
    );
  }
  throw new Error(`PATCH ${url} answered ${res.status}: ${await errorText(res)}`);
}

const USAGE =
  'Usage: npm run rename:robot-type -- --name <current name> --to <new name> [--base-url <url>] [--dry-run] [--token <jwt>]';

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return;
  }
  const wanted = args.name ?? args.id ?? '';
  console.log(`Robot type "${wanted}" → "${args.to}" on ${args.baseUrl}${args.dryRun ? ' (dry run)' : ''}`);
  const result = await renameRobotType({ ...args, to: args.to ?? '' });
  const widths = result.robotType ? ` (${result.robotType.proprioceptionDim} / ${result.robotType.actionDim})` : '';
  const arrow = result.to && result.robotType && result.robotType.name !== result.to ? ` → ${result.to}` : '';
  console.log(
    `  ${result.outcome.padEnd(12)} ${result.robotType?.name ?? wanted}${arrow}${widths}${result.reason ? ` — ${result.reason}` : ''}`,
  );
  if (result.outcome === 'refused' || result.outcome === 'absent') process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
