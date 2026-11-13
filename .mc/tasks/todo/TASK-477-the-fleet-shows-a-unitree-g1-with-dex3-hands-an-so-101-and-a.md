---
id: "TASK-477"
aliases: []
title: "The fleet shows a Unitree G1 with Dex3 hands, an SO-101 and a MicroDuck before their agents connect"
slug: "the-fleet-shows-a-unitree-g1-with-dex3-hands-an-so-101-and-a"
status: "in-progress"         # backlog | todo | in-progress | review | done | cancelled
priority: 2                   # 1=critical, 2=high, 3=medium, 4=low
owner: "claude"
projects: []
customers: []
tags: ["robots", "demo", "ui"]
sprint: ""
parent: ""
depends_on: []
spe: 5
effort: "medium"
due_date: "2026-11-16"
created: "2026-11-13"
updated: "2026-11-13"
---

# The fleet shows a Unitree G1 with Dex3 hands, an SO-101 and a MicroDuck before their agents connect

## Description

The demo instance should present three robots: a Unitree G1 with Dex3 hands,
an SO-101 arm and a MicroDuck. Today a robot row can only come from an agent
calling `POST /api/robots/register`, so the live fleet shows only
`sim-robot-001`, and a robot whose agent is not running — or that has not been
delivered — cannot be listed at all. A row written straight into the database
reads "Offline · Battery AC · Seen just now" and is flagged "Battery at 0%" on
the dashboard, which looks broken.

This task adds the *expected robot*: a robot on the fleet before its agent has
ever registered. It adds the Microduck robot type, a script that puts the three
demo robots on a running instance through the public API, and the app copy that
makes such a robot read as intended. The Hugging Face import's Featured list
gains our own G1 recording and a small SO-101 dataset.

Branch: `feat/task-477-the-fleet-shows-a-unitree-g1-with-dex3-hands-an-so-101-and-a`.

## Details

### Current state

Checked on `main` at `64c03875`.

- Robots: `RobotManager.registerRobot` (`server/src/services/RobotManager.ts`)
  fetches `/api/v1/register` and the agent card from the agent and upserts the
  row with endpoints and card. There is no other way in. `getAllRegisteredRobots`
  loads rows with `registeredAt != null` for health checks.
- Robot types: `server/src/database/seedStandardRobotTypes.ts` runs at server
  start and is create-only by name. It has `Unitree G1 EDU (Dex3-1)` (43 / 43),
  `Unitree G1 arms + Dex3-1 hands` (28 / 28) and `SO-101 Follower` (6 / 6).
- The Helm chart (`helm/neodem/templates`) has no seed job; the only job is
  `rustfs-init-job.yaml`. `VITE_DEMO_MODE` serves mock robots from `app/src/mocks`
  and is not what the live instance runs.
- The app has no per-model imagery on the fleet card. The robot page's Overview
  draws a 3D model picked by `metadata.robotType` (`g1_edu`, `g1`, `h1`, `so101`),
  and a box for anything else.
- `DELETE /api/robots/:id` answers 404 for a row with no endpoints or agent
  card: `unregisterRobot` looks the row up through `getRegisteredRobot`.
- `useFleetStatus` maps a `null` battery to `0` on the fleet markers, so the
  dashboard's "Needs attention" lists any robot with no battery reading as
  "Battery at 0%".

### Decisions

- **MicroDuck is the Pollen Robotics Microduck** (part of Hugging Face):
  25 cm, under 800 g, fifteen servos, RK3566, RL policies at 50 Hz, pre-orders
  since August 2026, first deliveries targeted before Christmas 2026. Sources:
  pollen-robotics.com/microduck and the `pollen-robotics/microduck` README. The
  name matches exactly; it is not the community Open Duck Mini. No LeRobot
  dataset of one exists, so the type's 15 / 15 is one value per servo.
- **An expected robot is a plain `Robot` row, no schema change**: no endpoints,
  no agent card, `registeredAt = null`, `status = offline`, and two metadata keys
  (`provisioning` = `awaiting_agent` | `arriving`, `provisioningNote`).
- **An agent that registers under the id takes the row over.** The provisioning
  keys are dropped and `registeredAt` is stamped — without that stamp the robot
  would not be health-checked after the next server start.
- **The script owns only rows it wrote** (`metadata.seededBy = "demo-fleet"`,
  still expected). The server refuses to rewrite a registered robot on its own.
- The existing robot types are not renamed (they are create-only by rule). The
  robots carry the owner's wording as their names.

### Backend

- `PUT /api/robots/:id/expected` creates or updates an expected robot: 201 / 200,
  409 with nothing written when the id belongs to a registered robot or any row
  that is not an expected one, 400 on a bad body.
- `DELETE /api/robots/:id` removes a row that has no agent.
- `upsertWithRegistration` claims an unregistered row as described above.
- `Microduck` (Pollen Robotics, `microduck`, 15 / 15) joins the standard robot
  types.
- `npm run seed:demo-fleet -- --base-url <url>` (`server/src/scripts/`), with
  `--dry-run`, `--remove`, `--without-microduck`, `--token`.

### Frontend

- `robotProvisioning(robot)`; `RobotStatusTag` and `RobotOfflineBanner` take it.
- Fleet card and table, robot page header, banner, Overview and Details, and the
  control center read "Not connected" / "Arriving" with no invented battery,
  last-seen or place.
- Fleet markers keep a `null` battery `null`.
- Featured list: `ycchen0106/g1-apple-to-plate` and
  `Thytu/so101-object-in-box_v0.4-fixed`.

### Key files

- `server/src/services/expectedRobot.ts`, `server/src/routes/robot.routes.ts`,
  `server/src/repositories/RobotRepository.ts`, `server/src/services/RobotManager.ts`
- `server/src/scripts/demoFleet.ts`, `server/src/scripts/seed-demo-fleet.ts`
- `server/src/database/seedStandardRobotTypes.ts`
- `app/src/features/robots/types/robots.types.ts`,
  `app/src/features/robots/components/{RobotCard,RobotList,RobotOfflineBanner,RobotDetailPanel}.tsx`,
  `app/src/features/robots/components/common/RobotStatusTag.tsx`,
  `app/src/features/robots/components/tabs/{OverviewTab,InfoTab}.tsx`
- `app/src/features/fleet/hooks/useFleetStatus.ts`
- `app/src/features/training/components/HFDatasetBrowserModal.tsx`
- `docs/demo-fleet.md`, `docs/api.md`

## Acceptance Criteria

- [x] Robot types exist for all three: `Unitree G1 EDU (Dex3-1)` 43 / 43,
      `SO-101 Follower` 6 / 6 and the new `Microduck` 15 / 15 (Pollen Robotics).
- [x] `npm run seed:demo-fleet -- --base-url <url>` puts the three robots on a
      running instance through the public API; a second run reports all three
      `unchanged` and writes nothing.
- [x] The script never modifies or removes a robot it did not create, including
      one whose agent registered under one of its ids; the server answers 409 to
      such a write.
- [x] An agent registering under an expected robot's id takes the row over and
      is health-checked after a restart.
- [x] The fleet list and the robot page show the three robots as "Not connected"
      (G1, SO-101) and "Arriving" (MicroDuck), with no "AC" battery for a
      battery robot, no "Seen just now", and no "Battery at 0%" on the dashboard.
- [x] An ordinary offline robot looks exactly as before.
- [x] The Featured list offers `ycchen0106/g1-apple-to-plate` and one verified
      small SO-101 dataset.
- [x] Server typecheck and vitest, app `tsc`, vitest and build pass.

## Test Strategy

- `cd server && npm run typecheck && npx vitest run` — in particular
  `src/__tests__/expected-robot.integration.test.ts` (real SQLite: the route, the
  claim, and the sync against the real routes), `src/scripts/__tests__/demoFleet.test.ts`
  and `src/database/__tests__/seedStandardRobotTypes.test.ts`.
- `cd app && npx tsc --noEmit && npx vitest run && npm run build` — in particular
  `src/features/robots/components/__tests__/expectedRobot.test.tsx` and
  `src/features/training/components/__tests__/HFDatasetBrowserModal.test.tsx`.
- By hand: a local server on a scratch SQLite database, the script run three
  times (dry run, create, repeat) and with `--remove`, and the fleet list, the
  three robot pages, the dashboard and the control center read in a browser.

## Notes

- Datasets, checked on the Hugging Face API on 2026-11-13:
  - `ycchen0106/g1-apple-to-plate` — public, ungated, LeRobot v2.1,
    `unitree_g1`, 43 / 43, 260 episodes, 69,460 frames, 15 fps, one AV1
    `ego_view` camera, 310.5 MB. No license on the card.
  - `Thytu/so101-object-in-box_v0.4-fixed` — public, ungated, apache-2.0,
    LeRobot v2.1, `so101_follower`, 6 / 6, 101 episodes, 22,260 frames, 30 fps,
    one H.264 `front` camera, 51.4 MB.
  - `lerobot/svla_so101_pickplace` (already featured) is v3.0, `so100_follower`,
    6 / 6, 50 episodes, two AV1 cameras, 86 MB.
- Not done here: the script was not run against the live instance. After the
  deploy: `cd server && npm run seed:demo-fleet -- --base-url https://neodem.emai.dev`.
- Left as it is: the dashboard's "Avg battery" tile says "All robots on AC
  power" whenever no robot reports a battery, which is not true of a fleet of
  expected robots only. It reads correctly as soon as one robot reports a level.
- Left as it is: `VITE_DEMO_MODE` mock robots are unchanged.
