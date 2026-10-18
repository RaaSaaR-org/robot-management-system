---
id: "TASK-419"
aliases: []
title: "The readiness panel takes control, starts the robot side and spots stale robot code without a terminal"
slug: "the-readiness-panel-takes-control-starts-the-robot-side-and"
status: in-progress
priority: 1
owner: "huhn511"
projects: []
customers: []
tags: ["core", "teleop", "datacollection"]
sprint: ""
parent: ""
depends_on: []
spe: 5
effort: "high"
due_date: ""
created: "2026-10-18"
updated: "2026-10-18"
---

# The readiness panel takes control, starts the robot side and spots stale robot code without a terminal

## Description

The robot-day check and the end-to-end walk found that a first-time pair cannot get from "nothing running" to "arms follow" from the UI alone:

- The New session page says "Start its robot agent" but offers no Start.
- The readiness panel says "Switch to arm control — Take control first." The only Take control button is in another card, and it is disabled until that card's Connect.
- "Limp first, then stop" is disabled for the same reason.
- The blocking "Link lost" bug came from a robot agent still running code from before #430. Nothing in NeoDEM noticed that the robot side ran older code than the app. Adopting such a process in the panel silently runs the day on yesterday's code.
- The install docs give only the supervisor half, use `start` instead of `enable --now`, and tell the reader never to point a development server at the real robot's supervisor, which on this box is the only server.
- The two-person guide never switches to arm control or puts the robot in Balance.

Make the panel complete the bringup by itself, make stale code visible and refusable, and make the docs match.

## Details

### Current state

- **Lease gating.** `app/src/features/robots/components/readiness/RobotReadinessPanel.tsx:166-176` computes `armBlockedReason` / `limpBlockedReason` = "Take control first." when `lease.state !== 'bound'`.
  - `ReadinessLease` is `{enabled, state, grant()}`, supplied by `app/src/features/robots/components/tabs/TeleopTab.tsx:92-106`.
  - The lease binds to that card's keyboard-teleop agent socket (`useControlLease`, `app/src/features/robots/hooks/useControlLease.ts`), so Take control needs `connect()` first (`TeleopTab.tsx:116`).
  - On the session page the compact panel gets no lease at all (`app/src/features/datacollection/pages/SessionDetailPage.tsx:657`). The page has its own `useSessionControlLease` (`:332`).
- **No Start where you start.** `app/src/features/datacollection/pages/NewSessionPage.tsx:202`: "This robot is offline. Start its robot agent before you record." / "No robot is online right now." `app/src/features/robots/components/RobotOfflineBanner.tsx:38` says the same. Neither renders `RobotReadinessPanel`, although `ROBOT_SUPERVISORS` may cover the robot (readiness `bringup !== null`).
- **Stale code is invisible.**
  - The supervisor (`robot-agent/supervisor/src/steps.ts`) adopts foreign processes (`adopt()` `:453`) and re-adopts its own from PID files after a restart. It never compares a process's start time with the code it runs.
  - The server's readiness (`server/src/services/robot-supervisor/RobotReadinessService.ts:157,205`) reports an agent without a readiness route as `agent_no_readiness` "Robot agent sent no readiness report (HTTP 404)". It does not say that the agent is outdated.
  - The foreign row (`app/src/features/robots/components/readiness/ReadinessRow.tsx:96-118`) shows only a cmdline like `node --require …preflight.cjs --import …loader.mjs src/index.ts`, with no age.
- **Clipped reasons.** `RobotReadinessService.ts:123` sets `REASON_MAX_CHARS = 72`. The supervisor's texts put the key word last:
  - "robot cable unplugged or robot off (enp131s0: no carrier, operstate dow…";
  - "a process the supervisor did not start holds :6001 (bridge), :41245 (ag…" (`steps.ts:~600-610`, `~680-690`).
- **Docs.**
  - `docs/g1-edu-lab-bringup.md:50-75` (install: `systemctl --user start`, no server half, line 66 "The server proxy (TASK-409) gets the same token.");
  - `server/.env.example:166-176` ("Never point a development server at the real robot's supervisor profile.");
  - `docs/data-collection-two-person.md:47-63` (setup: Start → Connect Quest → Open on headset → Copy viewer link; no arm control, no Stand up/Balance).
  - Start always runs `read_only` (`steps.ts:356`); arm control is the lease-gated "Switch to arm control".

### Robot supervisor (`robot-agent/supervisor/src/steps.ts`)

- **Code age.** For each running or foreign `bridge`, `sidecar` and `agent` process, compare its start time (`/proc/<pid>/stat`) with the newest commit time of the code it runs:
  - `robot-agent/src` + `robot-agent/package-lock.json` for the agent;
  - the script file for the bridge and the sidecar.
  - Use `git log -1 --format=%ct -- <paths>` in the repo, cached for 30 s. A dirty working tree counts as "now" for the files it touches.
- **Owned processes.** A process older than its code sets the step's `checks.staleCode = {startedAt, codeAt}`, warn level, detail "runs code from before <date> — restart the robot side".
- **Foreign processes.** The same check goes into `step.foreign` (`startedAt`, `cwd` from `/proc/<pid>/cwd`, the robot id when its env or cmdline names one).
- **Adopt refuses stale code.** `adopt()` refuses a foreign process whose code is stale with 409 `stale_code`. Adopt stays for a foreign process that is current.
- The supervisor still never signals a process it did not start.
- **Texts.** Rewrite the `no_carrier` and `foreign_process` texts so the meaning fits in 72 characters, e.g. "Robot cable unplugged or robot off (enp131s0 no carrier)" and "Old processes hold :6001 bridge, :41245 agent — see the rows". Put the detail in the step's `detail`.

### Server (`server/src/services/robot-supervisor/RobotReadinessService.ts`)

- Agent answers `/api/v1/health` but its readiness route 404s → new reason `agent_outdated` (block): "The robot agent runs older code than NeoDEM. Restart the robot side."
- Map the supervisor's `staleCode` to the same reason when bringup is present.
- Keep `agent_no_readiness` for other failures.

### Frontend

- **Take control from the panel.**
  - `ReadinessLease` gains an optional `take?: () => Promise<boolean>`. When the lease is not bound and `take` exists, the blocked text becomes a button "Take control" next to "Switch to arm control" and in the Stop dialog next to "Limp first, then stop".
  - `TeleopTab` implements `take` as connect-if-needed plus `lease.take()`.
  - `SessionDetailPage` passes its session lease to the compact panel. Change only the `RobotReadinessPanel` line at `:657`; TASK-417/418 edit other blocks of this file.
- **Start where you start.** On `NewSessionPage`, when the picked robot is offline and readiness reports `bringup` (a supervisor exists), render `<RobotReadinessPanel robotId variant="compact"/>` under the robot field, with its Start robot side button. `RobotOfflineBanner` gets the same, via an optional `robotId` prop. The hint texts say "Start the robot side below" when a supervisor exists, and keep today's text otherwise.
- **Rows.**
  - `ReadinessRow` shows a foreign process's age and cwd ("started 2026-10-17 17:21 · robot-agent/").
  - For `stale_code` it shows "Runs code from before <date>. Stop it, then press Start." plus a copyable stop command. This is the only terminal step left, and it is rare, because supervisor-owned processes are restarted from the panel.
  - The Adopt button is hidden for stale code.

### Docs

- `docs/g1-edu-lab-bringup.md` install:
  - use `systemctl --user enable --now`;
  - add the server half: append `ROBOT_SUPERVISORS=g1-edu-4=http://127.0.0.1:8766` and the same `ROBOT_SUPERVISOR_TOKEN` to `server/.env`, then restart the server (editing `.env` does not restart `tsx watch`);
  - add `curl -s 127.0.0.1:8766/healthz` as the check;
  - add "after a code update: Stop and Start the robot side" (the panel now says so).
- `server/.env.example:166-176`: replace "Never point a development server at…" with: "Only the lab's NeoDEM server points at the real robot's supervisor. Branch servers and test stacks never do."
- `docs/data-collection-two-person.md` setup, after Start robot side:
  - Take control → Switch to arm control (confirm) → Stand up → Balance (confirm each; stand id 4 is unverified on the robot);
  - then Connect Quest / Open on headset; the headset takes control when it enters VR;
  - stopping: "Limp first, then stop".
  - Keep TASK-417's "After an E-stop" section separate.

### Key files

- robot-agent/supervisor/src/steps.ts + tests
- server/src/services/robot-supervisor/RobotReadinessService.ts + tests
- app/src/features/robots/components/readiness/{RobotReadinessPanel.tsx, ReadinessRow.tsx, readinessRows.ts} + `__tests__`
- app/src/features/robots/components/tabs/TeleopTab.tsx
- app/src/features/robots/components/RobotOfflineBanner.tsx
- app/src/features/datacollection/pages/NewSessionPage.tsx
- app/src/features/datacollection/pages/SessionDetailPage.tsx (`:657` only)
- docs/g1-edu-lab-bringup.md, docs/data-collection-two-person.md, server/.env.example

## Decisions

- **D1 Stale code is detected by start time vs. commit time.** It needs no protocol constant kept in sync across three packages, and it catches "merged and pulled, but not restarted" for owned and foreign processes alike. Rejected: a protocol version in the teleop `config` frame. It only catches wire changes, and it touches the VR client, which TASK-417/418 own.
- **D2 The supervisor still never signals a foreign process.** Stale foreign processes are refused for adoption and explained. Rejected: SIGTERM after a confirm, which widens the supervisor's kill rights and needs its own safety decision.
- **D3 Take control lives where the blocked action is.** A blocked button that names a missing action must offer it.

## Acceptance Criteria

- [ ] Supervisor tests (fake `/proc`, fake git):
  - an owned agent older than its code → `staleCode` on the agent step;
  - a stale foreign agent → `adopt` answers 409 `stale_code`;
  - a current foreign agent can still be adopted;
  - no signal is ever sent to a foreign pid.
- [ ] Server tests:
  - health ok + readiness 404 → `agent_outdated`;
  - supervisor `staleCode` → `agent_outdated`;
  - the cable and foreign texts are not cut mid-word at 72 chars.
- [ ] Live (branch app/server/supervisor on free ports, sim profile copy, private state dir):
  - from the robot's Teleop tab with nothing connected, "Take control" → "Switch to arm control" reaches `arm_sdk` without touching the keyboard card;
  - the Stop dialog's "Limp first, then stop" works from a fresh page the same way.
- [ ] Live: with the robot side stopped, `/data-collection/new` → pick the robot → the compact panel's Start robot side brings it to ready, and the robot becomes selectable without leaving the page.
- [ ] Live: start an agent on the sim profile's agent port from an older commit (a worktree at `d6817f57`) → the readiness reason is `agent_outdated`, the row shows its start time and no Adopt.
- [ ] The docs commands, run verbatim against a scratch `HOME`/state dir and a branch server, give a panel with a Start button (record the run in the PR).
- [ ] `npm run typecheck` (server, robot-agent), `npx tsc` (app), and the vitest and supervisor suites pass.

## Test Strategy

- **vitest:**
  - the supervisor code-age and adopt guard;
  - the readiness reason mapping;
  - `RobotReadinessPanel` with a `take` lease (button shown, action chained);
  - `NewSessionPage` with an offline supervised robot (panel shown) and an unsupervised one (old hint);
  - `ReadinessRow` for stale/foreign.
- **Live checks:** a branch supervisor on a free port against a copy of `sim-g1-edu-dev.yaml` with a private state dir, the sim on its own DDS domain over `lo`, and a branch server with `ROBOT_SUPERVISORS` pointing at it. GETs against the real supervisor are allowed; no POSTs to it.

## Safety constraints (binding for this task)

- Starting the robot side always runs `read_only` first. Arm control is reached only through the confirmed, lease-checked switch. Mode changes go only through the existing confirmed, lease-checked base-mode route.
- The supervisor never signals a process it did not start, and never sends SIGKILL to a sidecar.
- Never set `G1_READ_ONLY=0`, never use `G1_ARM_ALLOW_UNKNOWN_FSM=1`, no DDS publishing on domain 0 in development or tests.
- Development and tests use the sim stack only. Never start, stop, adopt or POST to the real g1-edu-4 robot side (:41245/:8767/:6001/:8766). Do not stop or restart the running dev stack, and do not edit `server/.env` or `~/.config` on this box. The install itself is an operator step.
