/**
 * @file demoFleetSites.ts
 * @description Puts the demo robots on a site (TASK-493): finds the site, names
 *              each robot's planned place on it, and binds the robots to it —
 *              through the public API, idempotently, like `demoFleet.ts`.
 * @feature robots
 *
 * Without this every demo robot is listed under "No site" and the site map of
 * a seeded instance is an empty warehouse.
 *
 * How a robot gets onto a site map, and what this file does about each half:
 * - **The site** is `Robot.twinId`, written by `PATCH /api/robots/:id {twinId}`
 *   (the "Site" select on a robot's Details tab). {@link assignDemoSites} sends
 *   exactly that.
 * - **The position** is the robot's own: its agent reports a pose, and the map
 *   draws it only when that pose is in the site's frame (`siteAligned`). An
 *   expected robot has no agent and therefore no pose, and none is invented
 *   here. Instead {@link placeDemoRobots} writes `metadata.plannedPlace` — the
 *   name of a zone — and the site map draws such a robot in that zone as a
 *   dashed outline marked "planned", next to a "Not connected" / "Arriving"
 *   tag. When the real robot registers under the id, the agent's metadata
 *   replaces the row's, the planned place is gone, and the robot is drawn where
 *   it says it is.
 */

import { DEMO_FLEET, apiRoot, isOurs, type DemoFleetOptions, type DemoRobot } from './demoFleet.js';

/**
 * Where each demo robot is meant to stand: `placeType`s of the site's zones
 * (or a zone `type`, for a work cell), most wanted first.
 */
export const DEMO_PLANNED_PLACE_TYPES: Readonly<Record<string, readonly string[]>> = {
  'demo-g1-dex3': ['staging', 'workcell'],
  'demo-so101': ['staging', 'workcell'],
  // Not delivered yet: where a delivery comes in.
  'demo-microduck': ['dock', 'staging'],
};

export interface DemoSiteZone {
  name: string;
  type: string;
  placeType: string | null;
}

export interface DemoSite {
  id: string;
  name: string;
  zones: DemoSiteZone[];
}

export type DemoSiteResolution =
  | { site: DemoSite }
  /** Nothing to bind to, and why — one clause for the operator. */
  | { site: null; reason: string };

type ApiOptions = Pick<DemoFleetOptions, 'baseUrl' | 'token' | 'fetchImpl'>;

function authHeaders(options: Pick<DemoFleetOptions, 'token'>): Record<string, string> {
  return {
    Accept: 'application/json',
    ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
  };
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
 * The site the demo robots belong on: the one `wanted` names (by exact name or
 * id), else the instance's only site. Several sites and no name is not guessed
 * at — the caller is told to pass one. An unknown name throws.
 */
export async function resolveDemoSite(options: ApiOptions & { wanted?: string }): Promise<DemoSiteResolution> {
  const root = apiRoot(options.baseUrl);
  const doFetch = options.fetchImpl ?? fetch;
  const headers = authHeaders(options);

  const listUrl = `${root}/digital-twins`;
  const list = await doFetch(listUrl, { headers });
  if (list.status === 404) return { site: null, reason: 'this server has no sites' };
  if (!list.ok) throw new Error(`GET ${listUrl} answered ${list.status}: ${await errorText(list)}`);
  const twins = (await list.json()) as unknown;
  const sites = (Array.isArray(twins) ? (twins as Array<{ id?: unknown; name?: unknown }>) : []).flatMap((t) =>
    typeof t.id === 'string' && typeof t.name === 'string' ? [{ id: t.id, name: t.name }] : [],
  );
  const named = sites.map((t) => `"${t.name}"`).join(', ');

  let chosen: { id: string; name: string } | undefined;
  if (options.wanted) {
    chosen = sites.find((t) => t.id === options.wanted || t.name === options.wanted);
    if (!chosen) {
      throw new Error(
        `No site named "${options.wanted}" on this instance. ${sites.length ? `It has: ${named}.` : 'It has no sites.'}`,
      );
    }
  } else if (sites.length === 0) {
    return { site: null, reason: 'this instance has no site yet' };
  } else if (sites.length > 1) {
    return { site: null, reason: `this instance has ${sites.length} sites (${named}); pass --site <name> to pick one` };
  } else {
    chosen = sites[0];
  }

  const zonesUrl = `${listUrl}/${encodeURIComponent(chosen.id)}/zones`;
  const zonesRes = await doFetch(zonesUrl, { headers });
  if (!zonesRes.ok) throw new Error(`GET ${zonesUrl} answered ${zonesRes.status}: ${await errorText(zonesRes)}`);
  const raw = (await zonesRes.json()) as unknown;
  const zones = (
    Array.isArray(raw) ? (raw as Array<{ name?: unknown; type?: unknown; metadata?: { placeType?: unknown } | null }>) : []
  ).flatMap((z) =>
    typeof z.name === 'string'
      ? [
          {
            name: z.name,
            type: typeof z.type === 'string' ? z.type : '',
            placeType: typeof z.metadata?.placeType === 'string' ? z.metadata.placeType : null,
          },
        ]
      : [],
  );
  return { site: { ...chosen, zones } };
}

/** The zone of `site` this robot is planned to stand in, or null when none fits. Never a keep-out. */
export function plannedPlaceFor(robotId: string, site: DemoSite): string | null {
  const open = site.zones.filter((z) => z.type !== 'keepout').sort((a, b) => a.name.localeCompare(b.name));
  for (const wanted of DEMO_PLANNED_PLACE_TYPES[robotId] ?? []) {
    const zone = open.find((z) => z.placeType === wanted || z.type === wanted);
    if (zone) return zone.name;
  }
  return null;
}

/**
 * The fleet as it should be written for this site: each robot with
 * `metadata.plannedPlace` when the site has a zone for it. Without a site the
 * robots come back as they are — so a run without one also clears a planned
 * place an earlier run wrote, because the row no longer matches.
 */
export function placeDemoRobots(robots: readonly DemoRobot[], site: DemoSite | null): DemoRobot[] {
  return robots.map((robot) => {
    const place = site ? plannedPlaceFor(robot.id, site) : null;
    return place ? { ...robot, metadata: { ...robot.metadata, plannedPlace: place } } : robot;
  });
}

/**
 * For `--no-site`: each robot as the fleet defines it, plus the planned place
 * its row already carries — so a run that is told to leave sites alone does
 * not clear one either.
 */
export async function keepPlannedPlaces(robots: readonly DemoRobot[], options: ApiOptions): Promise<DemoRobot[]> {
  const root = apiRoot(options.baseUrl);
  const doFetch = options.fetchImpl ?? fetch;
  const kept: DemoRobot[] = [];
  for (const robot of robots) {
    const res = await doFetch(`${root}/robots/${encodeURIComponent(robot.id)}`, { headers: authHeaders(options) });
    const stored = res.ok ? ((await res.json()) as StoredRobot) : null;
    const place = stored?.metadata?.plannedPlace;
    kept.push(typeof place === 'string' ? { ...robot, metadata: { ...robot.metadata, plannedPlace: place } } : robot);
  }
  return kept;
}

export type DemoSiteOutcome = 'assigned' | 'unchanged' | 'would-assign' | 'absent' | 'skipped';

export interface DemoSiteResult {
  id: string;
  name: string;
  outcome: DemoSiteOutcome;
  /** Why a robot was skipped, or what the map shows for it. */
  reason?: string;
}

export interface AssignDemoSitesOptions extends ApiOptions {
  site: DemoSite;
  /** The demo robots to bind; defaults to the whole demo fleet. */
  robots?: readonly DemoRobot[];
  /** `--site` was passed: a demo robot bound to another site is moved, not left. */
  siteIsExplicit?: boolean;
  /** Ids of existing robots (not the script's own) to bind to the site as well. */
  also?: readonly string[];
  dryRun?: boolean;
}

interface StoredRobot {
  name?: unknown;
  twinId?: unknown;
  metadata?: Record<string, unknown> | null;
}

/**
 * Bind the demo robots — and any robot named in `also` — to `site`. Only the
 * binding is written, never a pose. A demo robot that is not the script's own
 * is skipped, as in `syncDemoFleet`; one an operator bound to another site
 * stays there unless the site was named explicitly. A robot named in `also` is
 * the operator's explicit choice and is always bound.
 */
export async function assignDemoSites(options: AssignDemoSitesOptions): Promise<DemoSiteResult[]> {
  const root = apiRoot(options.baseUrl);
  const doFetch = options.fetchImpl ?? fetch;
  const headers = authHeaders(options);
  const results: DemoSiteResult[] = [];
  const demo = options.robots ?? DEMO_FLEET;

  const targets = [
    ...demo.map((r) => ({ id: r.id, name: r.name, demo: true })),
    ...[...new Set(options.also ?? [])]
      .filter((id) => !demo.some((r) => r.id === id))
      .map((id) => ({ id, name: id, demo: false })),
  ];

  for (const target of targets) {
    const url = `${root}/robots/${encodeURIComponent(target.id)}`;
    const current = await doFetch(url, { headers });
    if (current.status !== 200 && current.status !== 404) {
      throw new Error(`GET ${url} answered ${current.status}: ${await errorText(current)}`);
    }
    const stored = current.status === 200 ? ((await current.json()) as StoredRobot) : null;
    const name = typeof stored?.name === 'string' ? stored.name : target.name;
    const report = (outcome: DemoSiteOutcome, reason?: string) =>
      results.push({ id: target.id, name, outcome, ...(reason ? { reason } : {}) });

    if (!stored) {
      // A demo robot that a dry run has not created would be bound right after it was.
      if (target.demo && options.dryRun) report('would-assign');
      else report('absent', target.demo ? undefined : 'no robot with this id');
      continue;
    }
    if (target.demo && !isOurs(stored)) {
      report('skipped', 'a robot with this id exists and was not created by this script');
      continue;
    }
    if (stored.twinId === options.site.id) {
      report('unchanged');
      continue;
    }
    if (target.demo && typeof stored.twinId === 'string' && stored.twinId && !options.siteIsExplicit) {
      report('skipped', 'bound to another site; pass --site to move it');
      continue;
    }
    // What the map can honestly show for a robot this script does not own.
    const note = target.demo ? undefined : 'the map lists it as "not aligned" until its agent reports a pose in the site frame';
    if (options.dryRun) {
      report('would-assign', note);
      continue;
    }
    const res = await doFetch(url, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ twinId: options.site.id }),
    });
    if (!res.ok) throw new Error(`PATCH ${url} answered ${res.status}: ${await errorText(res)}`);
    report('assigned', note);
  }
  return results;
}
