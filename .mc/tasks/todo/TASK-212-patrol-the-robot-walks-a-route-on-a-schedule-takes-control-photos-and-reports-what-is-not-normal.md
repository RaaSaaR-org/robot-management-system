---
id: TASK-212
aliases:
- TASK-212
title: Patrol — the robot walks a route on a schedule, takes control photos at checkpoints, and reports what is not normal along the whole way
slug: patrol-the-robot-walks-a-route-on-a-schedule-takes-control-photos-and-reports-what-is-not-normal
status: todo
priority: 2
owner: ''
projects: []
customers: []
tags:
- core
- agentmode
- g1
- safety
- compliance
sprint: ''
depends_on:
- '[[TASK-199]]'
- '[[TASK-209]]'
- '[[TASK-211]]'
due_date: ''
created: 2026-08-16
updated: 2026-08-16
---

# Patrol — the robot walks a route on a schedule, takes control photos at checkpoints, and reports what is not normal along the whole way

## Description

Turn everything Agent Mode can already do — plan on its own map, `goto` a place by name, look with
a local VLM, remember, mirror events to the server — into the first complete **use case**:
**patrolling**. An operator defines a route as an ordered list of checkpoints on the place graph
and a schedule ("22:00 and 03:00, weekdays"). At each fire the robot walks the route, at every
checkpoint aligns to a stored heading and takes a **control photo** which is stored with the run,
and **along the whole route** — not only at checkpoints — compares what it sees (camera + lidar)
against a **baseline of "normal"** recorded on an operator-supervised baseline run. Anything that
is not normal (object on the floor, a door that is now open, a light that is on at 03:00, a
person, a crate that moved into the hallway, an item that is gone) becomes a **finding** with
evidence (baseline photo, current photo, map pose, time, model, confidence) that lands as an
**alert** in the platform, is acknowledged by a human, and — when dismissed as "that's fine" —
teaches the baseline.

This is what Boston Dynamics sells as Spot + Orbit (Autowalk missions, scene alerts, Site View)
and ANYbotics as ANYmal inspection; there is no equivalent for the G1 yet. The whole thing must
stay **local** (Ollama VLM on the robot's box), **safe** (every leg goes through the same gates as
an operator `goto`), and **GDPR-clean** (persons are detected, never identified; no photo of a
person is stored).

## Details

### Why now — what already exists (verified 2026-08-16, `feat/task-210-map-export`)

Everything below is reused, not rebuilt. Line numbers are approximate.

| Capability | Where | Reuse |
|---|---|---|
| Walk INTO a named place on the occupancy map, in stages, re-planning as the map grows | `robot-agent/src/agent-mode/navigator.ts` (`Navigator.navigateToPlace`, `placeGoal`), `path-planner.ts` (`planPath`, `checkStraightSegment`), `agent-mode-controller.ts:~822` (`runGoto` → `resolvePlaceByName`) — TASK-208/209 | **The leg primitive.** A patrol is N `goto {place}` legs plus per-checkpoint actions. |
| A planned route already **looks (VLM + lidar) at least every 2 m** | `AGENT_NAV_LOOK_EVERY_M`, `robot-agent/src/config/config.ts:~212/~495` | The en-route observation cadence for "check the whole path" is free — its output just needs to be **compared and kept** instead of dropped. |
| Places as polygons, name resolution, geofence keepouts | `place-resolver.ts` (`PlaceTracker`, `resolvePlaceByName`, `pointInPolygon`), `place-graph-source.ts` (fetches `GET /api/digital-twins/:id/places/_index.json`, `server/src/routes/twin.routes.ts:~456`), `geofence.ts` (`evaluateGeofence`) | Checkpoints reference place ids; keepouts refuse a route leg the same way they refuse a `goto`. |
| Persistent 2-D occupancy map + 3-D world cloud, restored on boot | `occupancy-map.ts`, `occupancy-map-keeper.ts` (`MapKeeper.snapshot/getCloud`), `world-cloud.ts` (`WorldCloud.purgeFreed` — TASK-211, in flight), export TASK-210 | The **geometric baseline**: cells FREE on the baseline run and OCCUPIED now = new object; `purgeFreed` already models "the chair was carried away". |
| One camera frame → structured VLM observation (`currentView`, `personVisible`, `entities[{label,bearingDeg,distanceEstM,confidence}]`), no image retention | `vision.ts` (`VisionClient.observe`, `VISION_PROMPT` in `prompts.ts:~249`), `llm.ts` (`genkitGenerate`, `agentModelRef`), `hardware/HardwareClient.ts:~736` (`snapshot(name)` → base64 JPEG from `GET /cameras/<n>/snapshot`) | The **semantic** observation. The prompt already forbids identifying faces. |
| Block vocabulary + executor + plan events mirrored to the server + one compliance record per block | `types.ts:~12` (`AgentBlockKinds` = walk, turn, goto, look, scan_room, wave, greet, posture, speak, wait, remember), `block-executor.ts`, `server-mirror.ts` (`ServerMirror` → `POST /api/robots/:id/agent-mode/events`), `types.ts:~431` (`AgentModeEventTypes`) | New `patrol`/`capture`/`inspect` blocks ride the same timeline, mirror and audit path. Contract is mirrored in `server/src/types/agent-mode.types.ts` and `app/src/features/agentmode/types/` — a three-package change. |
| Proactivity, allowed kinds, self-initiative gate, time-of-day gate, standing intents | `heartbeat.ts` (`HEARTBEAT_ALLOWED_KINDS` :47 = look/speak/wait/remember; `parseActiveHours`/`withinActiveHours`), `initiative.ts` (`mayInitiate`, `SELF_LOCOMOTION_KINDS`, `SELF_INITIATIVE_MIN_BATTERY`), `intents.ts` (`IntentStore`, `intentTriggerMatches`), `idle-watcher.ts` — TASK-199 | The **gates a patrol must pass** (battery, known fresh place, armed base, not damped, not crash-unacknowledged). `AGENT_HEARTBEAT_MOTION` exists (`config.ts:~503`) but is read nowhere except a log line (`:~633`) — a patrol is **not** a heartbeat (see decisions). Standing intents are the existing keyword-only "tell me if X" and stay as they are. |
| Durable memory with trust tiers, journal with retention/legal hold | `workspace.ts` (`MEMORY.md`, `places/<id>.md`, `TrustLevels`), `journal.ts` (`Journal`, `fetchJournalRetention`) — TASK-197 | Findings are journalled; VLM text stays `untrusted`; retention policy applies to photos too. |
| Server: alerts, incidents with stored clips, storage buckets, WS broadcast | `server/src/services/AlertService.ts:~302` (`createRobotAlert`), `IncidentService.ts:~363` (`storeClip` → `model-storage.ts:~622` `uploadIncidentClip`, bucket `incident-clips` in `BUCKETS` :16), `server/src/websocket/index.ts` (alerts :~179, `agent:*` :~382), `AgentModeService.ts` (`ingest`, in-memory only) | Findings become alerts through the existing service; photos go to storage next to incident clips; UI already renders alerts (`app/src/features/alerts/`) and stored clips (`app/src/features/incidents/components/IncidentClipPlayer.tsx`). |
| Server: cron scheduling of processes | `server/src/services/ProcessSchedulerService.ts` (`isDue`, `computeNextRun` with `cron-parser`), `ProcessDefinition.cronExpression` (`server/prisma/schema.prisma:~717`), `PUT /api/processes/:id/schedule`, `POST /api/processes/cron/validate` (`process.routes.ts:~120/~155`); `StepActionType` already lists `'inspect'` with no executor (`server/src/types/process.types.ts:~20`); `ProcessesPage.tsx:38` literally promises "Schedule recurring processes (daily inspections…)" but no UI reads `cronExpression` | The scheduler exists; it only needs a bridge into Agent Mode. |
| Server: routes/waypoints in the wild | `TwinExportService.ts` (VDA5050 roadmap `GET /api/digital-twins/:id/export/vda5050.json`, `twin.routes.ts:~508`; Nav2 keepout PGM/YAML) | Route model should be exportable the same way. |
| Sim: multi-room house scene, place graph, movable props, camera snapshots, demo recorder | `robot-agent/hardware/sim_evaluator/mjcf/g1_dex3_house_scene.xml`, `sim_evaluator/places/places.house.json`, `sim_g1_dds/sim_node.py` (`POST /sim/reset-pose {"body":"crate",x,y,yaw}` :~1346, `_apply_body_move`), `sim_g1_dds/demo_clip.py` (`--layout memory`, `--places`) | The demo: baseline run, move the crate into the hallway, patrol run → finding. |
| Real robot camera | `robot-agent/hardware/g1_sidecar.py` (`/cameras/<n>/snapshot` :~1788), MJPEG proxy `server/src/routes/robot.routes.ts:~253` | Same `snapshot()` path on hardware. |

**Gaps (nothing of this exists):** no `PatrolRoute`/`Checkpoint`/`PatrolRun`/`Finding` model, API or UI;
no multi-goto sequencing with per-leg outcome and resume; no bridge from a schedule into
`agentModeController.submitCommand`; **no stored camera image anywhere** (by design — see
`vision.ts:5` and `personalDataGate` in `rest-routes.ts:~82`); no baseline representation and
no comparison (`SceneMemoryStore` is live-only, 15 min staleness); no anomaly event type from the
robot (`AnomalyRecord` in `schema.prisma:~1359` is *model-behaviour* anomaly, enum
`confidence_drop|behavior_drift|…`); `grep -ri patrol` hits only demo copy.
Related tasks: TASK-195/196/197/198/199 (place, durable safety, memory, identity, heartbeat),
TASK-206/207/208/209/210/211 (map series), TASK-200 (geofence), TASK-027 (incidents), TASK-031
(oversight anomalies), TASK-025 (retention), TASK-179 (incident clip storage).

### How it is done in 2026 (research summary, links are the sources)

- **Commercial reference:** Spot missions = graph map + behavior-tree mission with per-node actions
  (`NavigateTo`, `SpotCamStoreMedia`, `RemoteGrpc`, `Dock`)
  (https://dev.bostondynamics.com/docs/concepts/autonomy/missions_service). Orbit does scheduling,
  alerts, VLM visual inspection, "Site View" photo history, webhooks
  (https://bostondynamics.com/products/orbit/); Orbit 5.0 adds AI anomaly detection (spills,
  missing extinguishers), **dynamic thresholds learned from past samples**, **automatic face
  blurring** (https://www.therobotreport.com/orbit-5-0-adds-features-boston-dynamics-spot-quadruped-robot/);
  Orbit 5.1 adds a security-patrol mission type with **Scene Alerts** — on an unexpected person the
  robot pauses, captures, alerts, resumes — and acoustic change vs. "nominal state captures"
  (https://www.therobotreport.com/boston-dynamics-releases-spot-and-orbit-5-1-with-new-spot-cam/).
  ANYmal: threshold alerts, Data Navigator trend history
  (https://www.anybotics.com/solutions/automate-inspection/,
  https://www.anybotics.com/news/anybotics-launches-data-navigator/). Cobalt lists exactly our
  finding classes — open doors, spills, unattended devices, people — and lets the robot decide when
  to page a human (https://blog.cobaltrobotics.com/how-security-robots-can-save-money-and-lives).
  Unitree Go2/B2 ship patrol *hardware* only; anomaly logic is left to integrators
  (https://www.unitree.com/industry/electricity/). Asylon puts a 24/7 human between every robot
  alert and the customer (https://asylonrobotics.com/solutions/dronedog/).
- **Detection techniques (edge, 2025-26):**
  - *VLM VQA pair-comparison* — ask the same fixed question list on the reference and the current
    image and diff the answers; validated on a patrolling Fetch, robust to pixel noise, sensitive
    to semantic state change (https://arxiv.org/abs/2309.16552). Caveat: MLLMs are weak at free
    "spot the difference" (https://arxiv.org/pdf/2501.04150) and at industrial AD (MMAD, GPT-4o
    74.9 %, https://arxiv.org/abs/2410.09453) — so **structured questions, not "what changed?"**.
  - *Zero-shot AD with CLIP-family models* (WinCLIP, AnomalyCLIP, AnomalyGPT; 2025 successors
    KAnoCLIP/AF-CLIP; survey https://arxiv.org/pdf/2502.19106,
    https://github.com/mala-lab/Awesome-Anomaly-Detection-Foundation-Models) — tuned to
    object/texture defects (MVTec/VisA), not room-scale scenes.
  - *Few-shot memory bank per checkpoint* — PatchCore (anomalib,
    https://anomalib.readthedocs.io/en/v2.1.0/markdown/guides/reference/models/image/patchcore.html),
    AnomalyDINO with DINOv2 patches (https://arxiv.org/pdf/2405.14529): one forward pass, great at
    a repeatable pose, degrades under viewpoint drift.
  - *Scene change detection* — DINOv2 + cross-attention, viewpoint tolerant, deployed on Stretch 3
    (https://arxiv.org/abs/2409.16850); classic SuperPoint/SuperGlue ref-vs-query
    (https://arxiv.org/pdf/2209.02379).
  - *Open-vocabulary detector + rule list* — YOLO-World ~52 FPS, Grounding DINO 1.5 Edge >10 FPS on
    Orin NX (https://blog.roboflow.com/best-object-detection-models/,
    https://arxiv.org/pdf/2405.10300).
  - *Lidar vs. stored map* — Nav2 movable-obstacles layer classifies live scan vs. static map
    (https://arxiv.org/html/2510.15336v1); object-level 3D change (3DGS-CD ~18 s/one image,
    https://arxiv.org/abs/2411.03706; MV-3DCD https://arxiv.org/abs/2412.03911; POCD
    https://export.arxiv.org/abs/2205.01202) is phase 2.
  - *Cascade* — cheap gate first, VLM only on suspects: 151× speed-up at −2.8 % AUC
    (https://arxiv.org/pdf/2510.16290); Jetson + Ollama + `gemma3:4b` with an SSIM guard skipping
    95 % of VLM calls, ~500 ms per decision
    (https://zededa.com/blog/how-to-build-zero-shot-anomaly-detection-with-vision-language-models-nvidia-jetson-and-ollama/).
  - *Edge VLM choice via Ollama* — `qwen2.5vl:3b`/`qwen3-vl:4b` most accurate, `gemma3:4b`
    fastest, `moondream` smallest
    (https://github.com/NVIDIA-AI-IOT/live-vlm-webui/blob/main/docs/usage/list-of-vlms.md,
    https://docs.photoprism.app/developer-guide/vision/model-comparison/,
    https://www.jetson-ai-lab.com/models/).
- **Route/mission representation:** Nav2 `FollowWaypoints` with task-executor plugins
  `PhotoAtWaypoint`/`WaitAtWaypoint`/`InputAtWaypoint`, returns missed waypoints
  (https://docs.nav2.org/configuration/packages/configuring-waypoint-follower.html); Nav2 Route
  Server plans on a node/edge graph with route operations
  (https://github.com/ros-navigation/navigation2/tree/main/nav2_route); Open-RMF `patrol` task
  schema = places + rounds
  (https://github.com/open-rmf/rmf_ros2/blob/main/rmf_fleet_adapter/schemas/task_description__patrol.json).
- **Alerting hygiene:** two-stage confirmation + human-in-the-loop cuts false alarms ~90 %
  (https://blog.hivewatch.com/how-to-reduce-physical-security-false-alarms,
  https://www.patsnap.com/resources/blog/articles/reducing-false-alarms-in-ai-anomaly-detection-systems/);
  baselines per checkpoint × time window (a lit lamp is normal at 09:00, not at 03:00); revisit to
  confirm before escalating; evidence = before/after + pose + time + model.
- **Privacy/compliance:** GDPR treats camera footage of identifiable people as personal data even if
  only an algorithm sees it; EDPB 3/2019 recommends minimisation and ≤72 h retention by default
  (https://www.edpb.europa.eu/sites/default/files/files/file1/edpb_guidelines_201903_video_devices_en_0.pdf);
  AI Act: no biometric ID, transparency + human oversight for surveillance-like uses
  (https://www.law.berkeley.edu/research/bclt/bclt-legal-analysis/eu-ai-act/); Orbit blurs faces
  by default. Fits `docs/regulatory-compliance.md`.
- **Datasets to sanity-check the comparator offline:** ChangeSim (indoor industrial SCD,
  https://github.com/SAMMiCA/ChangeSim), 3RScan (rescans of changing rooms,
  https://github.com/WaldJohannaU/3RScan), VL-CMU-CD/PSCD (viewpoint-varied pairs).

### Design decisions (settled — do not re-litigate during implementation)

| Topic | Decision |
|---|---|
| Route model | `PatrolRoute { id, name, robotId?, twinId, checkpoints: Checkpoint[], cronExpression?, enabled, timeWindows }`, `Checkpoint { id, placeId, name, headingDeg?, actions: ('capture'\|'dwell'\|'scan')[], dwellMs }`. Checkpoints reference **place ids from the twin's place graph** (the robot already resolves those); an optional pose refines the goal. Server is the source of record (Prisma), the robot fetches it like `PlaceGraphSource` fetches the graph. Exportable as VDA5050 nodes/edges next to the existing twin export. |
| One patrol = one Agent Mode plan | A patrol run is a plan whose blocks are the legs: `goto{place} → turn{to heading} → capture → inspect → … → goto{home}`. New block kinds **`capture`** (photo, stored) and **`inspect`** (compare vs. baseline at this checkpoint); a top-level **`patrol{routeId}`** block that the controller expands (like `scan_room` expands to turns). Every leg is executed by the existing executor, so E-Stop, geofence, `checkForwardPath`, control lock, mirror and compliance record apply unchanged. Legs that fail are **skipped and reported** (Nav2 "missed waypoints" semantics), the run continues; two consecutive failed legs abort the run and go home. |
| Not a heartbeat | `HEARTBEAT_ALLOWED_KINDS` stays `look/speak/wait/remember`. A scheduled patrol is **operator-scheduled** work with origin `scheduled`, submitted through `submitCommand`-equivalent `startPatrol()`. It still must pass `mayInitiate('goto','scheduled',…)` (battery ≥ `SELF_INITIATIVE_MIN_BATTERY`, place known and fresh, armed, not damped, no `crash_unacknowledged`), `isIdleWatchEligible()`, `lock.claim('agent')`, and — new — `AGENT_PATROL_ENABLED=true` and the route's time window. **Fail closed**: any unmet precondition ⇒ run recorded as `skipped` with the reason, alert to the operator, robot holds. |
| Baseline | Per checkpoint × time window (`day`/`night` or the route's named windows). Recorded on an **operator-started baseline run** of the same route (`mode: 'baseline'`): the control photo(s), the VLM checklist answers (JSON), the entity label set of every en-route look keyed by nearest checkpoint leg, and the occupancy-map snapshot at the end. Stored under `workspace-<robotId>/patrol/<routeId>/baseline/<window>/`, mirrored to the server bucket. Operators can promote any later run to "baseline" and can mark a finding "this is normal" which appends that observation to the baseline. Baseline data is **operator-trust** (it was supervised); VLM text inside it stays labelled `untrusted` per TASK-197. |
| Checkpoint comparison (accurate, slow, ≤ 1 per checkpoint) | Cascade: (1) cheap gate — perceptual hash / SSIM of current vs. best-matching baseline photo (same window); below threshold ⇒ `unchanged`, no model call; (2) local VLM (`AGENT_VISION_MODEL`, temp 0) answers a **fixed checklist** for BOTH images — `person present? door state? any object on floor? lights on? anything out of place (list)? free text one line` — as JSON; answers differing on a checklist item ⇒ candidate finding with the item as `type`. Optionally, per-checkpoint free-text expectations from the operator ("fire extinguisher on the wall left of the door") are extra checklist items. No open-ended "what changed" question (MMAD/spot-the-difference caveat). |
| En-route comparison (cheap, continuous) | Reuse the `AGENT_NAV_LOOK_EVERY_M` looks that already happen while walking a leg: (a) **semantic** — entity labels of this look vs. the baseline label set of the same leg: new label from a watch-list (`person, box, bag, crate, bottle, puddle, ladder, cable, open door`) or a missing baseline label ⇒ candidate; (b) **geometric** — cells that were FREE in the baseline map and are OCCUPIED now, clustered, ≥ `AGENT_PATROL_MIN_BLOB_M2` and not explained by a tracked peer (`peers.ts`) ⇒ candidate "unexpected object at (x,y) in <place>". Both are label/grid comparisons: **zero extra model calls**. |
| Confirmation before alerting | A candidate becomes a `finding` only after **N-of-M** (default 2 of 3) consecutive observations agree, or after a **revisit** (one extra `look` from ≤ 1 m closer, bounded by the executor's clamps). Time-window aware: the baseline for "night" is compared at night. Findings are rate-limited per type per place per run (one "person in Hallway" per run, not one every 2 m). Persons: **pause, one `speak` ("I am on patrol, please…") only if `personVisible`, capture the finding without the image, resume** (Orbit 5.1 pattern). |
| Photos & privacy | `capture` stores a JPEG **only if `personVisible === false`** in the same frame's VLM answer; otherwise the finding carries pose/time/type only. No face detection/blur in v1 (data minimisation by not storing is stronger and simpler); v2 may add blur to lift the rule. Photos are stored on the robot under `workspace-<robotId>/patrol/<routeId>/runs/<runId>/` and uploaded to the server bucket `patrol-photos`; retention follows the platform policy the journal already fetches (`fetchJournalRetention`), default 30 d for baseline/confirmed-finding photos and **72 h** for plain control photos; `Workspace.erase()` (GDPR) removes them too. `GET` routes sit behind `personalDataGate` like `/agent-mode`. Robot speaks a short notice at run start ("Starting patrol; I take reference photos") — the transparency obligation. |
| Reporting channel | New events `agent:patrol:started|leg|finished` and **`agent:finding:detected|confirmed`** in `AgentModeEventTypes`, pushed by `ServerMirror` like every other event. Server ingests, **persists** `PatrolRun`/`PatrolFinding` (unlike the in-memory `AgentModeService`), and calls `alertService.createRobotAlert` (severity by finding type: person/open door at night = `high`, object on floor = `medium`, missing/moved item = `low`); alert `sourceId` = finding id so the Alerts UI can deep-link. Optional `IncidentService.createIncident` for `high` when configured. Voice: speak only if a person is visible; otherwise silence (TASK-199 rule). |
| Scheduling | Server-side. Reuse `computeNextRun`/`isDue` (extract them from `ProcessSchedulerService` into `server/src/utils/cron.ts` rather than duplicating) in a new `PatrolSchedulerService` over `PatrolRoute.cronExpression`. Fire = `POST /api/robots/:id/agent-mode/patrol {routeId, mode:'patrol'}` proxied to the robot (same pattern as `/command` proxy in `agent-mode.routes.ts:~528`). If the robot declines (preconditions), the run is stored `skipped` with reason and an alert is raised; retry once after `PATROL_RETRY_MIN`. Concurrency: one active run per robot. |
| Defaults | `AGENT_PATROL_ENABLED=false`. Opt in per deployment. |
| Simulation first | Whole feature runs against `sim_g1_dds` + `g1_dex3_house_scene.xml`; the sim's `POST /sim/reset-pose {"body":…}` stages the anomaly (crate into the hallway; later: a second prop for "missing"). Real G1 uses identical code via `g1_sidecar.py`. |

### Robot Agent

1. **`src/agent-mode/patrol.ts` (NEW)** — `PatrolRunner`: loads the route (`PatrolRouteSource`, same
   fetch+cache pattern as `place-graph-source.ts`), builds the leg plan, tracks
   `PatrolRun { runId, routeId, mode, startedAt, legs[{checkpointId, status, photoKey?, findings[]}] }`,
   handles skip/abort/go-home, writes the run to `workspace-<robotId>/patrol/…`, emits patrol
   events. Preconditions via `mayInitiate` + `isIdleWatchEligible` + `AGENT_PATROL_ENABLED` +
   window; fail closed.
2. **`src/agent-mode/baseline.ts` (NEW)** — `BaselineStore`: per route × checkpoint × window;
   photos + checklist JSON + leg label sets + map snapshot; `promoteRun()`, `markNormal(finding)`.
3. **`src/agent-mode/inspector.ts` (NEW)** — the comparators: `gateByHash(cur, ref)` (SSIM/pHash,
   pure TS, no model), `checklistCompare(cur, ref)` (one VLM call via `llm.ts`, `CHECKLIST_PROMPT`
   in `prompts.ts`), `labelSetDiff(look, baselineLeg, watchlist)`, `mapDiff(baselineMap, currentMap)`
   → `Candidate[]`; `Confirmer` (N-of-M, cooldown per type×place, revisit request).
4. **`types.ts`** — add block kinds `patrol`, `capture`, `inspect`; add event types
   `agent:patrol:*`, `agent:finding:*`; `Finding` type
   `{ id, runId, routeId, checkpointId?, legIndex, type, severity, place, pose, at, evidence:{baselinePhotoKey?, currentPhotoKey?, checklistDiff?, blob?}, model, confidence, status }`.
   Mirror in `server/src/types/agent-mode.types.ts` and `app/src/features/agentmode/types/`.
5. **`block-executor.ts`** — `capture` (aligns heading if given, `hardwareClient.snapshot`, VLM
   observe for `personVisible`, store or drop, returns photoKey), `inspect` (runs the checkpoint
   cascade). `agent-mode-controller.ts` — `runPatrol()` expands `patrol` into legs and drives them
   through `runPlan(plan, skipPlanning=true)` (the `onPersonAppeared` route: `isIdleWatchEligible`
   → `lock.claim('agent')` → `runPlan`), hooks the en-route comparators into the existing per-look
   merge (`observeAndMerge`) **only while a patrol is active**, `startPatrol()`/`abortPatrol()`.
6. **`server-mirror.ts`** — photo upload (`PUT /api/robots/:id/patrol-runs/:runId/photos/:key`,
   multipart, 10 s timeout, retried by the existing re-push tick) alongside event mirroring.
7. **`api/rest-routes.ts`** — `POST /robots/:id/agent-mode/patrol {routeId, mode}`,
   `POST …/agent-mode/patrol/abort`, `GET …/agent-mode/patrol` (active run),
   `GET …/agent-mode/patrol/runs`, `GET …/patrol/runs/:runId/photos/:key` (behind
   `personalDataGate`), `POST …/patrol/findings/:id/normal`.
8. **`config/config.ts`** — `AGENT_PATROL_ENABLED` (false), `AGENT_PATROL_ROUTE_CACHE_PATH`,
   `AGENT_PATROL_CONFIRM_N`/`_M` (2/3), `AGENT_PATROL_MIN_BLOB_M2` (0.15),
   `AGENT_PATROL_WATCHLIST`, `AGENT_PATROL_PHOTO_RETENTION_H` (72), `AGENT_PATROL_HASH_GATE` (0.92),
   `AGENT_PATROL_HOME_PLACE`.
9. **`voice-narrator.ts`** — start-of-patrol notice, person-encounter line (EN/DE), yields to a
   live voice turn (TASK-199 rule).
10. **`workspace.ts`** — `patrol/` subtree with the same `atomicWrite`, temp sweep, `erase()`.
11. **`hardware/sim_g1_dds/demo_clip.py`** — `--layout patrol` (camera / map with the route and
    findings / photo-pair pane).

### Server

- `prisma/schema.prisma` — `PatrolRoute`, `PatrolCheckpoint` (or JSON column), `PatrolRun`,
  `PatrolFinding` (severity, type, status `open|acknowledged|dismissed_normal|escalated`,
  `alertId`, `incidentId?`, evidence keys), all `tenantId`-scoped like `Alert`.
- `src/storage/model-storage.ts` — bucket `patrol-photos`, `uploadPatrolPhoto`,
  `getPatrolPhotoStream`; retention job in `src/jobs/` reusing the storage-cleanup pattern.
- `src/services/PatrolService.ts` (NEW) — routes CRUD, runs, findings, `ingest(event)` from the
  agent-mode events path (`AgentModeService.ingest` calls it for `agent:patrol:*`/`agent:finding:*`),
  `createRobotAlert` on confirmed finding, `markNormal` → forwarded to the robot, `exportVda5050`.
- `src/services/PatrolSchedulerService.ts` (NEW) + `src/utils/cron.ts` (extracted from
  `ProcessSchedulerService`).
- `src/routes/patrol.routes.ts` (NEW) — `/api/patrol/routes…`, `/api/patrol/runs…`,
  `/api/patrol/findings/:id/(acknowledge|normal|escalate)`, `/api/robots/:id/patrol-runs/:runId/photos/:key`
  (PUT from robot, GET for UI); proxy `POST /api/robots/:id/agent-mode/patrol` in
  `agent-mode.routes.ts`.
- `src/websocket/index.ts` — broadcast `patrol:*` and `finding:*`.
- Compliance: one `logSystemEvent` per run start/end and per confirmed finding
  (`ComplianceLogService`), so a photographing robot leaves an audit trail.

### Frontend

- `app/src/features/patrol/` (NEW feature): `PatrolPage` (routes list, run history),
  `RouteEditor` (pick places from the twin place graph in order, heading, actions, cron with
  validation via `/processes/cron/validate` or a new `/patrol/cron/validate`, time windows,
  enable), `RunDetail` (leg timeline reusing `BlockTimeline`, per-checkpoint **baseline vs.
  current photo side by side**, findings with acknowledge / "this is normal" / escalate-to-incident),
  `RouteOverlay` on `RobotMapPanel`/`FleetMap` (checkpoints + finding pins),
  store `patrolStore.ts`, `patrolApi.ts`, WS hook.
- `app/src/features/agentmode/utils/blockFormat.ts` — labels/glyphs for `patrol`, `capture`,
  `inspect`; `ConditionAnnouncer` for "patrol skipped: battery".
- `app/src/features/alerts/` — alert with `source='robot'` and finding id links into `RunDetail`.

## Acceptance Criteria

- [ ] An operator can create a route from named places of the house twin with a cron schedule and
      time windows in the UI, and export it as VDA5050.
- [ ] `POST /agent-mode/patrol {mode:'baseline'}` walks the route in sim, stores one control photo
      per checkpoint plus checklist JSON, leg label sets and the map snapshot; the run is visible
      with its photos in `RunDetail`.
- [ ] A scheduled fire at the cron time starts a patrol run without a human in the loop; with
      `AGENT_PATROL_ENABLED=false`, low battery, unknown place, damped or crash-unacknowledged the
      run is recorded `skipped` with the reason and the robot does not move.
- [ ] Sim demo: after the baseline run, `POST /sim/reset-pose {"body":"crate",…}` moves the crate
      into the hallway → the next patrol raises **one** finding "unexpected object in Hallway"
      (map diff **and** label diff agree), with baseline/current photos and pose, which arrives as
      an alert over WS, and is journalled; the run finishes at home.
- [ ] A person standing in a room during a patrol → the robot pauses, says one line, records a
      `person` finding **without a stored image**, resumes; the alert is `high` at night.
- [ ] "This is normal" on a finding appends to the baseline; the same scene on the next run raises
      no finding.
- [ ] Every checkpoint inspection issues at most one VLM call and none when the hash gate says
      unchanged; en-route comparison issues zero model calls beyond the existing looks.
- [ ] Photos honour retention (72 h plain, policy for baseline/findings), `erase()` and
      `personalDataGate`; a start-of-run notice is spoken.
- [ ] Typecheck + vitest green in robot-agent, server, app; `./scripts/test-all.sh --skip-pw`.

## Test Strategy

**Unit (vitest).** `patrol.test.ts` — leg plan from a route; failed leg skipped, two consecutive
failures abort and go home; preconditions fail closed with reasons; window gating.
`inspector.test.ts` — hash gate short-circuits; checklist diff → candidate with the right type;
label-set diff respects watch-list and baseline; map diff clusters and ignores a tracked peer;
Confirmer N-of-M, cooldown, revisit request. `baseline.test.ts` — round-trip, `markNormal`,
per-window separation. Executor: `capture` drops the image when `personVisible`. Mirror: photo
upload retried. Server: `PatrolService.ingest` persists and raises exactly one alert per confirmed
finding; scheduler fires once per due slot; cron util extracted without behaviour change
(existing `ProcessSchedulerService` tests still pass). App: `blockFormat` cases, store reducers.

**Integration (sim, no robot).** The acceptance demo above, scripted like `e2e_map_check.py`:
baseline run → move crate → patrol run → assert one finding via `GET /api/patrol/runs/:id`;
record it with `demo_clip.py --layout patrol`.

**Offline sanity of the comparator.** Run `checklistCompare` on ~20 ChangeSim / 3RScan pairs with
the deployed model (`gemma3:4b` vs `qwen2.5vl:3b`), record precision on the checklist items in
the PR description — this picks the default `AGENT_VISION_MODEL` for patrol.

## Out of scope — v2, explicitly

Face blurring to allow storing frames with people; PatchCore/DINOv2 per-checkpoint memory bank
and open-vocab detector (YOLO-World) as extra cascade stages; object-level 3D change on the world
cloud (3DGS-CD/POCD); thermal/acoustic; gauge reading; multi-robot route sharing (Open-RMF style
dispatch); Nav2 `FollowWaypoints` backend when Agent Mode runs on ROS 2 (keep the route model
compatible); webhooks to external SOC/CMMS.

## Notes

- Suggested split if one PR is too big: (A) route model + server + scheduler + UI editor,
  (B) robot `patrol`/`capture` + photos + run history, (C) baseline + inspector + findings +
  alerts. A and B are independently shippable; C needs both.
- The one thing that changes the wire contract in three packages is the block/event vocabulary in
  `types.ts` — do it first, in one commit, with the mirrored types.
- Sources consulted for the 2026 picture are inline above; the two most useful entry points are
  the Boston Dynamics Missions Service docs and the Fetch "semantic scene difference in daily-life
  patrolling" paper.
