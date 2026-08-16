---
id: TASK-207
aliases:
- TASK-207
title: Robots see each other — fleet poses flow to every agent and the map is rendered on the Agent Mode page
slug: robots-see-each-other-on-the-map
status: done
priority: 2
owner: ''
projects: []
customers: []
tags:
- core
- agentmode
- fleet
- g1
sprint: ''
depends_on:
- '[[TASK-206]]'
due_date: ''
created: 2026-08-15
updated: 2026-08-16
completed: 2026-08-16
status_note: |
  DONE 2026-08-16 — PR #225. Verified 2026-08-16: `GET /api/robots/:id/peers` + on-demand pose refresh, `location.frame`, PeerTracker (frame gate, expiry, drop count), dynamic-obstacle overlay, fleet scene entities, server map proxy, RobotMapPanel on /agent (Map tab of the Knowledge card, not a separate panel — functionally the spec), fleet-map deep link. Tests pass in all three packages.
  FIXED IN REVIEW (08c5aff): `refreshPoses` awaited every agent with the generic 5 s budget while PeerTracker's client timeout is 2 s — one hung agent blanked every other robot's peers; now its own 750 ms budget. Fleet-map "Open robot's map" is keyboard-operable. The Zone (fleet AABB) vs TwinZone/keepout (polygon) reconciliation gap the task asked to note is now in robot-agent/AGENTS.md.
  NOT RE-RUN: the two-sim-robots recipe (README) — the peers path is covered by unit tests + the server route tests only in this pass.
  POST-MERGE PASS 2026-08-16: peers verified live with a SECOND robot (Bravo on :41247 + a second MuJoCo sim on :8778) — A sees B on its map with the new poseAgeMs. Fixed here: refreshPoses starved the health check's DB write so Robot.location stopped being persisted (fleet map stale after reload); getPeers read the tenant-unscoped startup cache (cross-tenant enumeration with MULTI_TENANCY on) and now fails closed; a peer whose agent went silent stayed a phantom obstacle ~30 s (expiry now on the pose's own age); the fleet map's SVG buttons (marker, popup close, VIEW DETAILS) were mouse-only despite role=button/tabIndex.
---


# Robots see each other — fleet poses flow to every agent and the map is rendered on the Agent Mode page

## Description

Today only the operator sees the fleet: `FleetMap.tsx` plots robots from the server's cache, but a
robot never learns where any other robot is, and nobody sees the map the robot itself builds
(TASK-206). This task (a) publishes fleet poses to each agent so a robot's occupancy map carries the
other robots as dynamic obstacles, and (b) renders the robot-owned map — walls, keepouts, self, and
peers — on the `/agent` page.

Second of three: TASK-206 (map) → **TASK-207 (peers + UI)** → TASK-208 (plan on it).

## Details

### Current state (survey 2026-08-15)

- The server already knows every robot's pose: `server/src/services/RobotManager.ts:640-655` polls
  each agent's `GET /api/v1/robots/:id` and diffs `location.{x,y,zone}`; `listRobots()` :473;
  `GET /api/robots` (`server/src/routes/robot.routes.ts:55`) lists them. Frames are **not**
  reconciled — `location.x/y` is whatever the agent wrote (odometry, `robot/state.ts:597-604`).
- The agent's complete outbound server calls are `/api/robots/register`, `/api/zones`
  (`tools/navigation.ts:78`), `/api/updates`, `/api/compliance/*`, `/api/processes/tasks/*`,
  `/api/digital-twins/:id/places/_index.json` (`place-graph-source.ts:80`),
  `/api/robots/:id/agent-mode/events` (`server-mirror.ts:75`), `/api/federated`. **Nothing fetches
  peers.**
- Two disjoint operator "area maps": fleet `Zone` (AABB rectangles, `app/src/features/fleet/`,
  `server/src/services/ZoneService.ts`, types operational/restricted/charging/maintenance, weakly
  enforced — `tools/navigation.ts:187 validateDestinationZone` refuses only a *destination* inside
  `restricted`) and `TwinZone` polygons (`app/src/features/digitaltwin/`, keepout/room/… →
  place graph → enforced by `geofence.ts`). They share no key.
- Agent Mode UI: `app/src/features/agentmode/pages/AgentModePage.tsx`, `components/ScenePanel.tsx`
  (bearings/distances list, no spatial view), `hooks/useAgentModeSocket.ts`; store
  `store/agentmodeStore.ts`. Server relay: `server/src/routes/agent-mode.routes.ts`
  (`GET /:id/agent-mode/scene` :237 proxies the agent).

### Frame caveat — read before designing

Two robots' odometry frames are only comparable when both are registered to a common frame. In the
sim they are (`place-frame.ts` treats `frame.kind === 'sim'` as identity; both robots boot at MJCF
world origin). On real hardware they are **not** until someone builds registration (out of scope
here and in TASK-206). Therefore every peer pose carries its `frame` and the consumer **drops peers
whose frame differs from its own** and reports how many it dropped — never silently draws a peer in
the wrong place. This is the same fail-closed rule `place-graph-source.ts:143 assertTwin` uses.

### What to build

#### Server

1. **`GET /api/robots/:id/peers`** in `server/src/routes/robot.routes.ts` — for the calling robot,
   return every *other* online robot as `{robotId, name, x, y, headingDeg, frame, place, zone,
   updatedAt, footprintRadiusM}` (`footprintRadiusM` from the embodiment, default 0.35). Source:
   `RobotManager.listRobots()`; `frame` = the value the agent reports (add it to the payload the
   agent already serves at `/api/v1/robots/:id`, see step 3). Cheap, in-memory, no DB call; auth
   via the existing robot token path.
2. **WS fan-out (optional, cheap)** — `server/src/websocket/index.ts` already emits robot
   `location` changes to the UI; nothing new is needed for the operator view. Do NOT push to agents
   over WS in this task; polling is fine (see step 4).

#### Robot Agent

3. **Report the odometry frame** in the payload `RobotManager` polls (`robot-agent/src/api/`
   robots route): `location.frame: {kind:'sim'|'odom', id}` — reuse the frame id TASK-206 uses for
   map validity so peers and map agree.
4. **`robot-agent/src/agent-mode/peers.ts`** (new) — `PeerTracker`: poll `GET
   /api/robots/:id/peers` every `AGENT_PEERS_POLL_MS` (default 2000, same cadence as the pose
   poll; 0 = off), keep the last frame per peer, drop peers with a foreign `frame` (count them),
   expire a peer after `3 × poll` without update. Pure state + one fetch; no LLM.
5. **Dynamic layer on the map** — `OccupancyMap` (TASK-206) gets an **overlay** API, not a write into
   the log-odds grid: `setDynamicObstacles([{x,y,radiusM,label}])`; `isTraversable()` consults the
   overlay after the static grid. Peers go in as discs of `footprintRadiusM + 0.25`. This keeps the
   static map from "remembering" a robot that has since driven away.
6. **Scene memory + planner awareness (small)** — when a peer is within `AGENT_PEERS_NOTICE_M`
   (default 3 m) and inside ±90° of heading, add it to `SceneMemory` as an entity
   `{label:'robot <name>', distanceSource:'fleet', bearingDeg, distanceM}` (extend the
   `distanceSource` union on all three mirrored types with `'fleet'`, optional field, wire-safe).
   The planner prompt (`prompts.ts`) already lists scene entities, so "wave at the other robot"
   starts working for free; no new block type.
7. **`GET /api/v1/robots/:id/map`** (from TASK-206) additionally returns `peers: [...]` and
   `peersDropped: n` (foreign frame). Expose the same through the server as
   `GET /api/robots/:id/agent-mode/map` in `server/src/routes/agent-mode.routes.ts` (proxy the agent
   exactly like `/scene` :237 does; 5 s timeout; 502 with the agent's error text on failure — never
   an empty map).

#### Frontend — the map on `/agent`

8. **`app/src/features/agentmode/components/RobotMapPanel.tsx`** (new): a canvas/SVG top-down view,
   robot-centred, north-up toggle, showing: occupancy cells (unknown = transparent, free = faint,
   occupied = solid), the keepout polygons from the payload (red outline, hatched — same colour
   token the twin `ZoneVolumes.tsx` uses for keepout), the robot as a heading triangle, peers as
   labelled discs, the current place name chip (reuse `PlaceChip.tsx`), and a footer
   "frame: odom · N peers · M dropped (different frame)". Poll `GET /agent-mode/map` at 1 Hz while
   the panel is visible; stop when hidden. Store slice in `agentmodeStore.ts` (`map`, `mapError`);
   fetch in `api/` next to the existing scene call.
9. **Place it** in `AgentModePage.tsx` beside `ScenePanel` (desktop: right rail; mobile: collapsible
   below the timeline). Empty state copy when the agent is older / map disabled: "This robot does not
   publish a map (AGENT_MAP_ENABLED)". Respect `conditions.ts` — this panel adds **no** new amber/red
   condition; a stale map is grey text, not a warning chip.
10. **Fleet map link** — `app/src/features/fleet/pages/FleetPage.tsx` robot marker popover: add
    "open robot's map" → `/agent?robot=<id>` (the page already accepts a robot selection).

### Key files

- new: `robot-agent/src/agent-mode/peers.ts` (+ `__tests__/peers.test.ts`),
  `app/src/features/agentmode/components/RobotMapPanel.tsx` (+ test)
- modify: `server/src/routes/robot.routes.ts`, `server/src/routes/agent-mode.routes.ts`,
  `robot-agent/src/agent-mode/occupancy-map.ts` (overlay), `agent-mode-controller.ts`,
  `scene-memory.ts`, `types.ts` + the two mirrors (`distanceSource` union, optional),
  `robot-agent/src/config/config.ts` (`AGENT_PEERS_POLL_MS`, `AGENT_PEERS_NOTICE_M`),
  `app/src/features/agentmode/{pages/AgentModePage.tsx,store/agentmodeStore.ts,api/*}`,
  `app/src/features/fleet/pages/FleetPage.tsx`

### Out of scope

- Reconciling fleet `Zone` rectangles with `TwinZone` polygons (separate task; note it in the
  README of whichever you touch).
- Cross-robot frame registration on real hardware; multi-floor.
- Path planning around peers (TASK-208 — this task only makes them *visible* and *traversability-
  blocking*).
- Pushing peers over WebSocket to agents.

## Test Strategy

Unit: `PeerTracker` drops a foreign-frame peer and counts it; expires a silent peer after 3 polls;
`OccupancyMap.isTraversable()` is false inside a peer disc and true again after the overlay is
cleared; scene entity for a peer only within notice radius and forward half-plane.

Integration (sim, two robots): start `sim_node.py` twice on domain 1 with two robot ids (the sim
supports one robot per process; run two processes on different HTTP ports and register both agents
with the server), drive robot A 2 m forward, then `GET /api/robots/B/peers` shows A at ±0.1 m of its
odometry, and `GET /api/robots/B/agent-mode/map` returns A in `peers` and `peersDropped: 0`. Change
A's reported frame id → B reports `peersDropped: 1` and does not draw A.

Frontend (Playwright): the map panel renders cells, keepouts, self and peer; empty state on an
agent that returns 404 for `/map`; no new condition chip appears (`conditions.test.ts` count is
unchanged); mobile layout collapses.

Regression: vitest all three components, typecheck, `demo_clip.py` clip unchanged.
