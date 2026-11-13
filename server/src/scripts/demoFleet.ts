/**
 * @file demoFleet.ts
 * @description The three demo robots (TASK-477) and the idempotent sync that
 *              puts them on a running instance through its public API.
 * @feature robots
 *
 * Driven by `seed-demo-fleet.ts`. Kept apart from it so the logic can be tested
 * against a fake `fetch` and against the real routes.
 *
 * What it guarantees:
 * - **No duplicates.** Each robot has a fixed id and goes through
 *   `PUT /api/robots/:id/expected`, which creates or updates that one row.
 * - **It only touches its own rows.** A robot is "ours" when it carries
 *   `metadata.seededBy = 'demo-fleet'` and is still an expected robot. Anything
 *   else under one of these ids — a robot whose agent has registered, a row
 *   another seed wrote — is reported as skipped and left exactly as it is. The
 *   server enforces the first half on its own (409).
 * - **A repeat run writes nothing** when the rows already match.
 */

/** Ownership marker on every row this sync writes. */
export const DEMO_FLEET_MARKER = 'demo-fleet';

export interface DemoRobot {
  id: string;
  name: string;
  model: string;
  provisioning: 'awaiting_agent' | 'arriving';
  /** One sentence shown on the robot's card and page; omit when the state says it all. */
  note?: string;
  capabilities: string[];
  metadata: Record<string, string | number | boolean>;
  /**
   * Name of the standard robot type (`seedStandardRobotTypes.ts`) this robot is
   * one of. Also written as `metadata.robotTypeName`, the explicit link the
   * server reads (`robotTypeLink.ts`, TASK-485) — the model string alone does
   * not say it: "Pollen Robotics Microduck" is not the type name "Microduck".
   */
  robotTypeName: string;
}

export const DEMO_FLEET: readonly DemoRobot[] = [
  {
    id: 'demo-g1-dex3',
    name: 'Unitree G1 with Dex3 hands',
    model: 'Unitree G1 EDU (Dex3-1)',
    provisioning: 'awaiting_agent',
    capabilities: ['bipedal locomotion', 'dexterous manipulation', 'VR teleoperation', 'data collection'],
    metadata: {
      manufacturer: 'Unitree',
      // The app's 3D viewer key: G1 body with Dex3-1 three-finger hands.
      robotType: 'g1_edu',
      degreesOfFreedom: 43,
      robotTypeName: 'Unitree G1 EDU (Dex3-1)',
      seededBy: DEMO_FLEET_MARKER,
    },
    robotTypeName: 'Unitree G1 EDU (Dex3-1)',
  },
  {
    id: 'demo-so101',
    name: 'SO-101',
    model: 'SO-101 Follower',
    provisioning: 'awaiting_agent',
    capabilities: ['tabletop manipulation', 'leader-arm teleoperation', 'data collection'],
    metadata: {
      manufacturer: 'TheRobotStudio',
      robotType: 'so101',
      degreesOfFreedom: 6,
      robotTypeName: 'SO-101 Follower',
      powerSource: 'ac_powered',
      seededBy: DEMO_FLEET_MARKER,
    },
    robotTypeName: 'SO-101 Follower',
  },
  {
    // Pollen Robotics / Hugging Face Microduck: 25 cm, under 800 g, fifteen
    // servos, RK3566, RL policies at 50 Hz (pollen-robotics/microduck). Nothing
    // here claims more than the maker has published.
    id: 'demo-microduck',
    name: 'MicroDuck',
    model: 'Pollen Robotics Microduck',
    provisioning: 'arriving',
    note: 'On order from Pollen Robotics. Specs are from the public announcement.',
    capabilities: ['bipedal locomotion'],
    metadata: {
      manufacturer: 'Pollen Robotics',
      degreesOfFreedom: 15,
      robotTypeName: 'Microduck',
      seededBy: DEMO_FLEET_MARKER,
    },
    robotTypeName: 'Microduck',
  },
];

export type DemoFleetOutcome =
  | 'created'
  | 'updated'
  | 'unchanged'
  | 'removed'
  | 'absent'
  | 'skipped'
  | 'would-create'
  | 'would-update'
  | 'would-remove';

export interface DemoFleetResult {
  id: string;
  name: string;
  outcome: DemoFleetOutcome;
  /** Why a robot was skipped. */
  reason?: string;
}

export interface DemoFleetOptions {
  /** Origin of the instance, e.g. `https://neodem.emai.dev` (with or without `/api`). */
  baseUrl: string;
  /** Remove our rows instead of writing them. */
  remove?: boolean;
  /** Report what would change, write nothing. */
  dryRun?: boolean;
  /** Bearer token for an instance with auth on. */
  token?: string;
  /** Robots to sync; defaults to the whole demo fleet. */
  robots?: readonly DemoRobot[];
  fetchImpl?: typeof fetch;
}

interface StoredRobot {
  name?: unknown;
  model?: unknown;
  capabilities?: unknown;
  metadata?: Record<string, unknown> | null;
}

/** `https://host`, `https://host/` and `https://host/api` all mean the same instance. */
export function apiRoot(baseUrl: string): string {
  const url = new URL(baseUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`--base-url must be an http(s) URL, got "${baseUrl}"`);
  }
  const path = url.pathname.replace(/\/+$/, '').replace(/\/api$/, '');
  return `${url.origin}${path}/api`;
}

/** What `PUT …/expected` takes for one demo robot. */
export function expectedRobotBody(robot: DemoRobot): Record<string, unknown> {
  return {
    name: robot.name,
    model: robot.model,
    provisioning: robot.provisioning,
    ...(robot.note ? { note: robot.note } : {}),
    capabilities: robot.capabilities,
    metadata: robot.metadata,
  };
}

/** Whether a stored row is one this sync wrote and may still rewrite. */
export function isOurs(stored: StoredRobot): boolean {
  const metadata = stored.metadata ?? {};
  return metadata.seededBy === DEMO_FLEET_MARKER && typeof metadata.provisioning === 'string';
}

function sameJson(a: unknown, b: unknown): boolean {
  const canon = (value: unknown): unknown =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([x], [y]) => x.localeCompare(y)).map(([k, v]) => [k, canon(v)]))
      : value;
  return JSON.stringify(canon(a)) === JSON.stringify(canon(b));
}

/** Whether the stored row already says everything the demo robot would write. */
export function matches(stored: StoredRobot, robot: DemoRobot): boolean {
  const wanted = {
    ...robot.metadata,
    provisioning: robot.provisioning,
    ...(robot.note ? { provisioningNote: robot.note } : {}),
  };
  return (
    stored.name === robot.name &&
    stored.model === robot.model &&
    sameJson(stored.capabilities, robot.capabilities) &&
    sameJson(stored.metadata ?? {}, wanted)
  );
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
 * Bring the instance's demo robots in line with {@link DEMO_FLEET} — or, with
 * `remove`, take our rows off again. Throws on anything that is not one of the
 * expected answers, so a half-applied run is loud.
 */
export async function syncDemoFleet(options: DemoFleetOptions): Promise<DemoFleetResult[]> {
  const root = apiRoot(options.baseUrl);
  const doFetch = options.fetchImpl ?? fetch;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
  };
  const results: DemoFleetResult[] = [];

  for (const robot of options.robots ?? DEMO_FLEET) {
    const url = `${root}/robots/${encodeURIComponent(robot.id)}`;
    const report = (outcome: DemoFleetOutcome, reason?: string) =>
      results.push({ id: robot.id, name: robot.name, outcome, ...(reason ? { reason } : {}) });

    const current = await doFetch(url, { headers });
    if (current.status !== 200 && current.status !== 404) {
      throw new Error(`GET ${url} answered ${current.status}: ${await errorText(current)}`);
    }
    const stored = current.status === 200 ? ((await current.json()) as StoredRobot) : null;

    if (stored && !isOurs(stored)) {
      report('skipped', 'a robot with this id exists and was not created by this script');
      continue;
    }

    if (options.remove) {
      if (!stored) {
        report('absent');
      } else if (options.dryRun) {
        report('would-remove');
      } else {
        const res = await doFetch(url, { method: 'DELETE', headers });
        if (!res.ok) throw new Error(`DELETE ${url} answered ${res.status}: ${await errorText(res)}`);
        report('removed');
      }
      continue;
    }

    if (stored && matches(stored, robot)) {
      report('unchanged');
      continue;
    }
    if (options.dryRun) {
      report(stored ? 'would-update' : 'would-create');
      continue;
    }

    const res = await doFetch(`${url}/expected`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(expectedRobotBody(robot)),
    });
    if (res.status === 409) {
      // An agent registered under this id between the read and the write.
      report('skipped', await errorText(res));
    } else if (res.status === 404) {
      throw new Error(
        `PUT ${url}/expected answered 404 — this server has no expected-robot route. Deploy a build that includes TASK-477 first.`,
      );
    } else if (!res.ok) {
      throw new Error(`PUT ${url}/expected answered ${res.status}: ${await errorText(res)}`);
    } else {
      report(res.status === 201 ? 'created' : 'updated');
    }
  }
  return results;
}

/** Standard robot-type names the demo fleet relies on that the instance does not have. */
export async function missingRobotTypes(options: DemoFleetOptions): Promise<string[]> {
  const doFetch = options.fetchImpl ?? fetch;
  const res = await doFetch(`${apiRoot(options.baseUrl)}/datasets/robot-types`, {
    headers: {
      Accept: 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`GET robot types answered ${res.status}: ${await errorText(res)}`);
  const body = (await res.json()) as { robotTypes?: Array<{ name?: unknown }> };
  const have = new Set((body.robotTypes ?? []).map((t) => t.name));
  return (options.robots ?? DEMO_FLEET).map((r) => r.robotTypeName).filter((name) => !have.has(name));
}
