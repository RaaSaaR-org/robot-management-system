# ADR-274 — Two zone systems describe the same idea

- **Status:** Accepted — implemented and merged 2026-09-30
- **Epic:** TASK-274 (closed; children TASK-326 … TASK-334, PRs #351 … #359)
- **Supersedes:** the spec body of TASK-274, distilled here so the task file can close
- **Decision record:** `docs/records/TASK-274-two-zone-systems-describe-the-same-idea.md` keeps the interview, with the alternatives each decision rejected
- **Follow-up:** TASK-325 — align a robot's odometry frame with its twin

## Context

Two models described "a named region of a site":

- the flat fleet `Zone` (`name`, `floor`, `type` `operational | restricted | charging | maintenance`,
  `bounds` `{x, y, width, height}` in map units with no metres and no frame), served by
  `/api/zones`, drawn by the SVG `FleetMap`, seeded with eight zones, and read by
  navigation, zone E-stop, deployments, verification, processes, `roboctl` and the dashboard;
- `TwinZone` on a `DigitalTwin` (polygon in metres, `minZ/maxZ`, type
  `keepout | workcell | charging | speed | room`), which already fed the place graph,
  the Nav2/VDA5050 exports and the sim — with a schema comment saying *do NOT merge with
  the fleet `Zone`*.

A robot's location carried both (`RobotLocation.zone` and `.place`), and the agent
defaulted to `'Warehouse A'`, a zone that existed only in the seed. The goal: one
digital twin in which the room is visible, zones are drawn and named, and those zones
say where a robot is or mark where it must not go.

## Decision

**`TwinZone` is the only zone model.** The fleet `Zone` table, `/api/zones` (including
`named-locations` and `at-point`), `ZoneService`/`ZoneRepository`, `seedZones.ts`, the
zone websocket events and the app's zone API/store/hooks/`FleetMap`/`Zone*` components
are deleted. Migration `20260930210000_task_334_drop_fleet_zone` drops the table —
rows carried no frame, so nothing was migrated. **Breaking:** `/api/zones` and the
`Zone` table are gone.

1. **Zone names are unique per twin, case-insensitively, in the database** — a
   normalised `nameKey` with `@@unique([twinId, nameKey])`, replacing the old
   `(tenantId, name, floor)` rule (the floor belongs to the twin). Every name must map
   to a safe place id (`ROBOT_SAFE_PLACE_ID`, mirroring the agent's `SAFE_PLACE_ID`).
2. **Every named zone except `speed` is a place.** `room`, `workcell`, `charging` and
   `keepout` enter the place graph with the zone type as place kind; only `keepout`
   is a keepout; `speed` stays behaviour-only. "Which place contains this point" is
   one server helper; the **smallest containing zone wins** on overlap.
3. **The server owns a robot's site.** `Robot.twinId` is a nullable FK to
   `DigitalTwin` (`onDelete: SetNull`), set from the Robots tab "Site" picker. The
   agent fetches its places through `GET /api/robots/:id/places`. Override order:
   `PLACE_GRAPH_PATH` > `PLACE_TWIN_ID` > `Robot.twinId`.
4. **`location.place` is a robot's only answer to where it is.** `RobotLocation.zone`,
   `setZoneCache`, the simulator's zone tracking, `zoneUtils.ts` and the
   `INITIAL_ZONE` / `'Warehouse A'` default are gone end to end.
5. **Everything that selected "robots in a zone" selects by place on the bound twin:**
   zone E-stop (`POST /api/safety/zones/:id/estop` takes a `TwinZone` id), deployment
   `targetZones`, verification `robotScope: 'zone'`. Process "Move to" steps store a
   place reference (twin id + place id) resolved at run time, not frozen coordinates;
   the command console's named locations are the robot's site places.
6. **Navigation moves to places.** The agent's `move` tool and `roboctl move "<place>"`
   (`--zone` became `--place`) resolve from the place graph and refuse a target inside
   a keepout, naming it.
7. **The Fleet "Map" tab is a site map:** a site picker that remembers the last site
   per viewer, the twin top-down with zones and live robots, click a zone to E-stop
   (with confirm). The dashboard reuses it small.
8. **A "Demo Warehouse" draft twin is seeded**, idempotently, with zones matching
   `robot-agent/hardware/sim_evaluator/places/places.warehouse.json` (places STAGING,
   CHARGING-A, CROSS-AISLE, AISLE-1..3, DOCK-1; keepouts RACK-A, RACK-B, DOCK-1-EDGE).
   Robots register at runtime, so the sim robot is bound through the Site picker,
   not by the seed.

## Scope rule: which robots see zones

Place membership, named locations and keepouts are active only for robots whose pose
is declared in the twin frame — the **sim** today, whose world origin is the twin
origin by construction, so a twin graph fetched for a sim robot counts as registered
in `place-frame.ts`. Every other robot stays UNREGISTERED: a real robot bound to a twin
shows the TASK-201 "not aligned — fence not enforcing" warning and is listed beside the
site map, not plotted. Aligning odometry to the twin and lifting that gate is TASK-325.

## How it was sliced

| Child | Slice | PR |
| ----- | ----- | -- |
| TASK-326 | Twin zones are uniquely named places | #351 |
| TASK-327 | A robot is bound to a site (+ Demo Warehouse seed) | #352 |
| TASK-328 | The agent loads its site's places through its binding | #353 |
| TASK-329 | A robot moves to a place by name and refuses keepouts | #354 |
| TASK-330 | Zone E-stop, deployments and verification target twin zones | #355 |
| TASK-331 | The fleet map is a site map | #356 |
| TASK-332 | Process steps and commands move to places | #357 |
| TASK-333 | `location.place` is a robot's only answer to where it is | #358 |
| TASK-334 | The fleet Zone model and `/api/zones` are removed | #359 |

Readers moved first (326–333) and the deletion came last (334), so no intermediate
`main` had a caller of a removed endpoint. 334 merged before 333; 333 was reconciled by
merging `main` and taking 334's deletions.

## Explicitly rejected — do not re-raise

- **A read-only `/api/zones` view derived from TwinZone**, or keeping both models and
  editing only in the twin — each keeps two systems alive, and the flat map has no
  real units.
- **Alignment in this epic**, or assuming odometry origin equals twin origin — the
  latter is a silently wrong fence. Alignment is TASK-325.
- **A robot-owned env var as the site binding** (the source of truth would live in a
  `.env`), or inferring the site from `DigitalTwin.robotId` (that records who scanned,
  not where a robot works).
- **Two location fields**, or today's split plus a name lookup — it rebuilds the
  two-systems problem.
- **An all-sites overview grid** for the map (premature for one or two sites), or
  folding the map into the Sites page.
- **Keeping the tenant + floor uniqueness** or the flat eight-zone seed.

## Consequences

- One zone model, in metres, in a frame. A zone drawn in the twin is immediately a
  place the agent can drive to, a keepout it refuses, an E-stop target, and a
  deployment/verification scope.
- Real robots get none of this until TASK-325 aligns them; until then the UI says so
  rather than plotting them wrongly.
- Operators with rows in the old `Zone` table lose them on migration; they redraw
  zones in a twin. The release notes carry the breaking change.
