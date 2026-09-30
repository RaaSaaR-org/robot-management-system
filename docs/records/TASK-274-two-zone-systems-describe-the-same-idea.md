# TASK-274 — Two zone systems describe the same idea

**Date:** 2026-09-30
**Task:** `.mc/tasks/todo/TASK-274-two-zone-systems-describe-the-same-idea.md`
**Follow-up filed:** `.mc/tasks/todo/TASK-325-align-a-robot-s-odometry-frame-with-its-twin.md`
**Hand-off:** run `/plan` on TASK-274 — epic, several slices

Immutable once committed. Later changes of mind get their own record.

## How this was decided

Grilled interactively with the user (huhn511), one question at a time. Every
decision below was confirmed by the user on 2026-09-30. Where the user overrode the
agent, it is marked **Owner: user (override)**.

**Supersedes:** the TASK-273 record (`docs/records/TASK-273-cut-the-navigation-from-23-rows-to-10.md`,
line ~111), which rejected unifying the two zone models and filed this task, and the
TASK-200 task file's note that the fleet `Zone` is unrelated. That record stays
unedited; this one replaces its zone conclusion.

## The user's vision

One digital twin where you can really see the room. Zones are drawn in the twin and
named — to say more about where the robot is, or to mark areas the robot must not
enter.

## Facts established before deciding

| Fact | Why it mattered |
| ---- | --------------- |
| Fleet `Zone` is a 2D box in map units (`FleetMap` `SCALE = 10` px/unit), no metres, no frame | Q1: its rows cannot be carried into a metric twin |
| `TwinZone` is already the sole source for Nav2/VDA5050 export and, since TASK-200, the place graph | Q1: the survivor already feeds the enforced paths |
| Dev DB holds only the 8 seed zones | Q1: dropping the table loses nothing |
| A draft `DigitalTwin` with no scan is allowed; `ZoneAuthoringOverlay.deriveWorldBounds` falls back to a 12 m square around `worldOrigin` | Q1: "no scan yet" is not a reason to keep flat zones |
| `place-frame.ts` marks any twin graph UNREGISTERED — odometry origin and twin origin are unrelated | Q2: real robots cannot be fenced by twin zones yet |

## Decisions

### Q1 — Which model survives

**Chosen:** `TwinZone` is the only zone model. Remove the flat `Zone` table,
`/api/zones` (incl. `named-locations`, `at-point`), `ZoneService`/`ZoneRepository`,
the SVG FleetMap and its zone editor, and `seedZones.ts`. Every reader moves to
TwinZone. Rewrite the "do NOT merge with the fleet `Zone`" schema comment. The
migration drops the table; breaking change noted for release notes.
**Rejected:** a read-only `/api/zones` view derived from TwinZone; keeping both and
editing only in the twin; not unifying at all — each keeps two systems alive, and the
flat map has no real units.
**Owner:** user (confirmed).

### Q2 — Frame alignment

**Chosen:** alignment of robot odometry to the twin frame is a **follow-up**
(TASK-325), not part of TASK-274. In TASK-274, zone membership, named locations and
keepouts are active only for robots whose pose is declared in the twin frame (the sim
today). Real robots show "not aligned — fence not enforcing" via the TASK-201 warning.
The follow-up also lifts the `place-frame.ts` UNREGISTERED gate for aligned twins.
**Rejected:** alignment in scope (task too big); assuming odometry origin == twin
origin (a silently wrong fence).
**Owner:** user (override) on testability — the agent said alignment needed the real
G1; the user corrected that it is sim-testable: MuJoCo on the Mac (boot the sim robot
offset from the twin origin; after alignment the fence stops it at the right spot),
with Isaac Sim on the Linux machine as an optional second check. So TASK-325 is
Mac-doable.

### Q3 — Robot → site binding

**Chosen:** the server owns it: nullable `Robot.twinId` (FK to `DigitalTwin`), set in
the UI (Robots tab → "Site"). The robot agent fetches its twin's zones/places through
that binding. `PLACE_TWIN_ID` stays as a local dev/sim override; `PLACE_GRAPH_PATH`
still wins.
**Rejected:** a robot-owned env var reported upward (source of truth would stay in a
`.env`); inferring from `DigitalTwin.robotId` (that records who scanned, not where a
robot works).
**Owner:** user (confirmed).

### Q4 — Zones, places and locations

**Chosen:** every named zone except `speed` is a place — `room`, `workcell`,
`charging`, `keepout` go into the place graph with the zone type as place kind;
`speed` stays behaviour-only. `RobotLocation.zone` is removed; `location.place` is the
single answer, smallest containing zone wins on overlap. `move "Charging Station"`
resolves because it is a place. Zone E-stop, deployment `targetZones`, verification
`robotScope: 'zone'`, `roboctl --zone`, process steps, command named-locations, the
navigation tool (restricted-zone refusal → keepout-place refusal), sim zone tracking,
`INITIAL_ZONE 'Warehouse A'`, the agent card and websocket zone events all move to
place names/ids. Process steps store a place reference, not frozen centre coordinates.
**Rejected:** today's split plus a separate name lookup; two location fields (rebuilds
the two-systems problem).
**Owner:** user (confirmed).

### Q5 — The Fleet map

**Chosen:** the Fleet "Map" tab becomes a site map: site picker (remembers the last
site), top-down twin view (reusing the digitaltwin top-down rendering) with zones and
live robots, click a zone → E-stop. Robots with no site or not aligned are listed
beside the map, not plotted. The dashboard reuses the component, sized small.
**Rejected:** an all-sites overview grid (premature for 1–2 sites; can come later on
top); folding the map into the Sites page.
**Owner:** user (confirmed).

### Batched confirmations

- **Name uniqueness:** zone names unique per twin, case-insensitive, enforced in the
  DB. Replaces `(tenantId, name, floor)` — floor belongs to the twin. Names must map to
  safe place ids (`SAFE_PLACE_ID` / `ROBOT_SAFE_PLACE_ID`).
  **Rejected:** keeping the old tenant+floor uniqueness. **Owner:** user (confirmed).
- **Seed:** a "Demo Warehouse" twin whose zones match
  `robot-agent/hardware/sim_evaluator/places/places.warehouse.json`, so `npm run dev`
  + `roboctl move` + the sim work out of the box. The old 8 seed zones and the
  `'Warehouse A'` default go; docs mentioning "Warehouse A" (`CLAUDE.md` roboctl
  examples, `robot-agent/cli/README.md`) are updated.
  **Rejected:** keeping the flat seed. **Owner:** user (confirmed).

## Hand-off

Run `/plan` on TASK-274. TASK-325 (alignment) depends on it and is sized as one slice.
