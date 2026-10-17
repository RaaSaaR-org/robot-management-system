---
id: "TASK-412"
aliases: []
title: "One button in NeoDEM connects the Quest and opens the live session on it"
slug: "one-button-in-neodem-connects-the-quest-and-opens-the-live"
status: "in-progress"
priority: 2
owner: "huhn511"
projects: []
customers: []
tags: ["core", "vr", "datacollection", "ops"]
sprint: ""
parent: ""
depends_on: ["[[TASK-409]]", "[[TASK-411]]"]
spe: 5
effort: "medium"
due_date: ""
created: "2026-10-17"
updated: "2026-10-18"
---

# One button in NeoDEM connects the Quest and opens the live session on it

## Description

Getting the Quest 3 onto the session page currently takes three manual steps:
1. Run `scripts/quest-connect.sh` (`adb reverse tcp:1420`) in a terminal.
2. Type the session URL into the Quest browser.
3. Find the right session.

This task makes it one flow:
- NeoDEM shows whether a Quest is plugged in and authorized;
- **Connect** sets up the reverse port;
- **Open on headset** launches the Quest browser on a stable URL that always lands on the robot's live session;
- the operator then only presses "Enter VR".

## Details

### Current state
- **`scripts/quest-connect.sh`**
  - `find_adb` (l.68-80) does not look in `~/platform-tools`.
  - Exit codes 3/4/5 mean no device, unauthorized and offline.
  - `adb reverse tcp:1420 tcp:1420` (l.165); optional wireless (l.184-200).
  - `am start -a android.intent.action.VIEW -d <url> com.oculus.browser` (l.206).
- **adb binaries:** both `/home/humanoid/platform-tools/adb` and `~/.local/opt/platform-tools/adb` exist (the same binary). The adb server runs on `127.0.0.1:5037`.
- **App:** `app/src/features/robots/components/tabs/vr/QuestConnectHelp.tsx` (140 lines, static copy-the-command help, used by `VRTeleopSection.tsx:132`) and `vrAvailability.ts` (~l.112-119).
- **Routes** in `app/src/App.tsx` (~l.495-525): `/data-collection`, `/data-collection/new`, `/data-collection/:sessionId`, `/data-collection/record/:sessionId`. There is no "active session for robot X" entry.
- **Server (TASK-409):** `SupervisorClient` (`server/src/services/robot-supervisor/SupervisorClient.ts`), `robot-bringup.routes.ts` and `RobotReadinessService`.
- **Readiness panel (TASK-411):** `RobotReadinessPanel.tsx` has a Quest row placeholder.
- **Supervisor (TASK-403):** `robot-agent/supervisor/` on 127.0.0.1:8766.
- WebXR needs a user gesture in the headset, so a deep link can land only on the page; "Enter VR" stays a press in the headset.

### Supervisor
New `robot-agent/supervisor/src/quest.ts`, routes added in `api.ts`:
- **adb path:** from profile `quest.adb`, else the first of `~/platform-tools/adb`, `~/.local/opt/platform-tools/adb`, `adb` on PATH.
- `GET /quest` → `{adb: string|null, devices:[{serial, state:'device'|'unauthorized'|'offline', model}], reversed:[{remote, local}], hint: string|null}`. The `hint` text mirrors the script's messages for codes 3/4/5.
- `POST /quest/connect {port?: 1420}` runs `adb -s <serial> reverse tcp:<port> tcp:<port>`.
- `POST /quest/open {path}` runs `am start … -d http://localhost:<port><path> com.oculus.browser`.
  - `path` must match `^/data-collection/(live\?robot=[A-Za-z0-9_-]+|[0-9a-f-]{36})$`, otherwise 400. Never pass an arbitrary URL to a device shell.
- Commands use `execFile` with an argument array, never a shell string.

### Server
In `server/src/routes/robot-bringup.routes.ts`, with the operator role:
- `GET /api/robots/:id/quest`
- `POST /api/robots/:id/quest/connect`
- `POST /api/robots/:id/quest/open {path}`

They proxy to the robot's supervisor.

`RobotReadinessService` adds `quest: {devices, reversed} | null` to the snapshot. It polls `GET /quest` every 2 s, only while a client watches. `quest` is display-only and never changes `reason`.

### Frontend
- **Live-session redirect.** New route `/data-collection/live` (in `App.tsx`), page `app/src/features/datacollection/pages/LiveSessionRedirect.tsx`.
  - It reads `?robot=`, lists that robot's sessions with status `created` or `recording` (existing sessions API), and `navigate(replace)`s to the newest.
  - Otherwise it shows "No live session for <robot>. Waiting…", and re-checks every 2 s, so the headset can open before the desktop creates the session.
- **`QuestConnectHelp.tsx`**, when the supervisor is reachable (`readiness.quest != null`):
  - Live status: "Quest 3 (serial …) connected" / "Put on the headset and allow USB debugging" / "No headset on USB".
  - Buttons **Connect** (reverse 1420) and **Open on headset** (`/data-collection/live?robot=<id>`).
  - Without a supervisor it keeps today's copy-the-command help.
- **Readiness Quest row** in `RobotReadinessPanel.tsx`: device state, whether port 1420 is reversed, and the Connect/Open buttons.
- **Desktop viewer link.** Next to Open on headset, a **Copy viewer link** button copies `<origin>/data-collection/<sessionId>` for the second person.
- **`scripts/quest-connect.sh`**: `find_adb` also checks `~/platform-tools/adb`.

### Key files
- robot-agent/supervisor/src/{quest.ts (new), api.ts} + tests
- robot-agent/hardware/profiles/g1-edu-4.yaml (`quest.adb` optional)
- server/src/routes/robot-bringup.routes.ts, server/src/services/robot-supervisor/{SupervisorClient.ts, RobotReadinessService.ts} + tests
- app/src/App.tsx (one route)
- app/src/features/datacollection/pages/LiveSessionRedirect.tsx (new) + test
- app/src/features/robots/components/tabs/vr/{QuestConnectHelp.tsx, vrAvailability.ts}
- app/src/features/robots/components/readiness/RobotReadinessPanel.tsx (Quest row)
- scripts/quest-connect.sh

## Decisions
- **D1 adb runs on the supervisor**, because the USB cable is on the robot PC. Rejected: running it in the server, which may run elsewhere.
- **D2 The headset opens a stable URL, `/data-collection/live?robot=…`**, not a session id. The headset tab survives session changes and can be opened first.
- **D3 No QR code in this task.** The headset URL is `localhost` (adb reverse), so a QR for it is useless. The second person gets a copied link. Rejected: adding a QR dependency for one link.
- **D4 The `open` path is allowlisted by regex.** Device shell input is never free-form.

## Acceptance Criteria
- [x] `GET /quest` maps `adb devices -l` fixtures for device, unauthorized, offline and none to states and hints. connect and open build the exact argument arrays (execFile spy). A bad path → 400 with no exec.
- [x] The server routes proxy, require the operator role, and readiness carries `quest`.
- [x] `/data-collection/live?robot=X` redirects to X's newest live session, and waits and redirects once one is created (Playwright demo with MSW).
- [x] QuestConnectHelp shows live status and buttons with a supervisor, and the old help without one.
- [x] `quest-connect.sh` finds `~/platform-tools/adb` (shellcheck-clean; a bash test with a fake HOME).
- [x] Typecheck and vitest pass in supervisor, server and app.

## Test Strategy
- **vitest:** a fake `execFile` in the supervisor, supertest on the server, Testing Library plus MSW for the app.
- **Manual on-site step**, recorded here by the operator: plug in the Quest, Connect, Open on headset, Enter VR.
- No robot motion is involved.

## Safety constraints (binding for this task)
- Never set `G1_READ_ONLY=0`, and never use `G1_ARM_ALLOW_UNKNOWN_FSM=1`.
- Never `kill -9` / SIGKILL a sidecar. Stop it with SIGTERM and let it ramp down.
- Starting or stopping services never commands motion and never switches the FSM. Mode changes go only through the existing confirmed, lease-checked base-mode route.
- No DDS publishing on domain 0 in development or tests. Use the sim on domain 42 / `lo`.
- Never run `xr_teleoperate` and the arm_sdk sidecar together.
- The E-stop stays reachable: B/Y and the two-hand pinch in VR, and a visible E-STOP on the desktop session page.
- Development and tests use the sim stack only: the sim agent :41246 and sim sidecar :8777, or branch builds on free ports. Never the real g1-edu-4 (:41245/:8767). Do not stop or restart the running dev stack.

## Implementation notes (2026-10-18)

Where the merged code or the spec left a choice, this is what was built:

- **`quest` in the readiness snapshot is the whole supervisor report** — `{adb, devices, reversed, hint} | null`, a superset of the spec's `{devices, reversed}`, so the UI can show the hint and "adb not found". Read every 2 s while watched (`READINESS_QUEST_POLL_MS`), only from a supervisor that just answered; it never changes `reason`.
- **Route guard:** "operator role" is `memberOrAbove` here, as for the bringup writes. `GET /:id/quest` is member too. Both POSTs are audited like bringup writes (`quest_connect`, `quest_open`), a viewer's 403 included. The write-route inventory moves 383 → 385.
- **Port:** connect/open take the page's own port (`window.location.port`, else 1420), so a dev server on another port works. The supervisor and server both accept only 1024–65535. The open path is allowlisted on the server *and* again on the supervisor.
- **No usable headset** → supervisor 409 `no_device`/`no_adb` with the hint; a failing adb → 502 `reverse_failed`/`open_failed` with adb's words. `am start` printing `Error:` counts as a failure.
- **Open on headset connects first** when the port is not forwarded yet, so one press is enough.
- **Live statuses** for `/data-collection/live` are `created`, `recording` **and `paused`**: a paused session is still where the headset belongs.
- **Quest row** (`readinessRows.ts`) is a supervisor row (hidden without one): ok = connected + forwarded, warn = unauthorized/offline, idle = no headset or not forwarded, unknown = no adb / a supervisor older than TASK-412. Its Connect/Open buttons sit in the full panel only; in the VR launcher the compact panel is followed by `QuestConnectHelp`, which carries them.
- **Copy viewer link** lives in `QuestConnectHelp`. It appears only on a session page, where the session id is read off the location (path or demo hash route, uuid only).
- **Shared buttons:** `app/src/features/robots/components/readiness/QuestControls.tsx` (new) holds Connect / Open on headset / Copy viewer link for both places.
- **Profile:** `quest.adb` is parsed (and `${HOME}` expanded). `g1-edu-4.yaml` documents it as a commented example, because the search already finds `~/platform-tools/adb` on this box.
- **Bash test:** `scripts/test-quest-connect.sh` (fake HOME, PATH=/usr/bin:/bin) runs as a stage of `scripts/test-all.sh` (outside the Node block, so also in CI's `--python-only` job). The GitHub App cannot push workflow files, so `check.yml` is unchanged.
- **Demo/MSW:** `app/src/mocks/liveSessionDemoHandlers.ts` (sessions created in the page load, listed and served by id), and a stateful demo Quest in `readinessDemoHandlers.ts`. The Playwright spec is `app/e2e/quest-connect.spec.ts`.

Live check (branch build, sim only, reserved ports): supervisor :8912 with a sim profile whose `quest.adb` is a logging fake adb, server :3112 on a DB copy, app :1442. In the browser, Connect ran exactly `adb -s <serial> reverse tcp:1442 tcp:1442` and Open on headset ran `… am start -a android.intent.action.VIEW -d http://localhost:1442/data-collection/live?robot=task412-sim com.oculus.browser`. The live page waited, then followed a session created through the API. A bad path got 400 from both the server and the supervisor, with no adb call. The Quest polling stopped once the watch window ended. The real `~/platform-tools/adb` was found with a read-only status call (no headset was attached). **Still open:** the manual on-site step with a real Quest 3 (plug in, Connect, Open on headset, Enter VR), which is for the operator.
